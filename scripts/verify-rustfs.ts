import { signRequest, EMPTY_PAYLOAD_HASH } from "../packages/backend/convex/sigv4";

const ENDPOINT = "http://localhost:9000";
const ACCESS_KEY = process.env.RUSTFS_ACCESS_KEY!;
const SECRET_KEY = process.env.RUSTFS_SECRET_KEY!;

async function signedFetch(
  method: string,
  path: string,
  body?: string,
  extraHeaders: Record<string, string> = {},
) {
  const url = new URL(ENDPOINT + path);
  const payloadHash = body
    ? (await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body) as any) as any)
    : EMPTY_PAYLOAD_HASH;
  // compute hex
  const buf = body
    ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
    : null;
  const hex = buf
    ? Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("")
    : EMPTY_PAYLOAD_HASH;
  const headers = await signRequest({
    method,
    url,
    credential: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    region: "us-east-1",
    service: "s3",
    headers: { ...extraHeaders, ...(body ? { "content-type": "application/octet-stream" } : {}) },
    payloadHash: hex,
  });
  const res = await fetch(url, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

const list = await signedFetch("GET", "/");
console.log("ListBuckets:", list.status, list.body.slice(0, 400));
