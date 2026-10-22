/**
 * OIDC-fix sidecar for self-hosted Convex (local dev only).
 *
 * Problem: this convex-backend image serves a SYNTACTICALLY INVALID JWKS
 * document at /.well-known/jwks.json (object keys are unquoted, e.g.
 * `{keys:[{use:sig,kty:RSA,...}]}`), and a truncated openid-configuration
 * (missing response_types_supported / subject_types_supported /
 * id_token_signing_alg_values_supported). The backend's own OIDC discovery
 * therefore fails with "AuthProviderDiscoveryFailed", which breaks ALL
 * authenticated queries (getAuthUserId) — i.e. no login can ever complete.
 *
 * Fix: point CONVEX_SITE_ORIGIN at this proxy (http://127.0.0.1:3220).
 * It serves a complete, valid provider metadata document and a repaired
 * JWKS (fetched live from the real site proxy on :3211, key-quoting fixed,
 * re-serialized). Everything else is transparently reverse-proxied to :3211
 * (notably /api/auth/* for OAuth callbacks).
 *
 * Runs as the `oidc-fix` service in self-hosted/docker-compose.yml with
 * `network_mode: service:backend`, so that 127.0.0.1:3220 resolves from
 * INSIDE the backend container (the backend fetches its own site origin).
 */

import http from "node:http";

const LISTEN_PORT = Number(process.env.OIDC_FIX_PORT ?? 3220);
const REAL_SITE = process.env.REAL_SITE_ORIGIN ?? "http://127.0.0.1:3211";
const PUBLIC_ORIGIN = process.env.PUBLIC_SITE_ORIGIN ?? `http://127.0.0.1:${LISTEN_PORT}`;

let cachedJwks = null;

function quoteBareKeys(text) {
  // The backend's JWKS serializer emits bare keys AND bare short values,
  // e.g. {keys:[{use:sig,kty:RSA,n:...,e:AQAB}]} — neither is valid JSON.
  // Values are base64url / simple tokens (no ':', ',', quotes inside),
  // so quoting bare keys and bare values is safe. Already-quoted strings,
  // numbers, true/false/null are left untouched.
  return text
    .replace(/([\{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([A-Za-z0-9][A-Za-z0-9_\-+/.]*)(?=[,\}\]])/g, ':"$1"');
}

async function fetchRealJwks() {
  const res = await fetch(`${REAL_SITE}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`real JWKS fetch failed: ${res.status}`);
  const raw = await res.text();
  const fixed = quoteBareKeys(raw);
  const parsed = JSON.parse(fixed); // throws if still invalid
  if (!parsed || !Array.isArray(parsed.keys)) throw new Error("JWKS has no keys array");
  return parsed;
}

function fullMetadata() {
  return {
    issuer: PUBLIC_ORIGIN,
    authorization_endpoint: `${PUBLIC_ORIGIN}/oauth/authorize`,
    token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
    userinfo_endpoint: `${PUBLIC_ORIGIN}/oauth/userinfo`,
    jwks_uri: `${PUBLIC_ORIGIN}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", PUBLIC_ORIGIN);

    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(fullMetadata()));
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      try {
        cachedJwks = await fetchRealJwks();
      } catch (e) {
        console.error(`[oidc-fix] JWKS refresh failed (${e.message}), serving cache`);
        if (!cachedJwks) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "jwks_unavailable" }));
          return;
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(cachedJwks));
      return;
    }

    // Transparent reverse proxy to the real site proxy for everything else.
    const target = `${REAL_SITE}${url.pathname}${url.search}`;
    const headers = { ...req.headers };
    // Preserve host header for SigV4 gateway verification
    delete headers["content-length"];
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : req,
      duplex: "half",
    });
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) {
        outHeaders[k] = v;
      }
    });
    res.writeHead(upstream.status, outHeaders);
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (e) {
    console.error(`[oidc-fix] proxy error: ${e.message}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_failed" }));
  }
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(`[oidc-fix] listening on 0.0.0.0:${LISTEN_PORT}, real site ${REAL_SITE}`);
});
