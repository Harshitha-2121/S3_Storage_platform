// Input validation for the S3 storage layer: bucket names, object keys,
// identifiers, formatting. Pure functions — unit tested in validate.test.ts.

/** Default per-account storage allowance: 1 GiB. */
export const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;
/** Largest single presigned PUT (S3 single-PUT object limit is 5 GiB). */
export const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;
/** User-chosen bucket suffix length budget (account prefix + "-" + suffix ≤ 63). */
export const MAX_BUCKET_SUFFIX_LEN = 37;
export const MAX_OBJECT_KEY_BYTES = 1024;

const BUCKET_SUFFIX_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const FULL_BUCKET_RE = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Validate the user-chosen bucket suffix. The full S3 bucket name is
 * `<accountKey>-<suffix>` (accountKey is the per-workspace IAM identity), so
 * every tenant's buckets live in a distinct, policy-enforced namespace.
 * Returns an error message, or null when valid.
 */
export function validateBucketSuffix(suffix: string): string | null {
  if (typeof suffix !== "string" || suffix.length === 0)
    return "Bucket name is required.";
  if (suffix.length > MAX_BUCKET_SUFFIX_LEN)
    return `Bucket name must be at most ${MAX_BUCKET_SUFFIX_LEN} characters.`;
  if (!BUCKET_SUFFIX_RE.test(suffix))
    return "Bucket name must be lowercase letters, numbers and hyphens, starting and ending with a letter or number.";
  if (suffix.includes("--"))
    return "Bucket name must not contain consecutive hyphens.";
  return null;
}

/**
 * Validate a full S3 bucket name (3–63 chars, DNS rules, not IP-formatted).
 */
export function validateFullBucketName(name: string): string | null {
  if (name.length < 3 || name.length > 63)
    return "Bucket name must be 3–63 characters.";
  if (!FULL_BUCKET_RE.test(name))
    return "Bucket name must be lowercase letters, numbers, hyphens and dots, starting and ending with a letter or number.";
  if (IPV4_RE.test(name)) return "Bucket name must not be formatted as an IP address.";
  return null;
}

/**
 * Validate an S3 object key. Rejects path traversal, absolute paths, control
 * characters and over-long keys. Returns an error message, or null when valid.
 */
export function validateObjectKey(key: string): string | null {
  if (typeof key !== "string" || key.length === 0)
    return "Object key is required.";
  if (key.length > MAX_OBJECT_KEY_BYTES)
    return `Object key must be at most ${MAX_OBJECT_KEY_BYTES} characters.`;
  if (key.startsWith("/") || key.startsWith("\\"))
    return "Object key must be relative (no leading slash).";
  if (key.includes("\\")) return "Object key must not contain backslashes.";
  const segments = key.split("/");
  if (segments.some((s) => s === ".."))
    return "Object key must not contain '..' path segments.";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(key))
    return "Object key must not contain control characters.";
  return null;
}

/** Format a byte count for the dashboard (B / KB / MB / GB / TB). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const formatted = value.toFixed(unit === 0 ? 0 : 1);
  // Strip a trailing ".0" so whole numbers render as "5 MB", not "5.0 MB".
  return `${formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted} ${units[unit]}`;
}

/** Cryptographically random lowercase-hex token (e.g. IAM secrets). */
export function genToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

/** RFC 3339 UTC timestamp for service-account expiration. */
export function rfc3339(fromNowMs: number): string {
  return new Date(Date.now() + fromNowMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}
