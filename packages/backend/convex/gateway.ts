// S3-compatible HTTP gateway.
//
// External S3 clients authenticate here with
// application-issued access keys (AWS Signature
// Version 4). The gateway:
//   1. Verifies the SigV4 signature using the
//      credential's secret (decrypted server-side).
//   2. Enforces the credential's scope (buckets +
//      actions) and workspace/bucket ownership.
//   3. Re-signs the request with the server-side
//      root credentials and proxies it to RustFS.
//   4. Returns RustFS's response to the client.
//
// Root credentials are read from server env vars and
// are NEVER returned to any client.

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { timingSafeEqual } from "./credCrypto";
import { UNSIGNED_PAYLOAD, canonicalRequest, sha256Hex, signature, signRequest } from "./sigv4";
import { S3ProtocolError, decodeXmlBody, parseCompleteMultipart, parseDeleteObjects, parseTagging, parseVersioning, readS3Body, validateCors, validateS3Route, validateTags, validateVersionId } from "./s3Protocol";
import {
  bucketFromPath,
  s3ActionForRequest,
  storageErrorMessage,
} from "./storageValidate";

const EMPTY_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const MAX_GATEWAY_BYTES = () => {
  const limit = Number(process.env.S3_GATEWAY_MAX_BYTES ?? "10485760");
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 10485760;
};

const GATEWAY_PREFIX = "/s3/";

// Resolve authorization on every request; revocation must not depend on TTL.

// In-memory Token Bucket rate limiter per accessKeyId (DoS and brute-force protection)
// Max burst: 120 requests; refill rate: 30 requests/second
const RATE_LIMIT_CAPACITY = 120;
const RATE_LIMIT_REFILL_PER_SEC = 30;
const rateLimitMap = new Map<string, { tokens: number; lastRefill: number }>();

function checkRateLimit(accessKeyId: string): boolean {
  const now = Date.now();
  let entry = rateLimitMap.get(accessKeyId);
  if (!entry) {
    entry = { tokens: RATE_LIMIT_CAPACITY - 1, lastRefill: now };
    if (rateLimitMap.size > 5000) rateLimitMap.clear();
    rateLimitMap.set(accessKeyId, entry);
    return true;
  }
  // Refill tokens
  const elapsedSec = (now - entry.lastRefill) / 1000;
  entry.tokens = Math.min(
    RATE_LIMIT_CAPACITY,
    entry.tokens + elapsedSec * RATE_LIMIT_REFILL_PER_SEC,
  );
  entry.lastRefill = now;
  if (entry.tokens >= 1) {
    entry.tokens -= 1;
    return true;
  }
  return false;
}

function xmlResponse(status: number, code: string, message: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${escapeXml(message)}</Message></Error>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/xml",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type ParsedAuth = {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
};

function parseAuthorization(auth: string): ParsedAuth | null {
  // AWS4-HMAC-SHA256 Credential=AK/date/region/service/aws4_request, SignedHeaders=a;b, Signature=hex
  const m =
    /^AWS4-HMAC-SHA256\s+Credential=([^\/]+)\/(\d{8})\/([^\/]+)\/([^\/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})$/.exec(
      auth.trim(),
    );
  if (!m || !m[1] || !m[2] || !m[3] || !m[4] || !m[5] || !m[6]) return null;
  return {
    accessKeyId: m[1],
    date: m[2],
    region: m[3],
    service: m[4],
    signedHeaders: m[5].split(";"),
    signature: m[6],
  };
}

type PresignedQueryAuth = {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
  timestamp: string;
  expires: number;
};

const MAX_PRESIGNED_SECS = 604800; // 7 days (S3 limit)

/** Parse SigV4 presigned URL query (?X-Amz-Algorithm=...). Null when absent/invalid. */
function parsePresignedQuery(url: URL): PresignedQueryAuth | null {
  const q = url.searchParams;
  if (q.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") return null;
  const credential = q.get("X-Amz-Credential");
  const timestamp = q.get("X-Amz-Date");
  const expiresRaw = q.get("X-Amz-Expires");
  const signature = q.get("X-Amz-Signature");
  if (!credential || !timestamp || !expiresRaw || !signature) return null;
  const parts = credential.split("/");
  if (parts.length !== 5 || parts[4] !== "aws4_request") return null;
  const [accessKeyId, date, region, service] = parts;
  if (!accessKeyId || !date || !/^\d{8}$/.test(date) || !region || !service)
    return null;
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || expires < 1 || expires > MAX_PRESIGNED_SECS)
    return null;
  const signedHeaders = (q.get("X-Amz-SignedHeaders") ?? "host").split(";");
  return {
    accessKeyId,
    date,
    region,
    service,
    signedHeaders,
    signature,
    timestamp,
    expires,
  };
}

/** Reconstruct + verify a SigV4 presigned query (payload is UNSIGNED-PAYLOAD,
 *  X-Amz-Signature itself is excluded from the canonical query). */
async function verifyPresignedQuery(
  req: Request,
  parsed: PresignedQueryAuth,
  secretKey: string,
  s3Path: string,
): Promise<boolean> {
  const url = new URL(req.url);
  const query: Record<string, string | string[]> = Object.create(null);
  const searchStr = url.search.startsWith("?")
    ? url.search.slice(1)
    : url.search;
  if (searchStr.length > 0) {
    for (const part of searchStr.split("&")) {
      if (!part) continue;
      const eqIdx = part.indexOf("=");
      const rawK = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
      const rawV = eqIdx >= 0 ? part.slice(eqIdx + 1) : "";
      const k = decodeURIComponent(rawK.replace(/\+/g, " "));
      if (k === "X-Amz-Signature") continue;
      const v = decodeURIComponent(rawV.replace(/\+/g, " "));
      const prev = query[k];
      if (prev === undefined) query[k] = v;
      else if (Array.isArray(prev)) prev.push(v);
      else query[k] = [prev, v];
    }
  }

  const headers: Record<string, string> = {};
  for (const name of parsed.signedHeaders) {
    const value = req.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  if (!("host" in headers)) {
    const host = req.headers.get("host");
    if (host) headers.host = host;
  }

  const signedHeaders = parsed.signedHeaders.slice().sort().join(";");

  // Same original-path rule as header auth: the client signed the full
  // gateway path (including the /s3 prefix).
  const cr = canonicalRequest({
    method: req.method,
    path: decodeURIComponent(s3Path),
    query,
    headers,
    signedHeaders,
    payloadHash: UNSIGNED_PAYLOAD,
  });
  const crHash = await sha256Hex(cr);
  const sig = await signature({
    secretAccessKey: secretKey,
    date: parsed.date,
    region: parsed.region,
    service: parsed.service,
    timestamp: parsed.timestamp,
    canonicalRequestHash: crHash,
  });
  return timingSafeEqual(sig, parsed.signature);
}

/** Reconstruct + verify a SigV4 request. */
async function verifySigV4(
  req: Request,
  parsed: ParsedAuth,
  secretKey: string,
  s3Path: string,
): Promise<boolean> {
  // Build the query record from the request URL,
  // preserving repeated keys and valueless query parameters.
  const url = new URL(req.url);
  const query: Record<string, string | string[]> = Object.create(null);
  const searchStr = url.search.startsWith("?")
    ? url.search.slice(1)
    : url.search;
  if (searchStr.length > 0) {
    for (const part of searchStr.split("&")) {
      if (!part) continue;
      const eqIdx = part.indexOf("=");
      const rawK = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
      const rawV = eqIdx >= 0 ? part.slice(eqIdx + 1) : "";
      const k = decodeURIComponent(rawK.replace(/\+/g, " "));
      const v = decodeURIComponent(rawV.replace(/\+/g, " "));
      const prev = query[k];
      if (prev === undefined) query[k] = v;
      else if (Array.isArray(prev)) prev.push(v);
      else query[k] = [prev, v];
    }
  }

  // Gather the signed headers from the request.
  const headers: Record<string, string> = {};
  for (const name of parsed.signedHeaders) {
    const value = req.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  // host is always signed; ensure it is present.
  if (!("host" in headers)) {
    const host = req.headers.get("host");
    if (host) headers.host = host;
  }

  // Declared payload hash (client-committed).
  const declaredHash = req.headers.get("x-amz-content-sha256") ?? EMPTY_HASH;

  const signedHeaders = parsed.signedHeaders.slice().sort().join(";");

  // Reconstruct the canonical request over the ORIGINAL
  // path (including the /s3 gateway prefix) — that is
  // exactly what the client signed.
  const cr = canonicalRequest({
    method: req.method,
    path: decodeURIComponent(s3Path),
    query,
    headers,
    signedHeaders,
    payloadHash: declaredHash,
  });
  const crHash = await sha256Hex(cr);
  const sig = await signature({
    secretAccessKey: secretKey,
    date: parsed.date,
    region: parsed.region,
    service: parsed.service,
    timestamp: req.headers.get("x-amz-date") ?? "",
    canonicalRequestHash: crHash,
  });
  return timingSafeEqual(sig, parsed.signature);
}

/** The S3-compatible gateway handler (registered in http.ts). */
export async function s3Gateway(ctx: ActionCtx, req: Request): Promise<Response> {
  let response: Response;
  try { response = await handleS3Request(ctx, req); }
  catch (error) {
    response = error instanceof S3ProtocolError
      ? xmlResponse(error.status, error.code, error.detail)
      : xmlResponse(500, "InternalError", "Storage operation failed");
  }
  if (req.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
}

async function handleS3Request(ctx: ActionCtx, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const originalPath = url.pathname;

  // Only the gateway prefix is handled here.
  if (originalPath !== "/s3" && !originalPath.startsWith(GATEWAY_PREFIX)) {
    return xmlResponse(404, "NoSuchRoute", "Not routed");
  }
  // Strip the gateway prefix to get the S3 path-style path.
  const s3Path =
    originalPath === "/s3"
      ? "/"
      : "/" + originalPath.slice(GATEWAY_PREFIX.length);

  // Security: Guard against path traversal, null bytes, backslashes, or control characters.
  // A malformed percent-encoding is a bad request, not a server error.
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(s3Path);
  } catch {
    return xmlResponse(400, "InvalidURI", "Path percent-encoding is malformed");
  }
  if (
    decodedPath.includes("\0") ||
    decodedPath.includes("\\") ||
    decodedPath.split("/").some((segment) => segment === "..") ||
    /[\x00-\x1f\x7f]/.test(decodedPath)
  ) {
    return xmlResponse(
      400,
      "InvalidURI",
      "Path contains illegal characters or path traversal sequences",
    );
  }

  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // --- Authenticate: SigV4 Authorization header OR X-Amz presigned query ---
  const authHeader = req.headers.get("authorization");
  let parsed: ParsedAuth;
  let queryAuth: PresignedQueryAuth | null = null;
  if (authHeader) {
    const p = parseAuthorization(authHeader);
    if (!p) {
      return xmlResponse(403, "AccessDenied", "Malformed Authorization header");
    }
    if (p.service !== "s3") {
      return xmlResponse(
        403,
        "AccessDenied",
        "Invalid credential scope (expected s3)",
      );
    }
    parsed = p;
  } else {
    const q = parsePresignedQuery(url);
    if (!q) {
      return xmlResponse(
        403,
        "AccessDenied",
        "Missing AWS SigV4 Authorization header",
      );
    }
    if (q.service !== "s3") {
      return xmlResponse(
        403,
        "AccessDenied",
        "Invalid credential scope (expected s3)",
      );
    }
    queryAuth = q;
    parsed = {
      accessKeyId: q.accessKeyId,
      date: q.date,
      region: q.region,
      service: q.service,
      signedHeaders: q.signedHeaders,
      signature: q.signature,
    };
  }

  const cred = await ctx.runQuery(internal.s3Credentials.resolveCredential, {
    accessKeyId: parsed.accessKeyId,
  });
  if (!cred) {
    return xmlResponse(
      403,
      "InvalidAccessKeyId",
      "The access key id does not exist or is revoked",
    );
  }

  // Verify the signature (presigned query uses UNSIGNED-PAYLOAD + expiry).
  let valid = false;
  try {
    valid = queryAuth
      ? await verifyPresignedQuery(req, queryAuth, cred.secretKey, originalPath)
      : await verifySigV4(req, parsed, cred.secretKey, originalPath);
  } catch {
    valid = false;
  }
  if (!valid) {
    return xmlResponse(
      403,
      "SignatureDoesNotMatch",
      "The request signature is invalid",
    );
  }

  // Rate Limiting / DoS Protection: verify token bucket for credential
  if (!checkRateLimit(parsed.accessKeyId)) {
    return xmlResponse(429, "SlowDown", "Please reduce your request rate");
  }

  // Timestamp freshness: header auth rejects >15 min skew;
  // presigned URLs expire per X-Amz-Expires.
  if (queryAuth) {
    const t = Date.parse(
      queryAuth.timestamp.replace(
        /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
        "$1-$2-$3T$4:$5:$6Z",
      ),
    );
    if (
      !Number.isFinite(t) ||
      Date.now() > t + queryAuth.expires * 1000 ||
      t - Date.now() > 15 * 60 * 1000
    ) {
      return xmlResponse(403, "AccessDenied", "The presigned URL has expired");
    }
  } else {
    const amzDate = req.headers.get("x-amz-date");
    if (amzDate) {
      const t = Date.parse(
        amzDate.replace(
          /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
          "$1-$2-$3T$4:$5:$6Z",
        ),
      );
      if (Number.isFinite(t) && Math.abs(Date.now() - t) > 15 * 60 * 1000) {
        return xmlResponse(
          403,
          "RequestTimeTooSkewed",
          "The request timestamp is out of the allowed range",
        );
      }
    }
  }

  // Mark the credential as used (best-effort).
  void ctx
    .runMutation(internal.s3Credentials.touchCredential, {
      id: cred.id,
    })
    .catch(() => {});

  validateS3Route(req.method, s3Path, url.searchParams);

  // --- Authorize: action + bucket scope + ownership ---
  const action = s3ActionForRequest({
    method: req.method,
    path: s3Path,
    query: url.searchParams,
  });

  // Action scope.
  if (cred.actions && cred.actions.length > 0) {
    if (!cred.actions.includes(action)) {
      return xmlResponse(
        403,
        "AccessDenied",
        `Credential is not authorized to perform ${action}`,
      );
    }
  }

  // Bucket scope + ownership.
  const bucketName = bucketFromPath(s3Path);
  if (bucketName) {
    const bucket = await ctx.runQuery(internal.buckets.resolveBucketByRustfsName, { rustfsName: bucketName });
    // Uniform response prevents cross-account bucket existence probing.
    if (!bucket || bucket.accountId !== cred.accountId) {
      return xmlResponse(
        403,
        "AccessDenied",
        "Access to the specified bucket is denied",
      );
    }
    // Bucket-level scope restriction.
    if (cred.buckets && cred.buckets.length > 0) {
      const allowed = cred.buckets.some(
        (id: Id<"buckets">) => id === bucket._id,
      );
      if (!allowed) {
        return xmlResponse(
          403,
          "AccessDenied",
          "Credential is not authorized for this bucket",
        );
      }
    }
  }

  // Security: Authorize CopyObject source bucket ownership and access
  const copySourceHeader = req.headers.get("x-amz-copy-source");
  if (copySourceHeader) {
    // Split query before decoding: an encoded '?' can be part of a key.
    const [sourcePath, sourceQuery = ""] = copySourceHeader.split("?");
    const sourceParams = new URLSearchParams(sourceQuery);
    let sourceBucketName: string | null;
    try {
      sourceBucketName = bucketFromPath(sourcePath!);
      if (!sourcePath!.replace(/^\//, "").includes("/")) throw new Error();
      if (sourceParams.getAll("versionId").length > 1) throw new Error();
      if (sourceParams.has("versionId")) validateVersionId(sourceParams.get("versionId")!);
    } catch { return xmlResponse(400, "InvalidArgument", "Invalid copy source"); }
    const srcBucket = sourceBucketName ? await ctx.runQuery(internal.buckets.resolveBucketByRustfsName, { rustfsName: sourceBucketName }) : null;
    if (!srcBucket || srcBucket.accountId !== cred.accountId) {
      return xmlResponse(
        403,
        "AccessDenied",
        "Access to the copy source bucket is denied",
      );
    }
    // Check bucket permission scope on source bucket
    if (cred.buckets && cred.buckets.length > 0) {
      const allowedSrc = cred.buckets.some(
        (id: Id<"buckets">) => id === srcBucket._id,
      );
      if (!allowedSrc) {
        return xmlResponse(
          403,
          "AccessDenied",
          "Credential is not authorized to read from copy source bucket",
        );
      }
    }
    // Check if credential is permitted s3:GetObject
    if (
      cred.actions &&
      cred.actions.length > 0 &&
      !cred.actions.includes(sourceParams.has("versionId") ? "s3:GetObjectVersion" : "s3:GetObject")
    ) {
      return xmlResponse(
        403,
        "AccessDenied",
        "Credential lacks read access to the source object/version",
      );
    }
  }

  // ListBuckets is special: filter to the account's buckets.
  const isListBuckets = s3Path === "/" || s3Path === "";

  // --- Proxy to RustFS (re-signed with root creds) ---
  try {
    // Read the body (bounded for the gateway path).
    let body: Uint8Array | undefined;
    if (req.method === "PUT" || req.method === "POST") {
      const isPartUpload = req.method === "PUT" && url.searchParams.has("uploadId");
      const isXml = ["delete", "cors", "tagging", "versioning"].some((flag) => url.searchParams.has(flag)) || (req.method === "POST" && url.searchParams.has("uploadId"));
      const maxAllowed = isXml ? 2 * 1024 * 1024 : isPartUpload ? 64 * 1024 * 1024 : MAX_GATEWAY_BYTES();
      if (req.headers.get("x-amz-content-sha256")?.startsWith("STREAMING-") || req.headers.get("content-encoding")?.includes("aws-chunked")) {
        return xmlResponse(501, "NotImplemented", "AWS chunk-signature streaming is not supported; send a bounded ordinary payload");
      }
      body = await readS3Body(req, maxAllowed);
    }

    // Compute the actual payload hash.
    const actualPayloadHash = body ? await sha256Hex(body) : EMPTY_HASH;

    // Security: Payload Integrity Verification.
    // If client supplied x-amz-content-sha256 (and it's not UNSIGNED-PAYLOAD or STREAMING),
    // ensure the received body matches the declared cryptographic hash.
    const clientPayloadHash = req.headers.get("x-amz-content-sha256");
    if (
      clientPayloadHash &&
      clientPayloadHash !== UNSIGNED_PAYLOAD &&
      !clientPayloadHash.startsWith("STREAMING-")
    ) {
      if (!timingSafeEqual(actualPayloadHash, clientPayloadHash)) {
        return xmlResponse(
          400,
          "XAmzContentSHA256Mismatch",
          "The provided 'x-amz-content-sha256' header does not match the computed SHA256 of the payload body",
        );
      }
    }

    // Validate without reserialization: preserve exact signed bytes and Quiet.
    const q = url.searchParams;
    if (body) {
      if (q.has("tagging")) parseTagging(decodeXmlBody(body), s3Path.indexOf("/", 1) >= 0 && !s3Path.endsWith("/"));
      if (q.has("versioning")) parseVersioning(decodeXmlBody(body));
      if (q.has("cors")) validateCors(decodeXmlBody(body));
      if (req.method === "POST" && q.has("uploadId")) parseCompleteMultipart(decodeXmlBody(body));
      if (q.has("delete")) {
        const batch = parseDeleteObjects(decodeXmlBody(body));
        if (cred.actions?.length && batch.objects.some((entry) => !cred.actions!.includes(entry.versionId === undefined ? "s3:DeleteObject" : "s3:DeleteObjectVersion"))) {
          return xmlResponse(403, "AccessDenied", "Credential lacks delete access for an entry in this batch");
        }
      }
    }
    const tagging = req.headers.get("x-amz-tagging");
    if (tagging !== null) {
      validateTags([...new URLSearchParams(tagging)].map(([key, value]) => ({ key, value })), true);
      if (cred.actions?.length && !cred.actions.includes("s3:PutObjectTagging")) return xmlResponse(403, "AccessDenied", "Credential lacks object tagging access");
    }
    const payloadHash = actualPayloadHash;

    const rustfsEndpoint = process.env.RUSTFS_ENDPOINT!;
    const target = new URL(rustfsEndpoint + s3Path);

    // Reconstruct upstream query string preserving flag parameters (e.g. ?uploads, ?location)
    // while stripping client-side presigned params (X-Amz-*).
    const queryEntries: string[] = [];
    for (const [k, v] of url.searchParams.entries()) {
      if (k.startsWith("X-Amz-")) continue;
      if (v === "") {
        // Valueless flag parameter like ?uploads, ?location, ?tagging, ?cors, ?versioning, ?versions, ?delete
        queryEntries.push(encodeURIComponent(k));
      } else {
        queryEntries.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }
    target.search = queryEntries.length > 0 ? `?${queryEntries.join("&")}` : "";

    // Headers to forward + sign.
    const forwardHeaders: Record<string, string> = {};
    const contentType = req.headers.get("content-type");
    if (contentType && body) forwardHeaders["content-type"] = contentType;
    const contentMd5 = req.headers.get("content-md5");
    if (contentMd5) forwardHeaders["content-md5"] = contentMd5;
    const copySource = req.headers.get("x-amz-copy-source");
    if (copySource) {
      forwardHeaders["x-amz-copy-source"] = copySource;
    }
    // Forward standard S3 / HTTP conditional and range headers
    for (const h of [
      "range",
      "if-range",
      "if-match",
      "if-none-match",
      "if-modified-since",
      "if-unmodified-since",
    ]) {
      const val = req.headers.get(h);
      if (val !== null) forwardHeaders[h] = val;
    }
    // Forward user metadata, tags, and S3 control headers.
    for (const [k, v] of req.headers.entries()) {
      const lower = k.toLowerCase();
      if (
        lower.startsWith("x-amz-meta-") ||
        lower.startsWith("x-amz-tagging") ||
        lower === "x-amz-acl" ||
        lower === "x-amz-copy-source" ||
        lower === "x-amz-copy-source-if-match" ||
        lower === "x-amz-copy-source-if-none-match"
      ) {
        forwardHeaders[lower] = v;
      }
    }

    const signed = await signRequest({
      method: req.method,
      url: target,
      credential: {
        accessKeyId: process.env.RUSTFS_ACCESS_KEY!,
        secretAccessKey: process.env.RUSTFS_SECRET_KEY!,
      },
      region: process.env.RUSTFS_REGION || "us-east-1",
      service: "s3",
      headers: forwardHeaders,
      payloadHash,
    });

    const upstream = await fetch(target, {
      method: req.method,
      headers: signed,
      body: body as unknown as BodyInit | undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });


    // For HEAD requests (e.g. HeadBucket, HeadObject), never return a body.
    if (req.method === "HEAD") {
      const respHeaders: Record<string, string> = {};
      for (const [k, v] of upstream.headers.entries()) {
        const lower = k.toLowerCase();
        if (
          [
            "content-type",
            "content-length",
            "etag",
            "last-modified",
            "x-amz-request-id",
            "x-amz-version-id",
            "x-amz-delete-marker",
            "x-amz-bucket-region",
            "x-amz-tagging-count",
            "x-amz-copy-source-version-id",
            "accept-ranges",
          ].includes(lower)
        ) {
          respHeaders[k] = v;
        }
      }
      return new Response(null, {
        status: upstream.status,
        headers: { ...respHeaders, ...corsHeaders() },
      });
    }

    // For ListBuckets, filter the response to the
    // account's buckets only (multi-tenant isolation).
    if (isListBuckets && upstream.ok) {
      const xmlText = await upstream.text();
      const buckets = (await ctx.runQuery(internal.s3Credentials.accountBucketIds, { accountId: cred.accountId })) as Array<{ _id: Id<"buckets">; rustfsName: string }>;
      const allowed = new Set<string>(buckets.filter((bucket) => !cred.buckets?.length || cred.buckets.includes(bucket._id)).map((bucket) => bucket.rustfsName));
      const filtered = filterListBucketsXml(xmlText, allowed);
      return new Response(filtered, {
        status: upstream.status,
        headers: {
          "content-type": "application/xml",
          ...corsHeaders(),
        },
      });
    }

    // Stream the upstream response back.
    const respHeaders: Record<string, string> = {};
    for (const [k, v] of upstream.headers.entries()) {
      const lower = k.toLowerCase();
      if (
        [
          "content-type",
          "content-length",
          "content-range",
          "etag",
          "last-modified",
          "x-amz-request-id",
          "x-amz-version-id",
          "x-amz-delete-marker",
            "x-amz-bucket-region",
            "x-amz-tagging-count",
            "x-amz-copy-source-version-id",
          "accept-ranges",
        ].includes(lower) ||
        lower.startsWith("x-amz-meta-")
      ) {
        respHeaders[k] = v;
      }
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...respHeaders, ...corsHeaders() },
    });
  } catch (err) {
    // Map storage errors to S3-style responses.
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;
    return xmlResponse(
      status >= 400 && status < 600 ? status : 500,
      code ?? "InternalError",
      err instanceof S3ProtocolError ? err.detail : status >= 500 ? "Storage operation failed" : storageErrorMessage(err),
    );
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, PUT, POST, DELETE, HEAD, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers":
      "ETag, x-amz-request-id, x-amz-version-id, x-amz-delete-marker",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

/** Filter a ListAllMyBuckets XML to only allowed bucket names. */
function filterListBucketsXml(xml: string, allowed: Set<string>): string {
  const bucketBlocks = xml.match(/<Bucket>[\s\S]*?<\/Bucket>/g) ?? [];
  const kept = bucketBlocks.filter((b) => {
    const m = /<Name>([\s\S]*?)<\/Name>/.exec(b);
    return m && m[1] ? allowed.has(m[1]) : false;
  });
  return xml.replace(
    /<Buckets>[\s\S]*?<\/Buckets>/,
    `<Buckets>${kept.join("")}</Buckets>`,
  );
}
