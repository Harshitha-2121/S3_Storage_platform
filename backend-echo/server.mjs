// Reference "real" backend for the hybrid template — proves the attach paths:
//   DIRECT : browser -> here with a Convex JWT, verified via JWKS (no shared secret).
//   PROXY  : Convex action -> here with a shared service key + x-user-id.
//   JOBS   : Convex -> /jobs/run (proxy); we process async then webhook the result back.
//   WEBHOOK: here -> Convex /backend/webhook (push results/events back).
// Run with Node from inside /opt/myos so `jose` resolves from node_modules.
import http from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PORT = process.env.PORT || 4000;
const SERVICE_KEY = process.env.SERVICE_KEY || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || "http://10.1.30.14:3211";
const AUDIENCE = process.env.CONVEX_AUDIENCE || "convex";

// Public-key verification only — this is the whole "attach to any backend" trick.
const JWKS = createRemoteJWKSet(
  new URL(`${CONVEX_SITE_URL}/.well-known/jwks.json`),
);

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
      if ((req.headers["x-service-key"] || "") !== SERVICE_KEY) {
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
      if ((req.headers["x-service-key"] || "") !== SERVICE_KEY) {
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

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`echo backend listening on :${PORT}`),
);
