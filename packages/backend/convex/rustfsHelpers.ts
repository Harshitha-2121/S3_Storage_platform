// A configured RustFS client bound to the deployment's
// server-side env vars. Lazily resolves config so the
// functions can be called directly from Convex actions.
//
// Every function signs with the root credentials held in
// Convex env vars — these never reach the browser.

import type {
  HeadObjectResult,
  ListObjectsResult,
  RustfsBucket,
  RustfsObject,
} from "./rustfs";
import {
  configFromEnv,
  copyObject as copyObjectRaw,
  createBucket as createBucketRaw,
  deleteBucket as deleteBucketRaw,
  deleteObject as deleteObjectRaw,
  headBucket as headBucketRaw,
  headObject as headObjectRaw,
  listBuckets as listBucketsRaw,
  listObjectsV2 as listObjectsV2Raw,
  presignGet as presignGetRaw,
  presignPut as presignPutRaw,
  putBucketCors as putBucketCorsRaw,
  getBucketCors as getBucketCorsRaw,
  deleteBucketCors as deleteBucketCorsRaw,
  getBucketTagging as getBucketTaggingRaw,
  putBucketTagging as putBucketTaggingRaw,
  deleteBucketTagging as deleteBucketTaggingRaw,
  getBucketVersioning as getBucketVersioningRaw,
  putBucketVersioning as putBucketVersioningRaw,
  putObject as putObjectRaw,
  type RustfsConfig,
  RustfsError,
} from "./rustfs";
export { RustfsError };

let cached: RustfsConfig | null = null;

function cfg(): RustfsConfig {
  if (!cached) cached = configFromEnv();
  return cached;
}

/** List objects args (mirrors rustfs.listObjectsV2). */
export type ListObjectsV2Args = {
  prefix?: string;
  continuationToken?: string;
  maxKeys?: number;
  delimiter?: string;
};

// Static imports (not dynamic import()): dynamic module imports are
// unsupported inside Convex query/mutation isolates, and presign* (pure
// SigV4 crypto, no network) must stay callable from mutations.
export const rustfs = {
  listBuckets: (): Promise<RustfsBucket[]> => listBucketsRaw(cfg()),
  createBucket: (name: string): Promise<void> => createBucketRaw(cfg(), name),
  putBucketCors: (name: string): Promise<void> => putBucketCorsRaw(cfg(), name),
  getBucketCors: (name: string): Promise<string | null> => getBucketCorsRaw(cfg(), name),
  deleteBucketCors: (name: string): Promise<void> => deleteBucketCorsRaw(cfg(), name),
  getBucketTagging: (name: string): Promise<Array<{ key: string; value: string }>> =>
    getBucketTaggingRaw(cfg(), name),
  putBucketTagging: (name: string, tags: Array<{ key: string; value: string }>): Promise<void> =>
    putBucketTaggingRaw(cfg(), name, tags),
  deleteBucketTagging: (name: string): Promise<void> => deleteBucketTaggingRaw(cfg(), name),
  getBucketVersioning: (name: string): Promise<"Enabled" | "Suspended" | "Off"> =>
    getBucketVersioningRaw(cfg(), name),
  putBucketVersioning: (name: string, status: "Enabled" | "Suspended"): Promise<void> =>
    putBucketVersioningRaw(cfg(), name, status),
  headBucket: (name: string): Promise<boolean> => headBucketRaw(cfg(), name),
  deleteBucket: (name: string): Promise<void> => deleteBucketRaw(cfg(), name),
  putObject: (
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ etag: string }> => putObjectRaw(cfg(), bucket, key, body, contentType),
  headObject: (bucket: string, key: string): Promise<HeadObjectResult | null> =>
    headObjectRaw(cfg(), bucket, key),
  deleteObject: (bucket: string, key: string): Promise<void> =>
    deleteObjectRaw(cfg(), bucket, key),
  copyObject: (
    srcBucket: string,
    srcKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<void> => copyObjectRaw(cfg(), srcBucket, srcKey, destBucket, destKey),
  listObjectsV2: (bucket: string, opts?: ListObjectsV2Args): Promise<ListObjectsResult> =>
    listObjectsV2Raw(cfg(), bucket, opts),
  presignPut: (
    bucket: string,
    key: string,
    contentType: string,
    expiresSecs: number,
  ): Promise<string> => presignPutRaw(cfg(), bucket, key, contentType, expiresSecs),
  presignGet: (bucket: string, key: string, expiresSecs: number): Promise<string> =>
    presignGetRaw(cfg(), bucket, key, expiresSecs),
};

export type { RustfsObject };
