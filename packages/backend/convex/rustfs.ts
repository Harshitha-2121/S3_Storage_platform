// Low-level RustFS (S3-compatible) client.
//
// Every request is signed with AWS SigV4 using the *server-side* root
// credentials held in Convex environment variables. These credentials are
// NEVER exposed to the browser and are only used inside Convex actions /
// the HTTP gateway.
//
// This module contains no Convex types so it can also be imported by the
// HTTP gateway and by standalone integration tests.

import {
  type Credential,
  EMPTY_PAYLOAD_HASH,
  UNSIGNED_PAYLOAD,
  presignUrl,
  sha256Hex,
  signRequest,
} from "./sigv4";

export type RustfsConfig = {
  endpoint: string;
  /** Browser-facing base URL for presigned URLs (defaults to endpoint). */
  publicEndpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

/** Build the config from the deployment's server-side env vars. */
export function configFromEnv(): RustfsConfig {
  const endpoint =
    process.env.RUSTFS_ENDPOINT ||
    (typeof process !== "undefined" && process.env.CONVEX_SELF_HOSTED_URL
      ? "http://rustfs:9000"
      : "http://127.0.0.1:9000");
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY || "HarshithaDev2026";
  const secretAccessKey =
    process.env.RUSTFS_SECRET_KEY || "LocalDevSecret-Change-This-9284";
  return {
    endpoint,
    // Browsers cannot reach container-internal names (e.g. http://rustfs:9000),
    // so presigned URLs use the public endpoint. Server-side fetches always
    // use `endpoint`.
    publicEndpoint:
      process.env.RUSTFS_PUBLIC_ENDPOINT ||
      (endpoint.includes("rustfs") ? "http://127.0.0.1:9000" : endpoint),
    accessKeyId,
    secretAccessKey,
    region: process.env.RUSTFS_REGION || "us-east-1",
  };
}

export class RustfsError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Minimal XML text extraction: first <tag>value</tag> match. */
function xmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(xml);
  if (!m || !m[1]) return undefined;
  return m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** All matches of a tag (for repeated <Contents> blocks). */
function xmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) {
      out.push(
        m[1]
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&"),
      );
    }
  }
  return out;
}

function parseError(status: number, text: string): RustfsError {
  const code = xmlTag(text, "Code") ?? "UnknownError";
  const message = xmlTag(text, "Message") ?? `HTTP ${status}`;
  return new RustfsError(status, code, message);
}

async function rustfsFetch(
  cfg: RustfsConfig,
  method: string,
  path: string,
  opts: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: Uint8Array;
    payloadHash?: string;
  } = {},
): Promise<Response> {
  const url = new URL(cfg.endpoint + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  // Compute the payload hash unless the caller supplied one (e.g. a
  // declared hash for streaming, or UNSIGNED-PAYLOAD for presigned).
  let payloadHash = opts.payloadHash;
  if (payloadHash === undefined) {
    payloadHash = opts.body ? await sha256Hex(opts.body) : EMPTY_PAYLOAD_HASH;
  }
  const headers = await signRequest({
    method,
    url,
    credential: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    region: cfg.region,
    service: "s3",
    headers: opts.headers ?? {},
    payloadHash,
  });
  return fetch(url, {
    method,
    headers,
    body: opts.body,
    signal: AbortSignal.timeout(30_000),
  });
}

async function expectOk(
  cfg: RustfsConfig,
  method: string,
  path: string,
  opts?: Parameters<typeof rustfsFetch>[3],
): Promise<Response> {
  const res = await rustfsFetch(cfg, method, path, opts);
  if (!res.ok) {
    const text = await res.text();
    throw parseError(res.status, text);
  }
  return res;
}

// --- Bucket operations ---

export type RustfsBucket = { name: string; createdAt: string };

export async function listBuckets(cfg: RustfsConfig): Promise<RustfsBucket[]> {
  const res = await expectOk(cfg, "GET", "/");
  const xml = await res.text();
  const names = xmlTags(xml, "Name");
  const dates = xmlTags(xml, "CreationDate");
  return names.map((name, i) => ({ name, createdAt: dates[i] ?? "" }));
}

export async function createBucket(
  cfg: RustfsConfig,
  name: string,
): Promise<void> {
  // RustFS/MinIO accept an empty body for CreateBucket.
  const body = new TextEncoder().encode(
    `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${cfg.region}</LocationConstraint></CreateBucketConfiguration>`,
  );
  await expectOk(cfg, "PUT", `/${name}`, {
    headers: { "content-type": "application/xml" },
    body,
  });
}

// Dashboard origins allowed to use presigned URLs directly from the browser.
// Without this, browser PUT/GET to RustFS fails CORS preflight ("Failed to fetch")
// while curl/SDK uploads keep working.
const BROWSER_CORS_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

/** Set bucket CORS so browser direct uploads/downloads work. Best-effort caller-side. */
export async function putBucketCors(
  cfg: RustfsConfig,
  name: string,
): Promise<void> {
  const origins = BROWSER_CORS_ORIGINS.map(
    (o) => `<AllowedOrigin>${o}</AllowedOrigin>`,
  ).join("");
  const body = new TextEncoder().encode(
    `<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><CORSRule>${origins}<AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>DELETE</AllowedMethod><AllowedHeader>*</AllowedHeader></CORSRule></CORSConfiguration>`,
  );
  await expectOk(cfg, "PUT", `/${name}`, {
    query: { cors: "" },
    headers: { "content-type": "application/xml" },
    body,
  });
}

export async function getBucketCors(
  cfg: RustfsConfig,
  name: string,
): Promise<string | null> {
  try {
    const res = await expectOk(cfg, "GET", `/${name}`, { query: { cors: "" } });
    return await res.text();
  } catch (e) {
    if (
      e instanceof RustfsError &&
      (e.code === "NoSuchCORSConfiguration" || e.status === 404)
    ) {
      return null;
    }
    throw e;
  }
}

export async function deleteBucketCors(
  cfg: RustfsConfig,
  name: string,
): Promise<void> {
  await expectOk(cfg, "DELETE", `/${name}`, { query: { cors: "" } });
}

// --- Bucket Tagging & Versioning ---

export async function getBucketTagging(
  cfg: RustfsConfig,
  name: string,
): Promise<Array<{ key: string; value: string }>> {
  try {
    const res = await expectOk(cfg, "GET", `/${name}`, {
      query: { tagging: "" },
    });
    const xml = await res.text();
    const blocks = xml.match(/<Tag>[\s\S]*?<\/Tag>/g) ?? [];
    return blocks.map((b) => ({
      key: xmlTag(b, "Key") ?? "",
      value: xmlTag(b, "Value") ?? "",
    }));
  } catch (e) {
    if (
      e instanceof RustfsError &&
      (e.code === "NoSuchTagSet" || e.status === 404)
    ) {
      return [];
    }
    throw e;
  }
}

export async function putBucketTagging(
  cfg: RustfsConfig,
  name: string,
  tags: Array<{ key: string; value: string }>,
): Promise<void> {
  const tagXml = tags
    .map(
      (t) =>
        `<Tag><Key>${escapeXmlTag(t.key)}</Key><Value>${escapeXmlTag(t.value)}</Value></Tag>`,
    )
    .join("");
  const body = new TextEncoder().encode(
    `<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet>${tagXml}</TagSet></Tagging>`,
  );
  await expectOk(cfg, "PUT", `/${name}`, {
    query: { tagging: "" },
    headers: { "content-type": "application/xml" },
    body,
  });
}

export async function deleteBucketTagging(
  cfg: RustfsConfig,
  name: string,
): Promise<void> {
  await expectOk(cfg, "DELETE", `/${name}`, { query: { tagging: "" } });
}

export async function getBucketVersioning(
  cfg: RustfsConfig,
  name: string,
): Promise<"Enabled" | "Suspended" | "Off"> {
  const res = await expectOk(cfg, "GET", `/${name}`, {
    query: { versioning: "" },
  });
  const xml = await res.text();
  const status = xmlTag(xml, "Status");
  if (status === "Enabled") return "Enabled";
  if (status === "Suspended") return "Suspended";
  return "Off";
}

export async function putBucketVersioning(
  cfg: RustfsConfig,
  name: string,
  status: "Enabled" | "Suspended",
): Promise<void> {
  const body = new TextEncoder().encode(
    `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>${status}</Status></VersioningConfiguration>`,
  );
  await expectOk(cfg, "PUT", `/${name}`, {
    query: { versioning: "" },
    headers: { "content-type": "application/xml" },
    body,
  });
}

function escapeXmlTag(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** true when the bucket exists and is accessible. */
export async function headBucket(
  cfg: RustfsConfig,
  name: string,
): Promise<boolean> {
  try {
    await expectOk(cfg, "HEAD", `/${name}`);
    return true;
  } catch (e) {
    if (
      e instanceof RustfsError &&
      (e.code === "NoSuchBucket" || e.code === "NotFound" || e.status === 404)
    ) {
      return false;
    }
    throw e;
  }
}

export async function deleteBucket(
  cfg: RustfsConfig,
  name: string,
): Promise<void> {
  await expectOk(cfg, "DELETE", `/${name}`);
}

export async function getBucketLocation(
  cfg: RustfsConfig,
  name: string,
): Promise<string> {
  const res = await expectOk(cfg, "GET", `/${name}`, {
    query: { location: "" },
  });
  const xml = await res.text();
  const constraint = xmlTag(xml, "LocationConstraint");
  return constraint || cfg.region || "us-east-1";
}

// --- Object operations ---

export type RustfsObject = {
  key: string;
  size: number;
  etag: string;
  lastModified: string;
  contentType?: string;
};

export async function putObject(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ etag: string }> {
  const res = await expectOk(cfg, "PUT", `/${bucket}/${encodeKey(key)}`, {
    headers: { "content-type": contentType },
    body,
  });
  return { etag: res.headers.get("etag") ?? "" };
}

export type HeadObjectResult = {
  size: number;
  contentType: string;
  etag: string;
  lastModified: string;
  versionId?: string;
  deleteMarker?: boolean;
};

export async function headObject(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  versionId?: string,
): Promise<HeadObjectResult | null> {
  try {
    const query = versionId ? { versionId } : undefined;
    const res = await expectOk(cfg, "HEAD", `/${bucket}/${encodeKey(key)}`, {
      query,
    });
    return {
      size: Number(res.headers.get("content-length") ?? "0"),
      contentType:
        res.headers.get("content-type") ?? "application/octet-stream",
      etag: res.headers.get("etag") ?? "",
      lastModified: res.headers.get("last-modified") ?? "",
      versionId: res.headers.get("x-amz-version-id") ?? undefined,
      deleteMarker: res.headers.get("x-amz-delete-marker") === "true",
    };
  } catch (e) {
    if (
      e instanceof RustfsError &&
      (e.status === 404 || e.code === "NoSuchKey" || e.code === "NotFound")
    ) {
      return null;
    }
    throw e;
  }
}

export type DeleteObjectResult = {
  deleteMarker?: boolean;
  versionId?: string;
};

export async function deleteObject(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  versionId?: string,
): Promise<DeleteObjectResult> {
  const query = versionId ? { versionId } : undefined;
  const res = await expectOk(cfg, "DELETE", `/${bucket}/${encodeKey(key)}`, {
    query,
  });
  return {
    deleteMarker: res.headers.get("x-amz-delete-marker") === "true",
    versionId: res.headers.get("x-amz-version-id") ?? undefined,
  };
}

export type DeleteObjectsResult = {
  deleted: Array<{
    key: string;
    versionId?: string;
    deleteMarker?: boolean;
    deleteMarkerVersionId?: string;
  }>;
  errors: Array<{
    key: string;
    versionId?: string;
    code: string;
    message: string;
  }>;
};

export async function deleteObjects(
  cfg: RustfsConfig,
  bucket: string,
  objects: Array<{ key: string; versionId?: string }>,
  quiet = false,
): Promise<DeleteObjectsResult> {
  const objXml = objects
    .map(
      (o) =>
        `<Object><Key>${escapeXmlTag(o.key)}</Key>${
          o.versionId ? `<VersionId>${escapeXmlTag(o.versionId)}</VersionId>` : ""
        }</Object>`,
    )
    .join("");
  const quietXml = quiet ? "<Quiet>true</Quiet>" : "";
  const body = new TextEncoder().encode(
    `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${quietXml}${objXml}</Delete>`,
  );
  const res = await expectOk(cfg, "POST", `/${bucket}`, {
    query: { delete: "" },
    headers: { "content-type": "application/xml" },
    body,
  });
  const xml = await res.text();
  const delBlocks = xml.match(/<Deleted>[\s\S]*?<\/Deleted>/g) ?? [];
  const deleted = delBlocks.map((b) => ({
    key: xmlTag(b, "Key") ?? "",
    versionId: xmlTag(b, "VersionId"),
    deleteMarker: xmlTag(b, "DeleteMarker") === "true",
    deleteMarkerVersionId: xmlTag(b, "DeleteMarkerVersionId"),
  }));
  const errBlocks = xml.match(/<Error>[\s\S]*?<\/Error>/g) ?? [];
  const errors = errBlocks.map((b) => ({
    key: xmlTag(b, "Key") ?? "",
    versionId: xmlTag(b, "VersionId"),
    code: xmlTag(b, "Code") ?? "InternalError",
    message: xmlTag(b, "Message") ?? "",
  }));
  return { deleted, errors };
}

export async function getObjectTagging(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  versionId?: string,
): Promise<Array<{ key: string; value: string }>> {
  try {
    const query: Record<string, string> = { tagging: "" };
    if (versionId) query.versionId = versionId;
    const res = await expectOk(cfg, "GET", `/${bucket}/${encodeKey(key)}`, {
      query,
    });
    const xml = await res.text();
    const blocks = xml.match(/<Tag>[\s\S]*?<\/Tag>/g) ?? [];
    return blocks.map((b) => ({
      key: xmlTag(b, "Key") ?? "",
      value: xmlTag(b, "Value") ?? "",
    }));
  } catch (e) {
    if (
      e instanceof RustfsError &&
      (e.code === "NoSuchTagSet" || e.status === 404)
    ) {
      return [];
    }
    throw e;
  }
}

export async function putObjectTagging(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  tags: Array<{ key: string; value: string }>,
  versionId?: string,
): Promise<void> {
  const tagXml = tags
    .map(
      (t) =>
        `<Tag><Key>${escapeXmlTag(t.key)}</Key><Value>${escapeXmlTag(t.value)}</Value></Tag>`,
    )
    .join("");
  const body = new TextEncoder().encode(
    `<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet>${tagXml}</TagSet></Tagging>`,
  );
  const query: Record<string, string> = { tagging: "" };
  if (versionId) query.versionId = versionId;
  await expectOk(cfg, "PUT", `/${bucket}/${encodeKey(key)}`, {
    query,
    headers: { "content-type": "application/xml" },
    body,
  });
}

export async function deleteObjectTagging(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  versionId?: string,
): Promise<void> {
  const query: Record<string, string> = { tagging: "" };
  if (versionId) query.versionId = versionId;
  await expectOk(cfg, "DELETE", `/${bucket}/${encodeKey(key)}`, { query });
}

export type RustfsObjectVersion = {
  key: string;
  versionId: string;
  isLatest: boolean;
  lastModified: string;
  etag?: string;
  size?: number;
};

export type RustfsDeleteMarker = {
  key: string;
  versionId: string;
  isLatest: boolean;
  lastModified: string;
};

export type ListObjectVersionsResult = {
  bucket: string;
  prefix: string;
  keyMarker?: string;
  versionIdMarker?: string;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
  maxKeys: number;
  isTruncated: boolean;
  versions: RustfsObjectVersion[];
  deleteMarkers: RustfsDeleteMarker[];
};

export async function listObjectVersions(
  cfg: RustfsConfig,
  bucket: string,
  opts: {
    prefix?: string;
    delimiter?: string;
    keyMarker?: string;
    versionIdMarker?: string;
    maxKeys?: number;
  } = {},
): Promise<ListObjectVersionsResult> {
  const query: Record<string, string> = { versions: "" };
  if (opts.prefix) query.prefix = opts.prefix;
  if (opts.delimiter) query.delimiter = opts.delimiter;
  if (opts.keyMarker) query["key-marker"] = opts.keyMarker;
  if (opts.versionIdMarker) query["version-id-marker"] = opts.versionIdMarker;
  if (opts.maxKeys !== undefined) query["max-keys"] = String(opts.maxKeys);
  const res = await expectOk(cfg, "GET", `/${bucket}`, { query });
  const xml = await res.text();

  const versionBlocks = xml.match(/<Version>[\s\S]*?<\/Version>/g) ?? [];
  const versions: RustfsObjectVersion[] = versionBlocks.map((b) => ({
    key: xmlTag(b, "Key") ?? "",
    versionId: xmlTag(b, "VersionId") ?? "",
    isLatest: xmlTag(b, "IsLatest") === "true",
    lastModified: xmlTag(b, "LastModified") ?? "",
    etag: (xmlTag(b, "ETag") ?? "").replace(/"/g, ""),
    size: Number(xmlTag(b, "Size") ?? "0"),
  }));

  const dmBlocks = xml.match(/<DeleteMarker>[\s\S]*?<\/DeleteMarker>/g) ?? [];
  const deleteMarkers: RustfsDeleteMarker[] = dmBlocks.map((b) => ({
    key: xmlTag(b, "Key") ?? "",
    versionId: xmlTag(b, "VersionId") ?? "",
    isLatest: xmlTag(b, "IsLatest") === "true",
    lastModified: xmlTag(b, "LastModified") ?? "",
  }));

  return {
    bucket: xmlTag(xml, "Name") ?? bucket,
    prefix: xmlTag(xml, "Prefix") ?? (opts.prefix ?? ""),
    keyMarker: xmlTag(xml, "KeyMarker"),
    versionIdMarker: xmlTag(xml, "VersionIdMarker"),
    nextKeyMarker: xmlTag(xml, "NextKeyMarker"),
    nextVersionIdMarker: xmlTag(xml, "NextVersionIdMarker"),
    maxKeys: Number(xmlTag(xml, "MaxKeys") ?? "1000"),
    isTruncated: xmlTag(xml, "IsTruncated") === "true",
    versions,
    deleteMarkers,
  };
}

export async function copyObject(
  cfg: RustfsConfig,
  srcBucket: string,
  srcKey: string,
  destBucket: string,
  destKey: string,
): Promise<void> {
  await expectOk(cfg, "PUT", `/${destBucket}/${encodeKey(destKey)}`, {
    headers: {
      "x-amz-copy-source": `/${srcBucket}/${encodeKey(srcKey)}`,
    },
  });
}

export type ListObjectsResult = {
  objects: RustfsObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
  prefix: string;
};

export async function listObjectsV2(
  cfg: RustfsConfig,
  bucket: string,
  opts: {
    prefix?: string;
    continuationToken?: string;
    maxKeys?: number;
    delimiter?: string;
  } = {},
): Promise<ListObjectsResult> {
  const query: Record<string, string> = { "list-type": "2" };
  if (opts.prefix) query.prefix = opts.prefix;
  if (opts.continuationToken)
    query["continuation-token"] = opts.continuationToken;
  if (opts.maxKeys) query["max-keys"] = String(opts.maxKeys);
  if (opts.delimiter) query.delimiter = opts.delimiter;
  const res = await expectOk(cfg, "GET", `/${bucket}`, { query });
  const xml = await res.text();

  // Each <Contents> block is parsed as a unit so multi-line values
  // (e.g. keys with encoded chars) stay intact.
  const blocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
  const objects: RustfsObject[] = blocks.map((b) => ({
    key: xmlTag(b, "Key") ?? "",
    size: Number(xmlTag(b, "Size") ?? "0"),
    etag: (xmlTag(b, "ETag") ?? "").replace(/"/g, ""),
    lastModified: xmlTag(b, "LastModified") ?? "",
  }));
  return {
    objects,
    isTruncated: xmlTag(xml, "IsTruncated") === "true",
    nextContinuationToken: xmlTag(xml, "NextContinuationToken"),
    prefix: opts.prefix ?? "",
  };
}

// --- Presigned URLs (browser talks directly to RustFS) ---

export async function presignPut(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  contentType: string,
  expiresSecs: number,
): Promise<string> {
  const url = new URL(
    `${cfg.publicEndpoint ?? cfg.endpoint}/${bucket}/${encodeKey(key)}`,
  );
  return presignUrl({
    method: "PUT",
    url,
    credential: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    region: cfg.region,
    service: "s3",
    expiresSecs,
  });
}

export async function presignGet(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  expiresSecs: number,
  versionId?: string,
): Promise<string> {
  const url = new URL(
    `${cfg.publicEndpoint ?? cfg.endpoint}/${bucket}/${encodeKey(key)}`,
  );
  if (versionId) url.searchParams.set("versionId", versionId);
  return presignUrl({
    method: "GET",
    url,
    credential: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    region: cfg.region,
    service: "s3",
    expiresSecs,
  });
}

// --- Multipart upload (large objects) ---

export async function createMultipartUpload(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  contentType: string,
): Promise<string> {
  const res = await expectOk(cfg, "POST", `/${bucket}/${encodeKey(key)}`, {
    query: { uploads: "" },
    headers: { "content-type": contentType },
  });
  const xml = await res.text();
  return xmlTag(xml, "UploadId") ?? "";
}

export async function uploadPart(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  body: Uint8Array,
): Promise<string> {
  const res = await expectOk(cfg, "PUT", `/${bucket}/${encodeKey(key)}`, {
    query: { partNumber: String(partNumber), uploadId },
    body,
  });
  return res.headers.get("etag") ?? "";
}

export async function completeMultipartUpload(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<void> {
  const body = new TextEncoder().encode(
    `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${parts
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`,
      )
      .join("")}</CompleteMultipartUpload>`,
  );
  await expectOk(cfg, "POST", `/${bucket}/${encodeKey(key)}`, {
    query: { uploadId },
    headers: { "content-type": "application/xml" },
    body,
  });
}

export async function abortMultipartUpload(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> {
  await expectOk(cfg, "DELETE", `/${bucket}/${encodeKey(key)}`, {
    query: { uploadId },
  });
}

export type RustfsPart = {
  partNumber: number;
  etag: string;
  size: number;
  lastModified: string;
};

export type ListPartsResult = {
  bucket: string;
  key: string;
  uploadId: string;
  partNumberMarker: number;
  nextPartNumberMarker?: number;
  maxParts: number;
  isTruncated: boolean;
  parts: RustfsPart[];
};

export async function listParts(
  cfg: RustfsConfig,
  bucket: string,
  key: string,
  uploadId: string,
  opts: {
    maxParts?: number;
    partNumberMarker?: number;
  } = {},
): Promise<ListPartsResult> {
  const query: Record<string, string> = { uploadId };
  if (opts.maxParts !== undefined) query["max-parts"] = String(opts.maxParts);
  if (opts.partNumberMarker !== undefined)
    query["part-number-marker"] = String(opts.partNumberMarker);
  const res = await expectOk(cfg, "GET", `/${bucket}/${encodeKey(key)}`, {
    query,
  });
  const xml = await res.text();
  const blocks = xml.match(/<Part>[\s\S]*?<\/Part>/g) ?? [];
  const parts: RustfsPart[] = blocks.map((b) => ({
    partNumber: Number(xmlTag(b, "PartNumber") ?? "0"),
    etag: (xmlTag(b, "ETag") ?? "").replace(/"/g, ""),
    size: Number(xmlTag(b, "Size") ?? "0"),
    lastModified: xmlTag(b, "LastModified") ?? "",
  }));
  return {
    bucket: xmlTag(xml, "Bucket") ?? bucket,
    key: xmlTag(xml, "Key") ?? key,
    uploadId: xmlTag(xml, "UploadId") ?? uploadId,
    partNumberMarker: Number(xmlTag(xml, "PartNumberMarker") ?? "0"),
    nextPartNumberMarker: xmlTag(xml, "NextPartNumberMarker")
      ? Number(xmlTag(xml, "NextPartNumberMarker"))
      : undefined,
    maxParts: Number(xmlTag(xml, "MaxParts") ?? "1000"),
    isTruncated: xmlTag(xml, "IsTruncated") === "true",
    parts,
  };
}

export type RustfsUpload = {
  key: string;
  uploadId: string;
  initiated: string;
  storageClass?: string;
};

export type ListMultipartUploadsResult = {
  bucket: string;
  keyMarker?: string;
  uploadIdMarker?: string;
  nextKeyMarker?: string;
  nextUploadIdMarker?: string;
  maxUploads: number;
  isTruncated: boolean;
  uploads: RustfsUpload[];
};

export async function listMultipartUploads(
  cfg: RustfsConfig,
  bucket: string,
  opts: {
    delimiter?: string;
    prefix?: string;
    maxUploads?: number;
    keyMarker?: string;
    uploadIdMarker?: string;
  } = {},
): Promise<ListMultipartUploadsResult> {
  const query: Record<string, string> = { uploads: "" };
  if (opts.delimiter) query.delimiter = opts.delimiter;
  if (opts.prefix) query.prefix = opts.prefix;
  if (opts.maxUploads !== undefined)
    query["max-uploads"] = String(opts.maxUploads);
  if (opts.keyMarker) query["key-marker"] = opts.keyMarker;
  if (opts.uploadIdMarker) query["upload-id-marker"] = opts.uploadIdMarker;
  const res = await expectOk(cfg, "GET", `/${bucket}`, { query });
  const xml = await res.text();
  const blocks = xml.match(/<Upload>[\s\S]*?<\/Upload>/g) ?? [];
  const uploads: RustfsUpload[] = blocks.map((b) => ({
    key: xmlTag(b, "Key") ?? "",
    uploadId: xmlTag(b, "UploadId") ?? "",
    initiated: xmlTag(b, "Initiated") ?? "",
    storageClass: xmlTag(b, "StorageClass"),
  }));
  return {
    bucket: xmlTag(xml, "Bucket") ?? bucket,
    keyMarker: xmlTag(xml, "KeyMarker"),
    uploadIdMarker: xmlTag(xml, "UploadIdMarker"),
    nextKeyMarker: xmlTag(xml, "NextKeyMarker"),
    nextUploadIdMarker: xmlTag(xml, "NextUploadIdMarker"),
    maxUploads: Number(xmlTag(xml, "MaxUploads") ?? "1000"),
    isTruncated: xmlTag(xml, "IsTruncated") === "true",
    uploads,
  };
}

/** Encode an object key for a path-style URL (slashes preserved). */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export { UNSIGNED_PAYLOAD };
