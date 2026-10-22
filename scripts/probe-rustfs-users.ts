import { signRequest, EMPTY_PAYLOAD_HASH } from "../packages/backend/convex/sigv4";

const ENDPOINT = "http://localhost:9000";
const ACCESS_KEY = process.env.RUSTFS_ACCESS_KEY!;
const SECRET_KEY = process.env.RUSTFS_SECRET_KEY!;

async function adminCall(method: string, path: string, bodyObj?: unknown) {
  const url = new URL(ENDPOINT + path);
  const body = bodyObj ? JSON.stringify(bodyObj) : undefined;
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
    headers: body ? { "content-type": "application/json" } : {},
    payloadHash: hex,
  });
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 500) };
}

const testAk = "testuser-" + Date.now();
const testSk = "testsecret-" + Date.now() + "abcdef";
console.log("add-user:", JSON.stringify(await adminCall("POST", "/minio/admin/v3/add-user", {
  accessKey: testAk, secretKey: testSk, status: "on", name: "Test User",
})));
console.log("list-users:", JSON.stringify(await adminCall("GET", "/minio/admin/v3/list-users")).slice(0,400));
console.log("set-policy (empty):", JSON.stringify(await adminCall("POST", "/minio/admin/v3/set-policy", {
  policyName: "test-policy-" + Date.now(),
  policy: JSON.stringify({ Version: "2012-10-17", Statement: [] }),
})).slice(0,300));
