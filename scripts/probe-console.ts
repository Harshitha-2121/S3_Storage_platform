import { signRequest, EMPTY_PAYLOAD_HASH } from "../packages/backend/convex/sigv4";

const ENDPOINT = "http://localhost:9000";
const CONSOLE = "http://localhost:9001";
const ACCESS_KEY = process.env.RUSTFS_ACCESS_KEY!;
const SECRET_KEY = process.env.RUSTFS_SECRET_KEY!;

async function adminCall(method: string, path: string, bodyObj?: unknown, acceptEncoding = true) {
  const url = new URL(ENDPOINT + path);
  const body = bodyObj ? JSON.stringify(bodyObj) : undefined;
  const buf = body ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)) : null;
  const hex = buf ? Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("") : EMPTY_PAYLOAD_HASH;
  const headers = await signRequest({
    method, url,
    credential: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    region: "us-east-1", service: "s3",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(acceptEncoding ? { "accept-encoding": "identity" } : {}) },
    payloadHash: hex,
  });
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  return { status: res.status, ct: res.headers.get("content-encoding"), body: text.slice(0, 400) };
}

// Console login (MinIO console API)
try {
  const login = await fetch(CONSOLE + "/api/v1/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessKey: ACCESS_KEY, secretKey: SECRET_KEY }),
  });
  const txt = await login.text();
  console.log("console login:", login.status, txt.slice(0, 200));
  const setCookie = login.headers.get("set-cookie");
  if (setCookie) {
    console.log("got session cookie");
    const users = await fetch(CONSOLE + "/api/v1/users", { headers: { cookie: setCookie.split(";")[0] } });
    console.log("console users:", users.status, (await users.text()).slice(0, 300));
  }
} catch (e) { console.log("console err", String(e)); }

console.log("list-users (identity):", JSON.stringify(await adminCall("GET", "/minio/admin/v3/list-users")));
