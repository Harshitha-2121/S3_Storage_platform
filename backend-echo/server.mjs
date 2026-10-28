// Reference "real" backend for the hybrid template — proves the attach paths:
//   DIRECT : browser -> here with a Convex JWT, verified via JWKS (no shared secret).
//   PROXY  : Convex action -> here with a shared service key + x-user-id.
//   JOBS   : Convex -> /jobs/run (proxy); we process async then webhook the result back.
//   WEBHOOK: here -> Convex /backend/webhook (push results/events back).
//   S3     : Convex -> /s3-connections/apply; we persist a scoped gateway
//            credential, reload it from disk and prove it works.
// Run with Node from inside /opt/myos so `jose` resolves from node_modules.
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  ConfigError,
  ConnectionService,
  S3ConnectionError,
} from "./s3-connection-service.mjs";

const PORT = process.env.PORT || 4000;
const SERVICE_KEY = process.env.SERVICE_KEY || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || "http://10.1.30.14:3211";
const AUDIENCE = process.env.CONVEX_AUDIENCE || "convex";

// Dedicated secret for automatic S3 connection delivery. Deliberately NOT the
// generic SERVICE_KEY: this route receives and stores credential material.
const S3_CONNECTION_SECRET = process.env.S3_CONNECTION_SECRET || "";
const MAX_PROVISION_BYTES = 16 * 1024;

// Built lazily so a consumer that never uses S3 provisioning does not need
// S3_CONNECTION_STATE_DIR, and misconfiguration becomes a clean HTTP error
// instead of a boot crash.
let connectionService = null;
function getConnectionService() {
  if (!connectionService) connectionService = new ConnectionService();
  return connectionService;
}

// Public-key verification only — this is the whole "attach to any backend" trick.
const JWKS = createRemoteJWKSet(
  new URL(`${CONVEX_SITE_URL}/.well-known/jwks.json`),
);

/**
 * Constant-time shared-secret check that FAILS CLOSED when the expected secret
 * is not configured. Comparing against an empty default would otherwise accept
 * any request that simply omits the header.
 */
function hasValidSecret(presented, expected) {
  if (!expected || typeof presented !== "string" || presented.length === 0) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}


function send(res, status, obj) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-service-key,x-user-id",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

/** Bounded JSON body read for the credential-bearing route. */
async function readBoundedJson(req, limit) {
  const declared = req.headers["content-length"];
  if (declared !== undefined) {
    if (!/^\d+$/.test(declared) || Number(declared) > limit) {
      throw new ConfigError("PayloadTooLarge", "Request body is too large", 413);
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new ConfigError("PayloadTooLarge", "Request body is too large", 413);
    }
    chunks.push(chunk);
  }
  if (size === 0) throw new ConfigError("InvalidConfig", "Request body is required");
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ConfigError("InvalidConfig", "Request body is not valid JSON");
  }
  return parsed;
}

/** Errors are reported by code + message only; no stack, no secret material. */
function sendError(res, err) {
  if (err instanceof ConfigError || err instanceof S3ConnectionError) {
    return send(res, err.status, { ok: false, error: err.code, message: err.message });
  }
  return send(res, 500, { ok: false, error: "InternalError", message: "Request failed" });
}

async function postWebhook(body) {
  return fetch(`${CONVEX_SITE_URL}/backend/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});

    // DIRECT PATH — verify the Convex-issued JWT against the public JWKS.
    if (req.method === "GET" && req.url === "/whoami") {
      const header = req.headers["authorization"] || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!token) return send(res, 401, { error: "missing bearer token" });
      try {
        const { payload } = await jwtVerify(token, JWKS, {
          issuer: CONVEX_SITE_URL,
          audience: AUDIENCE,
        });
        return send(res, 200, {
          verified: true,
          sub: payload.sub,
          iss: payload.iss,
          aud: payload.aud,
        });
      } catch (e) {
        return send(res, 401, { verified: false, error: String(e?.message || e) });
      }
    }

    // PROXY PATH — trust the shared service key, echo the forwarded user id.
    if (req.method === "POST" && req.url === "/proxy-echo") {
      if (!hasValidSecret(req.headers["x-service-key"], SERVICE_KEY)) {
        return send(res, 401, { error: "bad service key" });
      }
      const body = await readBody(req);
      return send(res, 200, {
        viaProxy: true,
        echoedUserId: req.headers["x-user-id"] || null,
        received: body,
      });
    }

    // JOBS — accept a job, simulate async work, then webhook the result back to Convex.
    if (req.method === "POST" && req.url === "/jobs/run") {
      if (!hasValidSecret(req.headers["x-service-key"], SERVICE_KEY)) {
        return send(res, 401, { error: "bad service key" });
      }
      const body = await readBody(req);
      const jobId = body.jobId;
      setTimeout(async () => {
        try {
          await postWebhook({
            type: "job.result",
            jobId,
            result: {
              kind: body.kind,
              echoedInput: body.input,
              finishedBy: "echo-backend",
              at: new Date().toISOString(),
            },
          });
        } catch (e) {
          console.error("job webhook failed", e);
        }
      }, 1500);
      return send(res, 202, { accepted: true, jobId });
    }

    // WEBHOOK EMIT — push a generic event back into Convex (demo of backend -> Convex).
    if (req.method === "POST" && req.url === "/emit-webhook") {
      const body = await readBody(req);
      const r = await postWebhook({ type: "demo.echo", ...body });
      return send(res, 200, { posted: true, convexStatus: r.status });
    }

    // AUTOMATIC S3 CONNECTION — the control plane delivers scoped credentials
    // here; we persist them, reload from disk and verify against the gateway.
    // Server-to-server only: dedicated secret, never a browser-visible route.
    if (req.method === "POST" && req.url === "/s3-connections/apply") {
      if (!hasValidSecret(req.headers["x-s3-connection-secret"], S3_CONNECTION_SECRET)) {
        return send(res, 401, { ok: false, error: "Unauthorized" });
      }
      try {
        const body = await readBoundedJson(req, MAX_PROVISION_BYTES);
        const { result } = await getConnectionService().apply(body);
        // Never echo the secret: the response is safe to log.
        return send(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendError(res, err);
      }
    }

    // Operator/debug view of what this consumer currently holds (no secrets).
    if (req.method === "GET" && req.url === "/s3-connections") {
      if (!hasValidSecret(req.headers["x-s3-connection-secret"], S3_CONNECTION_SECRET)) {
        return send(res, 401, { ok: false, error: "Unauthorized" });
      }
      try {
        return send(res, 200, { ok: true, connections: getConnectionService().list() });
      } catch (err) {
        return sendError(res, err);
      }
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    // Detail stays in the server log; the response carries a generic message.
    console.error("request failed", e);
    send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`echo backend listening on :${PORT}`),
);
