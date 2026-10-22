// Shared validation + error-mapping helpers for the S3 storage platform.
// Pure functions (no Convex imports) so they can be unit-tested in the
// edge-runtime test env and reused by both mutations and the gateway.

// S3 bucket naming rules (DNS-compatible subset enforced by S3/RustFS):
//   3–63 chars, lowercase letters / digits / hyphens,
//   must start and end with a letter or digit.
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function isValidBucketName(name: string): boolean {
  if (!BUCKET_NAME_RE.test(name)) return false;
  // S3 forbids two consecutive periods; we use hyphens only but keep
  // the check for completeness and future-proofing.
  if (name.includes("..")) return false;
  return true;
}

export function bucketNameError(name: string): string | null {
  if (typeof name !== "string" || name.length === 0)
    return "Bucket name is required.";
  if (name.length < 3 || name.length > 63)
    return "Bucket name must be 3–63 characters.";
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name))
    return "Bucket name must start and end with a letter or number.";
  if (!/^[a-z0-9-]+$/.test(name))
    return "Bucket name may only contain lowercase letters, numbers and hyphens.";
  if (name.includes(".."))
    return "Bucket name may not contain consecutive periods.";
  return null;
}

// Object keys: non-empty, reasonable length, no leading slash, no
// control characters. Slashes are allowed (they act as "folders").
export function isValidObjectKey(key: string): boolean {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 1024
  )
    return false;
  if (key.startsWith("/") || key.endsWith("/")) return false;
  if (key.includes("//")) return false;
  // Reject control characters.
  for (const ch of key) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

export function objectKeyError(key: string): string | null {
  if (typeof key !== "string" || key.length === 0)
    return "Object key is required.";
  if (key.length > 1024) return "Object key is too long (max 1024).";
  if (key.startsWith("/") || key.endsWith("/"))
    return "Object key must not start or end with a slash.";
  if (key.includes("//")) return "Object key must not contain empty segments.";
  return null;
}

// Storage account name: human-friendly label.
export function accountNameError(name: string): string | null {
  if (typeof name !== "string" || name.trim().length === 0)
    return "Account name is required.";
  if (name.length > 64) return "Account name must be 64 characters or fewer.";
  return null;
}

// --- S3 action vocabulary used for credential scoping ---
export const S3_ACTIONS = [
  "s3:ListBucket",
  "s3:GetObject",
  "s3:PutObject",
  "s3:DeleteObject",
  "s3:CreateBucket",
  "s3:DeleteBucket",
  "s3:GetBucketLocation",
  "s3:GetBucketCors",
  "s3:PutBucketCors",
  "s3:GetBucketTagging",
  "s3:PutBucketTagging",
  "s3:GetBucketVersioning",
  "s3:PutBucketVersioning",
  "s3:ListBucketVersions",
  "s3:GetObjectTagging",
  "s3:PutObjectTagging",
  "s3:DeleteObjectTagging",
  "s3:GetObjectVersion",
  "s3:DeleteObjectVersion",
] as const;
export type S3Action = (typeof S3_ACTIONS)[number];

export function isValidS3Action(a: string): boolean {
  return (S3_ACTIONS as readonly string[]).includes(a);
}

/**
 * Map an S3 request (method + path + query) to the S3 action it
 * performs. Used by the gateway to enforce per-credential action scope.
 */
export function s3ActionForRequest(opts: {
  method: string;
  path: string;
  query: URLSearchParams;
}): S3Action | "s3:ListAllMyBuckets" {
  const { method, path, query } = opts;
  const isBucketRoot = path === "/" || path === "";
  if (isBucketRoot && method === "GET") return "s3:ListAllMyBuckets";

  const isObject = path.split("/").filter(Boolean).length >= 2;
  if (!isObject) {
    // Bucket-level operation.
    if (query.has("location")) return "s3:GetBucketLocation";
    if (query.has("cors")) {
      if (method === "GET") return "s3:GetBucketCors";
      if (method === "PUT" || method === "DELETE") return "s3:PutBucketCors";
    }
    if (query.has("tagging")) {
      if (method === "GET") return "s3:GetBucketTagging";
      if (method === "PUT" || method === "DELETE") return "s3:PutBucketTagging";
    }
    if (query.has("versioning")) {
      if (method === "GET") return "s3:GetBucketVersioning";
      if (method === "PUT") return "s3:PutBucketVersioning";
    }
    if (query.has("versions")) return "s3:ListBucketVersions";
    if (query.has("delete") && method === "POST") return "s3:DeleteObject";
    if (query.has("uploads")) {
      if (method === "GET") return "s3:ListBucket";
    }

    if (method === "GET") return "s3:ListBucket";
    if (method === "PUT") return "s3:CreateBucket";
    if (method === "DELETE") return "s3:DeleteBucket";
    if (method === "HEAD") return "s3:ListBucket";
  }

  // Object-level operation.
  if (query.has("tagging")) {
    if (method === "GET") return "s3:GetObjectTagging";
    if (method === "PUT") return "s3:PutObjectTagging";
    if (method === "DELETE") return "s3:DeleteObjectTagging";
  }
  if (query.has("uploads")) {
    if (method === "POST") return "s3:PutObject";
  }
  if (query.has("uploadId")) {
    if (method === "PUT") return "s3:PutObject";
    if (method === "POST") return "s3:PutObject";
    if (method === "DELETE") return "s3:DeleteObject";
    if (method === "GET") return "s3:GetObject";
  }
  if (query.has("versionId")) {
    if (method === "GET" || method === "HEAD") return "s3:GetObjectVersion";
    if (method === "DELETE") return "s3:DeleteObjectVersion";
  }

  if (method === "GET" && !query.has("uploads")) return "s3:GetObject";
  if (method === "PUT" && !query.has("partNumber") && !query.has("uploadId"))
    return "s3:PutObject";
  if (method === "DELETE") return "s3:DeleteObject";
  if (method === "HEAD") return "s3:GetObject";
  return "s3:GetObject";
}

/** Extract the bucket name from an S3 path-style request path. */
export function bucketFromPath(path: string): string | null {
  const seg = path.split("/").filter(Boolean);
  return seg.length >= 1 && seg[0] ? decodeURIComponent(seg[0]) : null;
}

/** Extract the object key from an S3 path-style request path. */
export function keyFromPath(path: string): string | null {
  const seg = path.split("/").filter(Boolean);
  if (seg.length < 2) return null;
  return seg.slice(1).map(decodeURIComponent).join("/");
}

// --- Quota helpers ---
export function quotaStatus(opts: {
  usedBytes: number;
  quotaBytes: number;
}): { ok: boolean; used: number; quota: number; pct: number } {
  const pct =
    opts.quotaBytes > 0
      ? Math.round((opts.usedBytes / opts.quotaBytes) * 100)
      : 0;
  return {
    ok: opts.usedBytes <= opts.quotaBytes,
    used: opts.usedBytes,
    quota: opts.quotaBytes,
    pct,
  };
}

// --- Provisioning helpers ---

/**
 * Build the default private bucket name for a user, e.g. "harshitha" ->
 * "harshitha-storage". Usernames are already lowercase alphanumeric; the
 * email fallback is slugified. Always returns a lowercase DNS-safe name.
 */
export function privateBucketNameForUser(opts: {
  username?: string;
  email?: string;
  userId: string;
}): string {
  const clean = (opts.username ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (clean.length >= 3) return `${clean.slice(0, 40)}-storage`;
  const emailPrefix = (opts.email ?? "")
    .split("@")[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (emailPrefix && emailPrefix.length >= 3)
    return `${emailPrefix.slice(0, 40)}-storage`;
  return `user-${opts.userId.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, "")}-storage`;
}

// --- Error mapping: RustfsError / storage error → user message ---
export function storageErrorMessage(
  err: unknown,
): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code?: string; message?: string; status?: number };
    switch (e.code) {
      case "BucketAlreadyExists":
        return "A bucket with this name already exists.";
      case "BucketAlreadyOwnedByYou":
        return "You already own a bucket with this name.";
      case "NoSuchBucket":
        return "The bucket does not exist.";
      case "NoSuchKey":
        return "The object does not exist.";
      case "AccessDenied":
        return "Access denied.";
      case "InvalidBucketName":
        return "Invalid bucket name.";
      case "InvalidObjectName":
        return "Invalid object name.";
      case "EntityTooLarge":
        return "The object is too large.";
      case "SignatureDoesNotMatch":
        return "The request signature is invalid.";
      case "InvalidAccessKeyId":
        return "The access key is invalid.";
      case "RequestTimeTooSkewed":
        return "The request timestamp is invalid.";
      case "ExpiredToken":
        return "The request has expired.";
    }
    if (e.status === 409)
      return "The bucket is not empty (or a conflict occurred).";
    if (e.status === 403) return "Access denied.";
    if (e.status === 404) return "Not found.";
    if (e.status === 413) return "The object is too large.";
    return e.message ?? "Storage operation failed.";
  }
  if (err instanceof Error) return err.message;
  return "Storage operation failed.";
}
