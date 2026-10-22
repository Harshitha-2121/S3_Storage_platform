import { signRequest, EMPTY_PAYLOAD_HASH } from "../packages/backend/convex/sigv4";

const ENDPOINT = "http://localhost:9000";
const CONSOLE = "http://localhost:9001";
const ACCESS_KEY = process.env.RUSTFS_ACCESS_KEY!;
const SECRET_KEY = process.env.RUSTFS_SECRET_KEY!;

async function signedFetch(base: string, method: string, path: string, extraHeaders: Record<string, string> = {}, body?: string) {
  const url = new URL(base + path);
  const buf = body
    ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
    : null;
  const hex = buf
    ? Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("")
    : EMPTY_PAYLOAD_HASH;
  const headers = await signRequest({
    method, url,
    credential: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    region: "us-east-1", service: "s3",
    headers: extraHeaders,
    payloadHash: hex,
  });
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 600) };
}

// Probe MinIO-style admin API
console.log("ADMIN /minio/admin/v3/info:", JSON.stringify(await signedFetch(ENDPOINT, "GET", "/minio/admin/v3/info")).slice(0,300));
console.log("");
console.log("Console root:", JSON.stringify(await fetch(CONSOLE).then(r => ({status: r.status}))));
console.log("Console /api/v1/login GET:", JSON.stringify(await fetch(CONSOLE + "/api/v1/login").then(r => r.text()).then(t => t.slice(0,200))));
