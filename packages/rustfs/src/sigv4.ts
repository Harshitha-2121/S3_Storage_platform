// AWS Signature Version 4 — dependency-free implementation on Web Crypto.
// Works in Convex queries/mutations/actions and in the edge-runtime test
// env. The signer is verified against the official AWS SigV4 test suite
// (see sigv4.test.ts), including the get-vanilla vector with the official
// suite secret wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY.
//
// Spec: https://docs.aws.amazon.com/general/latest/gr/sigv4-calculate-signature.html

export const ALGORITHM = "AWS4-HMAC-SHA256";
export const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/** Literal payload hash for presigned URLs / streamed uploads. */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const HEX_CHARS = "0123456789abcdef";
const UNRESERVED = /[A-Za-z0-9\-._~]/;

export type Credential = {
  accessKeyId: string;
  secretAccessKey: string;
};

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX_CHARS[b >> 4] + HEX_CHARS[b & 0x0f];
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf =
    typeof data === "string"
      ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))
      : await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(buf));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
  return new Uint8Array(sig);
}

export async function hmacHex(key: Uint8Array, data: string): Promise<string> {
  return toHex(await hmac(key, data));
}

/**
 * AWS UriEncode: encode every byte except A-Z a-z 0-9 - . _ ~.
 * Space becomes %20 (never +), hex digits are uppercase. When keepSlash is
 * true (object keys / canonical URIs), '/' is left unencoded.
 */
export function uriEncode(value: string, keepSlash = false): string {
  let out = "";
  for (const ch of value) {
    if (UNRESERVED.test(ch) || (keepSlash && ch === "/")) {
      out += ch;
    } else if (ch === " ") {
      out += "%20";
    } else {
      for (const byte of new TextEncoder().encode(ch)) {
        const hex = byte.toString(16).toUpperCase();
        out += "%" + (hex.length === 1 ? "0" + hex : hex);
      }
    }
  }
  return out;
}

/**
 * Canonical query string: each name/value encoded, sorted by name
 * then value. A name may map to an array of values to represent
 * repeated keys (each occurrence is sorted by its own encoded value,
 * per the AWS SigV4 test suite's get-vanilla-query-order-key).
 */
export function canonicalQuery(
  params: Record<string, string | string[]>,
): string {
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined) entries.push([k, item]);
      }
    } else {
      entries.push([k, v]);
    }
  }
  entries.sort(([an, av], [bn, bv]) => {
    const ea = uriEncode(an);
    const eb = uriEncode(bn);
    if (ea !== eb) return ea < eb ? -1 : 1;
    const va = uriEncode(av);
    const vb = uriEncode(bv);
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  return entries.map(([k, v]) => uriEncode(k) + "=" + uriEncode(v)).join("&");
}

/** URLSearchParams → query record, preserving repeated keys. */
function searchParamsToQuery(
  sp: URLSearchParams,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of sp.entries()) {
    const prev = out[k];
    if (prev === undefined) out[k] = v;
    else if (Array.isArray(prev)) prev.push(v);
    else out[k] = [prev, v];
  }
  return out;
}

export type CanonicalRequestInput = {
  method: string;
  /** Absolute path (starts with /). Slashes are preserved. */
  path: string;
  query?: Record<string, string | string[]>;
  /** Lowercase-name → raw-value headers to sign (host required). */
  headers: Record<string, string>;
  /** Alphabetical, semicolon-joined lowercase header names. */
  signedHeaders: string;
  payloadHash: string;
};

export function canonicalRequest({
  method,
  path,
  query,
  headers,
  signedHeaders,
  payloadHash,
}: CanonicalRequestInput): string {
  const canonicalUri = uriEncode(path === "" ? "/" : path, true);
  const canonicalQueryString = canonicalQuery(query ?? {});
  const names = signedHeaders.split(";").sort();
  const canonicalHeaders = names
    .map((n) => n + ":" + (headers[n] ?? "").trim().replace(/\s+/g, " ") + "\n")
    .join("");
  return [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    names.join(";"),
    payloadHash,
  ].join("\n");
}

export function stringToSign({
  timestamp,
  scope,
  canonicalRequestHash,
}: {
  /** ISO 8601 basic format, e.g. 20150830T123600Z. */
  timestamp: string;
  /** Credential scope, e.g. 20150830/us-east-1/iam/aws4_request. */
  scope: string;
  canonicalRequestHash: string;
}): string {
  return [ALGORITHM, timestamp, scope, canonicalRequestHash].join("\n");
}

/**
 * Derive the SigV4 signing key:
 *   DateKey = HMAC("AWS4"+secret, date)
 *   DateRegionKey = HMAC(DateKey, region)
 *   DateRegionServiceKey = HMAC(DateRegionKey, service)
 *   SigningKey = HMAC(DateRegionServiceKey, "aws4_request")
 */
export async function deriveSigningKey({
  secretAccessKey,
  date,
  region,
  service,
}: {
  secretAccessKey: string;
  /** YYYYMMDD */
  date: string;
  region: string;
  service: string;
}): Promise<Uint8Array> {
  const dateKey = await hmac(
    new TextEncoder().encode("AWS4" + secretAccessKey),
    date,
  );
  const dateRegionKey = await hmac(dateKey, region);
  const dateRegionServiceKey = await hmac(dateRegionKey, service);
  return hmac(dateRegionServiceKey, "aws4_request");
}

export async function signature({
  secretAccessKey,
  date,
  region,
  service,
  timestamp,
  canonicalRequestHash,
}: {
  secretAccessKey: string;
  date: string;
  region: string;
  service: string;
  timestamp: string;
  canonicalRequestHash: string;
}): Promise<string> {
  const scope = `${date}/${region}/${service}/aws4_request`;
  const sts = stringToSign({ timestamp, scope, canonicalRequestHash });
  const signingKey = await deriveSigningKey({
    secretAccessKey,
    date,
    region,
    service,
  });
  return hmacHex(signingKey, sts);
}

/** ISO 8601 basic timestamp: 20150830T123600Z */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/** YYYYMMDD */
export function amzDateShort(now: Date): string {
  return amzDate(now).slice(0, 8);
}

export type SignRequestInput = {
  method: string;
  url: URL;
  credential: Credential;
  region: string;
  service: string;
  /** Extra headers to include in the signature (e.g. content-type). */
  headers?: Record<string, string>;
  /** Payload hash; defaults to the empty-payload hash. */
  payloadHash?: string;
  now?: Date;
};

/**
 * Sign a request with SigV4 and return the headers to send (including
 * Authorization). The caller must send every returned header unchanged.
 */
export async function signRequest({
  method,
  url,
  credential,
  region,
  service,
  headers = {},
  payloadHash = EMPTY_PAYLOAD_HASH,
  now = new Date(),
}: SignRequestInput): Promise<Record<string, string>> {
  const timestamp = amzDate(now);
  const signed: Record<string, string> = {
    host: url.host,
    ...headers,
    "x-amz-date": timestamp,
    "x-amz-content-sha256": payloadHash,
  };
  const signedHeaders = Object.keys(signed)
    .map((k) => k.toLowerCase())
    .sort()
    .join(";");
  const cr = canonicalRequest({
    method,
    path: url.pathname,
    query: searchParamsToQuery(url.searchParams),
    headers: signed,
    signedHeaders,
    payloadHash,
  });
  const crHash = await sha256Hex(cr);
  const sig = await signature({
    secretAccessKey: credential.secretAccessKey,
    date: amzDateShort(now),
    region,
    service,
    timestamp,
    canonicalRequestHash: crHash,
  });
  const authorization = `${ALGORITHM} Credential=${credential.accessKeyId}/${amzDateShort(now)}/${region}/${service}/aws4_request, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  return { ...signed, authorization };
}

export type PresignInput = {
  method: string;
  url: URL;
  credential: Credential;
  region: string;
  service: string;
  /** Seconds the URL stays valid (max 604800 = 7 days). */
  expiresSecs: number;
  now?: Date;
  /**
   * Extra headers the request must carry (e.g. a content-type on a
   * browser PUT). They are covered by the signature and listed in
   * X-Amz-SignedHeaders; the caller must send them unchanged.
   */
  extraSignedHeaders?: Record<string, string>;
};

/**
 * Create a SigV4 presigned URL (query-string authentication). The payload is
 * treated as UNSIGNED-PAYLOAD, which is what browser uploads/downloads need.
 */
export async function presignUrl({
  method,
  url,
  credential,
  region,
  service,
  expiresSecs,
  now = new Date(),
  extraSignedHeaders = {},
}: PresignInput): Promise<string> {
  const timestamp = amzDate(now);
  const date = amzDateShort(now);
  const signedHeaderNames = [
    "host",
    ...Object.keys(extraSignedHeaders).map((name) => name.toLowerCase()),
  ].sort();
  const query: Record<string, string> = {
    ...searchParamsToQuery(url.searchParams),
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${credential.accessKeyId}/${date}/${region}/${service}/aws4_request`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(Math.max(1, Math.min(604800, expiresSecs))),
    "X-Amz-SignedHeaders": signedHeaderNames.join(";"),
  };
  const headers: Record<string, string> = { host: url.host };
  for (const [name, value] of Object.entries(extraSignedHeaders)) {
    headers[name.toLowerCase()] = value;
  }
  const cr = canonicalRequest({
    method,
    path: url.pathname,
    query,
    headers,
    signedHeaders: query["X-Amz-SignedHeaders"]!,
    payloadHash: UNSIGNED_PAYLOAD,
  });
  const crHash = await sha256Hex(cr);
  const sig = await signature({
    secretAccessKey: credential.secretAccessKey,
    date,
    region,
    service,
    timestamp,
    canonicalRequestHash: crHash,
  });
  const signed = new URL(url.toString());
  signed.search = "";
  for (const [k, v] of Object.entries(query)) signed.searchParams.set(k, v);
  signed.searchParams.set("X-Amz-Signature", sig);
  return signed.toString();
}
