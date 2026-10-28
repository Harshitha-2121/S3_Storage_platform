// A configured RustFS client bound to the deployment's
// server-side env vars. Lazily resolves config so the
// functions can be called directly from Convex actions.
//
// Every function signs with the root credentials held in
// Convex env vars — these never reach the browser.

import type {
  DeleteObjectResult,
  DeleteObjectsResult,
  HeadObjectResult,
  ListMultipartUploadsResult,
  ListObjectVersionsResult,
  ListObjectsResult,
  ListPartsResult,
  RustfsBucket,
  RustfsDeleteMarker,
  RustfsObject,
  RustfsObjectVersion,
  RustfsPart,
  RustfsUpload,
} from "./rustfs";
import {
  type RustfsConfig,
  RustfsError,
  abortMultipartUpload as abortMultipartUploadRaw,
  completeMultipartUpload as completeMultipartUploadRaw,
  configFromEnv,
  copyObject as copyObjectRaw,
  createBucket as createBucketRaw,
  createMultipartUpload as createMultipartUploadRaw,
  deleteBucketCors as deleteBucketCorsRaw,
  deleteBucket as deleteBucketRaw,
  deleteBucketTagging as deleteBucketTaggingRaw,
  deleteObject as deleteObjectRaw,
  deleteObjectTagging as deleteObjectTaggingRaw,
  deleteObjects as deleteObjectsRaw,
  getBucketCors as getBucketCorsRaw,
  getBucketLocation as getBucketLocationRaw,
  getBucketTagging as getBucketTaggingRaw,
  getBucketVersioning as getBucketVersioningRaw,
  getObjectTagging as getObjectTaggingRaw,
  headBucket as headBucketRaw,
  headObject as headObjectRaw,
  listBuckets as listBucketsRaw,
  listMultipartUploads as listMultipartUploadsRaw,
  listObjectVersions as listObjectVersionsRaw,
  listObjectsV2 as listObjectsV2Raw,
  listParts as listPartsRaw,
  presignGet as presignGetRaw,
  presignPut as presignPutRaw,
  putBucketCors as putBucketCorsRaw,
  putBucketTagging as putBucketTaggingRaw,
  putBucketVersioning as putBucketVersioningRaw,
  putObject as putObjectRaw,
  putObjectTagging as putObjectTaggingRaw,
  uploadPart as uploadPartRaw,
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
  getBucketLocation: (name: string): Promise<string> =>
    getBucketLocationRaw(cfg(), name),
  putBucketCors: (name: string): Promise<void> => putBucketCorsRaw(cfg(), name),
  getBucketCors: (name: string): Promise<string | null> =>
    getBucketCorsRaw(cfg(), name),
  deleteBucketCors: (name: string): Promise<void> =>
    deleteBucketCorsRaw(cfg(), name),
  getBucketTagging: (
    name: string,
  ): Promise<Array<{ key: string; value: string }>> =>
    getBucketTaggingRaw(cfg(), name),
  putBucketTagging: (
    name: string,
    tags: Array<{ key: string; value: string }>,
  ): Promise<void> => putBucketTaggingRaw(cfg(), name, tags),
  deleteBucketTagging: (name: string): Promise<void> =>
    deleteBucketTaggingRaw(cfg(), name),
  getBucketVersioning: (
    name: string,
  ): Promise<"Enabled" | "Suspended" | "Off"> =>
    getBucketVersioningRaw(cfg(), name),
  putBucketVersioning: (
    name: string,
    status: "Enabled" | "Suspended",
  ): Promise<void> => putBucketVersioningRaw(cfg(), name, status),
  headBucket: (name: string): Promise<boolean> => headBucketRaw(cfg(), name),
  deleteBucket: (name: string): Promise<void> => deleteBucketRaw(cfg(), name),
  putObject: (
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ etag: string }> =>
    putObjectRaw(cfg(), bucket, key, body, contentType),
  headObject: (
    bucket: string,
    key: string,
    versionId?: string,
  ): Promise<HeadObjectResult | null> =>
    headObjectRaw(cfg(), bucket, key, versionId),
  deleteObject: (
    bucket: string,
    key: string,
    versionId?: string,
  ): Promise<DeleteObjectResult> =>
    deleteObjectRaw(cfg(), bucket, key, versionId),
  deleteObjects: (
    bucket: string,
    objects: Array<{ key: string; versionId?: string }>,
    quiet = false,
  ): Promise<DeleteObjectsResult> =>
    deleteObjectsRaw(cfg(), bucket, objects, quiet),
  getObjectTagging: (
    bucket: string,
    key: string,
    versionId?: string,
  ): Promise<Array<{ key: string; value: string }>> =>
    getObjectTaggingRaw(cfg(), bucket, key, versionId),
  putObjectTagging: (
    bucket: string,
    key: string,
    tags: Array<{ key: string; value: string }>,
    versionId?: string,
  ): Promise<void> =>
    putObjectTaggingRaw(cfg(), bucket, key, tags, versionId),
  deleteObjectTagging: (
    bucket: string,
    key: string,
    versionId?: string,
  ): Promise<void> =>
    deleteObjectTaggingRaw(cfg(), bucket, key, versionId),
  listObjectVersions: (
    bucket: string,
    opts?: {
      prefix?: string;
      delimiter?: string;
      keyMarker?: string;
      versionIdMarker?: string;
      maxKeys?: number;
    },
  ): Promise<ListObjectVersionsResult> =>
    listObjectVersionsRaw(cfg(), bucket, opts),
  copyObject: (
    srcBucket: string,
    srcKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<void> =>
    copyObjectRaw(cfg(), srcBucket, srcKey, destBucket, destKey),
  listObjectsV2: (
    bucket: string,
    opts?: ListObjectsV2Args,
  ): Promise<ListObjectsResult> => listObjectsV2Raw(cfg(), bucket, opts),
  createMultipartUpload: (
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<string> =>
    createMultipartUploadRaw(cfg(), bucket, key, contentType),
  uploadPart: (
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
  ): Promise<string> =>
    uploadPartRaw(cfg(), bucket, key, uploadId, partNumber, body),
  completeMultipartUpload: (
    bucket: string,
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void> =>
    completeMultipartUploadRaw(cfg(), bucket, key, uploadId, parts),
  abortMultipartUpload: (
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> =>
    abortMultipartUploadRaw(cfg(), bucket, key, uploadId),
  listParts: (
    bucket: string,
    key: string,
    uploadId: string,
    opts?: { maxParts?: number; partNumberMarker?: number },
  ): Promise<ListPartsResult> =>
    listPartsRaw(cfg(), bucket, key, uploadId, opts),
  listMultipartUploads: (
    bucket: string,
    opts?: {
      delimiter?: string;
      prefix?: string;
      maxUploads?: number;
      keyMarker?: string;
      uploadIdMarker?: string;
    },
  ): Promise<ListMultipartUploadsResult> =>
    listMultipartUploadsRaw(cfg(), bucket, opts),
  presignPut: (
    bucket: string,
    key: string,
    contentType: string,
    expiresSecs: number,
  ): Promise<string> =>
    presignPutRaw(cfg(), bucket, key, contentType, expiresSecs),
  presignGet: (
    bucket: string,
    key: string,
    expiresSecs: number,
    versionId?: string,
  ): Promise<string> =>
    presignGetRaw(cfg(), bucket, key, expiresSecs, versionId),
};

export type {
  RustfsObject,
  RustfsObjectVersion,
  RustfsDeleteMarker,
  RustfsPart,
  RustfsUpload,
  DeleteObjectResult,
  DeleteObjectsResult,
};
