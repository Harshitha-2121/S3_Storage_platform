// Object operations.
//
// Bytes live in RustFS. The browser talks to RustFS
// directly via short-lived presigned URLs (issued with
// the server-side root credentials only after Convex
// has verified ownership + quota). Object metadata is
// recorded in Convex for usage/quota/audit.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { audit } from "./auditLog";
import { bump } from "./counters";
import { rustfs } from "./rustfsHelpers";
import {
  isValidObjectKey,
  objectKeyError,
} from "./storageValidate";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMember, requireRole } from "./orgs";

const PRESIGN_TTL = () =>
  Number(process.env.S3_PRESIGN_TTL ?? "300");

async function assertWritable(
  ctx: MutationCtx,
  bucketId: Id<"buckets">,
  userId: Id<"users">,
) {
  const b = await ctx.db.get(bucketId);
  if (!b) throw new ConvexError("Bucket not found");
  await requireMember(ctx, userId, b.workspaceId);
  const account = await ctx.db.get(b.accountId);
  if (!account) throw new ConvexError("Storage account not found");
  if (account.status !== "active") {
    throw new ConvexError("Storage account is disabled");
  }
  return { bucket: b, account };
}

/** Sum of tracked object bytes for an account. */
async function accountBytes(
  ctx: QueryCtx,
  accountId: Id<"storageAccounts">,
): Promise<number> {
  const buckets = await ctx.db
    .query("buckets")
    .withIndex("by_account", (q) =>
      q.eq("accountId", accountId),
    )
    .collect();
  let total = 0;
  for (const bk of buckets) {
    const rows = await ctx.db
      .query("objects")
      .withIndex("by_bucket", (q) =>
        q.eq("bucketId", bk._id),
      )
      .collect();
    total += rows.reduce((n, o) => n + o.size, 0);
  }
  return total;
}

/**
 * Issue a short-lived presigned PUT URL for a single
 * object. The browser uploads straight to RustFS.
 */
export const createUploadUrl = mutation({
  args: {
    bucketId: v.id("buckets"),
    key: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const keyErr = objectKeyError(args.key);
    if (keyErr) throw new ConvexError(keyErr);
    if (!Number.isFinite(args.size) || args.size < 0) {
      throw new ConvexError("Invalid object size");
    }
    const { bucket, account } = await assertWritable(
      ctx,
      args.bucketId,
      userId,
    );

    // Size limit per object.
    if (args.size > account.maxObjectBytes) {
      throw new ConvexError(
        `Object exceeds the ${account.maxObjectBytes} byte per-object limit`,
      );
    }
    // Quota: account storage.
    const used = await accountBytes(ctx, account._id);
    if (used + args.size > account.storageQuotaBytes) {
      throw new ConvexError("Storage quota exceeded");
    }

    const url = await rustfs.presignPut(
      bucket.rustfsName,
      args.key,
      args.contentType || "application/octet-stream",
      PRESIGN_TTL(),
    );
    await audit(ctx, bucket.workspaceId, userId, "object.uploadUrl", {
      bucketId: args.bucketId,
      key: args.key,
      size: args.size,
    });
    return { url, key: args.key, expiresIn: PRESIGN_TTL() };
  },
});

/** DB-only: get bucket + check member (for actions). Returns bucket row. */
export const getBucketForUser = internalQuery({
  args: { userId: v.id("users"), bucketId: v.id("buckets") },
  handler: async (ctx, { userId, bucketId }) => {
    const b = await ctx.db.get(bucketId);
    if (!b) throw new ConvexError("Bucket not found");
    await requireMember(ctx, userId, b.workspaceId);
    const account = await ctx.db.get(b.accountId);
    if (!account) throw new ConvexError("Storage account not found");
    if (account.status !== "active")
      throw new ConvexError("Storage account is disabled");
    return b;
  },
});

/** DB-only: upsert object metadata after RustFS HEAD succeeded. */
export const upsertObjectRecord = internalMutation({
  args: {
    bucketId: v.id("buckets"),
    key: v.string(),
    contentType: v.optional(v.string()),
    size: v.number(),
    etag: v.string(),
    headContentType: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.bucketId);
    if (!b) throw new ConvexError("Bucket not found");
    const now = Date.now();
    const existing = await ctx.db
      .query("objects")
      .withIndex("by_bucket_key", (q) =>
        q.eq("bucketId", args.bucketId).eq("key", args.key),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        size: args.size,
        contentType: args.contentType ?? args.headContentType,
        etag: args.etag,
        updatedAt: now,
      });
      return { objectId: existing._id, size: args.size };
    }
    const objectId = await ctx.db.insert("objects", {
      workspaceId: b.workspaceId,
      accountId: b.accountId,
      bucketId: args.bucketId,
      key: args.key,
      size: args.size,
      contentType: args.contentType ?? args.headContentType,
      etag: args.etag,
      userId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
    await bump(ctx, b.workspaceId, "objects", 1);
    await audit(ctx, b.workspaceId, args.userId, "object.upload", {
      bucketId: args.bucketId,
      key: args.key,
      size: args.size,
    });
    return { objectId, size: args.size };
  },
});

/**
 * Called by the browser after a presigned upload.
 * Action (network allowed): HEADs RustFS for authoritative size/etag,
 * then records metadata. Use useAction on the client.
 */
export const completeUpload = action({
  args: {
    bucketId: v.id("buckets"),
    key: v.string(),
    contentType: v.optional(v.string()),
  },
  // Explicit return type breaks the inference cycle through `internal` (see provisioning.ts).
  handler: async (ctx, args): Promise<{ objectId: unknown; size: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const b: { rustfsName: string } = await ctx.runQuery(
      (internal as any).objects.getBucketForUser,
      {
        userId,
        bucketId: args.bucketId,
      },
    );
    const head = await rustfs.headObject(b.rustfsName, args.key);
    if (!head) throw new ConvexError("Upload not found in storage");
    return await ctx.runMutation((internal as any).objects.upsertObjectRecord, {
      bucketId: args.bucketId,
      key: args.key,
      contentType: args.contentType,
      size: head.size,
      etag: head.etag,
      headContentType: head.contentType,
      userId,
    });
  },
});

export const recordUpload = internalAction({
  args: {
    bucketId: v.id("buckets"),
    key: v.string(),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ objectId: unknown; size: number }> => {
    const b: { rustfsName: string; userId: unknown } | null =
      await ctx.runQuery((internal as any).objects.getBucketForUserInternal, {
        bucketId: args.bucketId,
      });
    if (!b) throw new ConvexError("Bucket not found");
    const head = await rustfs.headObject(b.rustfsName, args.key);
    if (!head) throw new ConvexError("Upload not found in storage");
    return await ctx.runMutation((internal as any).objects.upsertObjectRecord, {
      bucketId: args.bucketId,
      key: args.key,
      contentType: args.contentType,
      size: head.size,
      etag: head.etag,
      headContentType: head.contentType,
      // biome-ignore lint/suspicious/noExplicitAny: internal user id passthrough
      userId: b.userId as any,
    });
  },
});

/** DB-only: get bucket without member check (server/gateway use). */
export const getBucketForUserInternal = internalQuery({
  args: { bucketId: v.id("buckets") },
  handler: async (ctx, { bucketId }) => ctx.db.get(bucketId),
});

/** DB-only: contentTypes for keys (enrichment for list action). */
export const getContentTypes = internalQuery({
  args: { bucketId: v.id("buckets"), keys: v.array(v.string()) },
  handler: async (ctx, { bucketId, keys }) => {
    const out: Record<string, string | undefined> = {};
    for (const key of keys) {
      const meta = await ctx.db
        .query("objects")
        .withIndex("by_bucket_key", (q) =>
          q.eq("bucketId", bucketId).eq("key", key),
        )
        .unique();
      if (meta?.contentType) out[key] = meta.contentType;
    }
    return out;
  },
});

/**
 * List objects in a bucket (live from RustFS, paginated).
 * Action (network allowed). Use useAction + local state on the client,
 * not useQuery (queries cannot do network).
 */
export const listObjects = action({
  args: {
    bucketId: v.id("buckets"),
    prefix: v.optional(v.string()),
    continuationToken: v.optional(v.string()),
    maxKeys: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { objects: [], isTruncated: false };
    const b = await ctx.runQuery((internal as any).objects.getBucketForUser, {
      userId,
      bucketId: args.bucketId,
    });
    const res = await rustfs.listObjectsV2(b.rustfsName, {
      prefix: args.prefix,
      continuationToken: args.continuationToken,
      maxKeys: Math.min(args.maxKeys ?? 100, 1000),
    });
    const contentTypes: Record<string, string | undefined> =
      await ctx.runQuery((internal as any).objects.getContentTypes, {
        bucketId: args.bucketId,
        keys: res.objects.map((o) => o.key),
      });
    return {
      objects: res.objects.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        lastModified: o.lastModified,
        contentType: contentTypes[o.key] ?? o.contentType,
      })),
      isTruncated: res.isTruncated,
      nextContinuationToken: res.nextContinuationToken,
      prefix: res.prefix,
    };
  },
});

/**
 * Object metadata (HeadObject). Action (network allowed).
 */
export const headObject = action({
  args: { bucketId: v.id("buckets"), key: v.string() },
  // biome-ignore lint/suspicious/noExplicitAny: HeadObject passthrough breaks inference cycle
  handler: async (ctx, { bucketId, key }): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const b: { rustfsName: string } = await ctx.runQuery(
      (internal as any).objects.getBucketForUser,
      {
        userId,
        bucketId,
      },
    );
    return await rustfs.headObject(b.rustfsName, key);
  },
});

/** DB-only: audit a download (called after presign). */
export const recordDownload = internalMutation({
  args: {
    userId: v.id("users"),
    bucketId: v.id("buckets"),
    key: v.string(),
  },
  handler: async (ctx, { userId, bucketId, key }) => {
    const b = await ctx.db.get(bucketId);
    if (!b) return;
    await requireMember(ctx, userId, b.workspaceId);
    await audit(ctx, b.workspaceId, userId, "object.downloadUrl", {
      bucketId,
      key,
    });
    await bump(ctx, b.workspaceId, "downloads", 1);
  },
});

/** DB-only: remove object metadata after RustFS delete. */
export const removeObjectRecord = internalMutation({
  args: {
    userId: v.id("users"),
    bucketId: v.id("buckets"),
    key: v.string(),
  },
  handler: async (ctx, { userId, bucketId, key }) => {
    const b = await ctx.db.get(bucketId);
    if (!b) throw new ConvexError("Bucket not found");
    await requireMember(ctx, userId, b.workspaceId);
    const meta = await ctx.db
      .query("objects")
      .withIndex("by_bucket_key", (q) =>
        q.eq("bucketId", bucketId).eq("key", key),
      )
      .unique();
    if (meta) await ctx.db.delete(meta._id);
    await bump(ctx, b.workspaceId, "objects", -1);
    await audit(ctx, b.workspaceId, userId, "object.delete", {
      bucketId,
      key,
    });
  },
});

/** Issue a short-lived presigned GET URL for download. Action (HEAD is network). */
export const createDownloadUrl = action({
  args: { bucketId: v.id("buckets"), key: v.string() },
  handler: async (ctx, { bucketId, key }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const keyErr = objectKeyError(key);
    if (keyErr) throw new ConvexError(keyErr);
    const b = await ctx.runQuery((internal as any).objects.getBucketForUser, {
      userId,
      bucketId,
    });
    const head = await rustfs.headObject(b.rustfsName, key);
    if (!head) throw new ConvexError("Object not found");
    const url = await rustfs.presignGet(b.rustfsName, key, PRESIGN_TTL());
    await ctx.runMutation((internal as any).objects.recordDownload, {
      userId,
      bucketId,
      key,
    });
    return { url, expiresIn: PRESIGN_TTL(), size: head.size };
  },
});

/** Delete an object (RustFS + Convex metadata). Action (network allowed). */
export const deleteObject = action({
  args: { bucketId: v.id("buckets"), key: v.string() },
  handler: async (ctx, { bucketId, key }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const b = await ctx.runQuery((internal as any).objects.getBucketForUser, {
      userId,
      bucketId,
    });
    await rustfs.deleteObject(b.rustfsName, key);
    await ctx.runMutation((internal as any).objects.removeObjectRecord, {
      userId,
      bucketId,
      key,
    });
  },
});

/** DB-only: copy context (both buckets + dest quota). */
export const getCopyContext = internalQuery({
  args: {
    userId: v.id("users"),
    bucketId: v.id("buckets"),
    destBucketId: v.id("buckets"),
  },
  handler: async (ctx, { userId, bucketId, destBucketId }) => {
    const src = await ctx.db.get(bucketId);
    if (!src) throw new ConvexError("Source bucket not found");
    const dest = await ctx.db.get(destBucketId);
    if (!dest) throw new ConvexError("Destination bucket not found");
    await requireMember(ctx, userId, src.workspaceId);
    await requireMember(ctx, userId, dest.workspaceId);
    const destAccount = await ctx.db.get(dest.accountId);
    let used = 0;
    if (destAccount) {
      const buckets = await ctx.db
        .query("buckets")
        .withIndex("by_account", (q) => q.eq("accountId", destAccount._id))
        .collect();
      for (const bk of buckets) {
        const rows = await ctx.db
          .query("objects")
          .withIndex("by_bucket", (q) => q.eq("bucketId", bk._id))
          .collect();
        used += rows.reduce((n, o) => n + o.size, 0);
      }
    }
    return {
      src,
      dest,
      destQuota: destAccount?.storageQuotaBytes ?? null,
      destUsed: used,
    };
  },
});

/** DB-only: record copy metadata after RustFS copy. */
export const recordCopy = internalMutation({
  args: {
    userId: v.id("users"),
    srcRustfs: v.string(),
    srcKey: v.string(),
    destBucketId: v.id("buckets"),
    destKey: v.string(),
    size: v.number(),
    contentType: v.optional(v.string()),
    etag: v.string(),
  },
  handler: async (ctx, a) => {
    const dest = await ctx.db.get(a.destBucketId);
    if (!dest) throw new ConvexError("Destination bucket not found");
    const existing = await ctx.db
      .query("objects")
      .withIndex("by_bucket_key", (q) =>
        q.eq("bucketId", a.destBucketId).eq("key", a.destKey),
      )
      .unique();
    if (!existing) {
      const now = Date.now();
      await ctx.db.insert("objects", {
        workspaceId: dest.workspaceId,
        accountId: dest.accountId,
        bucketId: a.destBucketId,
        key: a.destKey,
        size: a.size,
        contentType: a.contentType,
        etag: a.etag,
        userId: a.userId,
        createdAt: now,
        updatedAt: now,
      });
      await bump(ctx, dest.workspaceId, "objects", 1);
    }
    await audit(ctx, dest.workspaceId, a.userId, "object.copy", {
      from: `${a.srcRustfs}/${a.srcKey}`,
      to: a.destKey,
    });
  },
});

/** DB-only: record rename after RustFS copy+delete. */
export const recordRename = internalMutation({
  args: {
    userId: v.id("users"),
    bucketId: v.id("buckets"),
    key: v.string(),
    destKey: v.string(),
    size: v.optional(v.number()),
    contentType: v.optional(v.string()),
    etag: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bucketId);
    if (!b) throw new ConvexError("Bucket not found");
    const oldMeta = await ctx.db
      .query("objects")
      .withIndex("by_bucket_key", (q) =>
        q.eq("bucketId", a.bucketId).eq("key", a.key),
      )
      .unique();
    if (oldMeta) await ctx.db.delete(oldMeta._id);
    if (a.size !== undefined) {
      const now = Date.now();
      await ctx.db.insert("objects", {
        workspaceId: b.workspaceId,
        accountId: b.accountId,
        bucketId: a.bucketId,
        key: a.destKey,
        size: a.size,
        contentType: a.contentType,
        etag: a.etag,
        userId: a.userId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await audit(ctx, b.workspaceId, a.userId, "object.rename", {
      bucketId: a.bucketId,
      from: a.key,
      to: a.destKey,
    });
  },
});

/** Copy an object (server-side copy in RustFS). Action (network allowed). */
export const copyObject = action({
  args: {
    bucketId: v.id("buckets"),
    key: v.string(),
    destBucketId: v.id("buckets"),
    destKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    if (!isValidObjectKey(args.destKey))
      throw new ConvexError("Invalid destination key");
    const { src, dest, destQuota, destUsed } = await ctx.runQuery(
      (internal as any).objects.getCopyContext,
      { userId, bucketId: args.bucketId, destBucketId: args.destBucketId },
    );
    const srcHead = await rustfs.headObject(src.rustfsName, args.key);
    if (srcHead && destQuota !== null && destUsed + srcHead.size > destQuota)
      throw new ConvexError("Storage quota exceeded");
    await rustfs.copyObject(
      src.rustfsName,
      args.key,
      dest.rustfsName,
      args.destKey,
    );
    const head = await rustfs.headObject(dest.rustfsName, args.destKey);
    if (head) {
      await ctx.runMutation((internal as any).objects.recordCopy, {
        userId,
        srcRustfs: src.rustfsName,
        srcKey: args.key,
        destBucketId: args.destBucketId,
        destKey: args.destKey,
        size: head.size,
        contentType: head.contentType,
        etag: head.etag,
      });
    }
  },
});

/** Rename = copy + delete (S3 has no native rename). Action (network allowed). */
export const renameObject = action({
  args: {
    bucketId: v.id("buckets"),
    key: v.string(),
    destKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    if (!isValidObjectKey(args.destKey))
      throw new ConvexError("Invalid destination key");
    const b = await ctx.runQuery((internal as any).objects.getBucketForUser, {
      userId,
      bucketId: args.bucketId,
    });
    await rustfs.copyObject(b.rustfsName, args.key, b.rustfsName, args.destKey);
    await rustfs.deleteObject(b.rustfsName, args.key);
    const head = await rustfs.headObject(b.rustfsName, args.destKey);
    await ctx.runMutation((internal as any).objects.recordRename, {
      userId,
      bucketId: args.bucketId,
      key: args.key,
      destKey: args.destKey,
      size: head?.size,
      contentType: head?.contentType ?? undefined,
      etag: head?.etag,
    });
  },
});

export type { MutationCtx };
