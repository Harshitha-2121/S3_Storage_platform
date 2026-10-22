// Bucket management.
//
// Bucket names are namespaced per account: the name created
// in RustFS is `${accountCode}-${name}`. This lets different
// accounts reuse the same friendly bucket name in the shared
// RustFS namespace while keeping ownership unambiguous.
// All authorization is enforced here, server-side.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { audit } from "./auditLog";
import { bump } from "./counters";
import { RustfsError, rustfs } from "./rustfsHelpers";
import { bucketNameError, isValidBucketName } from "./storageValidate";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMember, requireRole } from "./orgs";

/** Validate create args (DB-only, no network). Returns derived rustfsName. */
export const validateCreate = internalQuery({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.userId, args.workspaceId);
    const nameErr = bucketNameError(args.name);
    if (nameErr) throw new ConvexError(nameErr);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.workspaceId !== args.workspaceId) {
      throw new ConvexError("Storage account not found");
    }
    if (account.status !== "active") {
      throw new ConvexError("Storage account is disabled");
    }
    const existing = await ctx.db
      .query("buckets")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    if (existing.length >= account.maxBuckets) {
      throw new ConvexError(`Bucket limit reached (${account.maxBuckets})`);
    }
    if (existing.some((b) => b.name === args.name)) {
      throw new ConvexError("A bucket with this name already exists");
    }
    const rustfsName = `${account.accountCode}-${args.name}`;
    if (!isValidBucketName(rustfsName)) {
      throw new ConvexError("Internal bucket name invalid");
    }
    return { rustfsName };
  },
});

/** Insert bucket row after RustFS success (dedupes by name). */
export const insertBucketRecord = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    name: v.string(),
    rustfsName: v.string(),
  },
  handler: async (ctx, args) => {
    const dup = await ctx.db
      .query("buckets")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();
    if (dup) return { bucketId: dup._id, rustfsName: dup.rustfsName, created: false };
    const now = Date.now();
    const bucketId = await ctx.db.insert("buckets", {
      workspaceId: args.workspaceId,
      accountId: args.accountId,
      userId: args.userId,
      name: args.name,
      rustfsName: args.rustfsName,
      createdAt: now,
    });
    await audit(ctx, args.workspaceId, args.userId, "bucket.create", {
      bucketId,
      name: args.name,
      rustfsName: args.rustfsName,
    });
    await bump(ctx, args.workspaceId, "buckets", 1);
    return { bucketId, rustfsName: args.rustfsName, created: true };
  },
});

/**
 * Public: create a bucket in an account.
 * Action (network allowed): validates via query, creates in RustFS first,
 * then records in Convex. Use useAction on the client.
 */
export const createBucket = action({
  args: {
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<{ bucketId: unknown; rustfsName: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const { rustfsName }: { rustfsName: string } = await ctx.runQuery(
      // biome-ignore lint/suspicious/noExplicitAny: break self-reference type cycle
      (internal as any).buckets.validateCreate,
      {
        userId,
        workspaceId: args.workspaceId,
        accountId: args.accountId,
        name: args.name,
      },
    );
    try {
      await rustfs.createBucket(rustfsName);
    } catch (e) {
      if (
        e instanceof RustfsError &&
        (e.code === "BucketAlreadyOwnedByYou" || e.code === "BucketAlreadyExists")
      ) {
        throw new ConvexError("A bucket with this name already exists");
      }
      throw e;
    }
    // Browser direct uploads need bucket CORS; best-effort so creation
    // never fails on it (gateway/SDK paths work regardless).
    try {
      await rustfs.putBucketCors(rustfsName);
    } catch (e) {
      console.warn(
        `[rustfs] CORS setup failed for ${rustfsName}: ${(e as Error).message}`,
      );
    }
    return await ctx.runMutation(
      // biome-ignore lint/suspicious/noExplicitAny: break self-reference type cycle
      (internal as any).buckets.insertBucketRecord,
      {
        userId,
        workspaceId: args.workspaceId,
        accountId: args.accountId,
        name: args.name,
        rustfsName,
      },
    );
  },
});

/** Buckets the caller can see (workspace-scoped). */
export const listBuckets = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    const rows = await ctx.db
      .query("buckets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
    const out = [];
    for (const b of rows) {
      const usage = await bucketUsage(ctx, b._id);
      out.push({ ...b, usage });
    }
    return out;
  },
});

/** Buckets in one account. */
export const listAccountBuckets = query({
  args: { accountId: v.id("storageAccounts") },
  handler: async (ctx, { accountId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const account = await ctx.db.get(accountId);
    if (!account) return [];
    await requireMember(ctx, userId, account.workspaceId);
    const rows = await ctx.db
      .query("buckets")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .order("desc")
      .collect();
    const out = [];
    for (const b of rows) {
      const usage = await bucketUsage(ctx, b._id);
      out.push({ ...b, usage });
    }
    return out;
  },
});

/** Single bucket detail + usage. */
export const getBucket = query({
  args: { id: v.id("buckets") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const b = await ctx.db.get(id);
    if (!b) return null;
    await requireMember(ctx, userId, b.workspaceId);
    const usage = await bucketUsage(ctx, b._id);
    return { ...b, usage };
  },
});

/** Action: get full bucket status including live CORS, Tagging, and Versioning from RustFS */
export const getBucketConfig = action({
  args: { id: v.id("buckets") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const b = await ctx.runQuery((internal as any).buckets.validateDelete, { userId, id });
    const [cors, tags, versioning] = await Promise.all([
      rustfs.getBucketCors(b.rustfsName),
      rustfs.getBucketTagging(b.rustfsName),
      rustfs.getBucketVersioning(b.rustfsName),
    ]);
    return { cors, tags, versioning };
  },
});

/** Action: configure bucket versioning from dashboard */
export const setBucketVersioning = action({
  args: { id: v.id("buckets"), status: v.union(v.literal("Enabled"), v.literal("Suspended")) },
  handler: async (ctx, { id, status }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const b = await ctx.runQuery((internal as any).buckets.validateDelete, { userId, id });
    await rustfs.putBucketVersioning(b.rustfsName, status);
  },
});

/** Action: configure bucket tagging from dashboard */
export const setBucketTagging = action({
  args: {
    id: v.id("buckets"),
    tags: v.array(v.object({ key: v.string(), value: v.string() })),
  },
  handler: async (ctx, { id, tags }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const b = await ctx.runQuery((internal as any).buckets.validateDelete, { userId, id });
    if (tags.length === 0) {
      await rustfs.deleteBucketTagging(b.rustfsName);
    } else {
      await rustfs.putBucketTagging(b.rustfsName, tags);
    }
  },
});

async function bucketUsage(
  ctx: QueryCtx,
  bucketId: Id<"buckets">,
) {
  const rows = await ctx.db
    .query("objects")
    .withIndex("by_bucket", (q) => q.eq("bucketId", bucketId))
    .collect();
  return {
    objects: rows.length,
    bytes: rows.reduce((n, o) => n + o.size, 0),
  };
}

/** Validate delete perms (DB-only). Returns bucket for the action. */
export const validateDelete = internalQuery({
  args: { userId: v.id("users"), id: v.id("buckets") },
  handler: async (ctx, { userId, id }) => {
    const b = await ctx.db.get(id);
    if (!b) throw new ConvexError("Bucket not found");
    await requireRole(ctx, userId, b.workspaceId, ["owner", "admin"]);
    return b;
  },
});

/** Remove bucket + object metadata rows after RustFS delete succeeded. */
export const removeBucketRecord = internalMutation({
  args: { userId: v.id("users"), id: v.id("buckets") },
  handler: async (ctx, { userId, id }) => {
    const b = await ctx.db.get(id);
    if (!b) return;
    await requireRole(ctx, userId, b.workspaceId, ["owner", "admin"]);
    const objRows = await ctx.db
      .query("objects")
      .withIndex("by_bucket", (q) => q.eq("bucketId", id))
      .collect();
    for (const o of objRows) await ctx.db.delete(o._id);
    await ctx.db.delete(id);
    await bump(ctx, b.workspaceId, "buckets", -1);
    await audit(ctx, b.workspaceId, userId, "bucket.delete", {
      bucketId: id,
      name: b.name,
    });
  },
});

/**
 * Delete a bucket. Refuses non-empty buckets (checked against
 * RustFS, the source of truth). Only owner/admin. Action (network allowed).
 */
export const deleteBucket = action({
  args: { id: v.id("buckets") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const b: { rustfsName: string } = await ctx.runQuery(
      // biome-ignore lint/suspicious/noExplicitAny: break self-reference type cycle
      (internal as any).buckets.validateDelete,
      { userId, id },
    );
    const listing = await rustfs.listObjectsV2(b.rustfsName, { maxKeys: 1 });
    if (listing.objects.length > 0) {
      throw new ConvexError("Bucket is not empty. Delete all objects first.");
    }
    await rustfs.deleteBucket(b.rustfsName);
    await ctx.runMutation(
      // biome-ignore lint/suspicious/noExplicitAny: break self-reference type cycle
      (internal as any).buckets.removeBucketRecord,
      { userId, id },
    );
  },
});

/** Fetch bucket for reconcile (DB-only). */
export const getReconcileTarget = internalQuery({
  args: { id: v.id("buckets") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

/** Apply reconciled key set (DB-only). */
export const applyReconcile = internalMutation({
  args: {
    id: v.id("buckets"),
    real: v.array(
      v.object({ key: v.string(), size: v.number(), etag: v.string() }),
    ),
  },
  handler: async (ctx, { id, real }) => {
    const b = await ctx.db.get(id);
    if (!b) throw new ConvexError("Bucket not found");
    const realMap = new Map(real.map((r) => [r.key, r]));
    const rows = await ctx.db
      .query("objects")
      .withIndex("by_bucket", (q) => q.eq("bucketId", id))
      .collect();
    for (const row of rows) {
      if (!realMap.has(row.key)) await ctx.db.delete(row._id);
    }
    for (const meta of real) {
      const existing = await ctx.db
        .query("objects")
        .withIndex("by_bucket_key", (q) =>
          q.eq("bucketId", id).eq("key", meta.key),
        )
        .unique();
      if (!existing) {
        const now = Date.now();
        await ctx.db.insert("objects", {
          workspaceId: b.workspaceId,
          accountId: b.accountId,
          bucketId: id,
          key: meta.key,
          size: meta.size,
          etag: meta.etag,
          userId: b.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return { objects: real.length };
  },
});

/**
 * Internal: reconcile a bucket's Convex metadata against
 * RustFS (source of truth). Action because it uses network.
 */
export const reconcileBucket = internalAction({
  args: { id: v.id("buckets") },
  handler: async (ctx, { id }): Promise<{ objects: number }> => {
    const b: { rustfsName: string } | null = await ctx.runQuery(
      (internal as any).buckets.getReconcileTarget,
      { id },
    );
    if (!b) throw new ConvexError("Bucket not found");
    const real: { key: string; size: number; etag: string }[] = [];
    let token: string | undefined;
    do {
      const res = await rustfs.listObjectsV2(b.rustfsName, {
        continuationToken: token,
        maxKeys: 1000,
      });
      for (const o of res.objects)
        real.push({ key: o.key, size: o.size, etag: o.etag });
      token = res.isTruncated ? res.nextContinuationToken : undefined;
    } while (token);
    return await ctx.runMutation((internal as any).buckets.applyReconcile, { id, real });
  },
});

/**
 * Public: reconcile a bucket the caller is a member of (syncs Convex
 * records with RustFS reality). Thin auth wrapper over reconcileBucket.
 * Action (network allowed). Use useAction on the client.
 */
export const reconcileBucketNow = action({
  args: { id: v.id("buckets") },
  handler: async (ctx, { id }): Promise<{ objects: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    // Membership check (throws unless the caller belongs to the workspace).
    await ctx.runQuery((internal as any).objects.getBucketForUser, {
      userId,
      bucketId: id,
    });
    return await ctx.runAction((internal as any).buckets.reconcileBucket, {
      id,
    });
  },
});

export type { MutationCtx };

/** Internal: buckets of a workspace for server-side jobs (member-checked). */
export const bucketsForReport = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces") },
  handler: async (ctx, { userId, workspaceId }) => {
    await requireMember(ctx, userId, workspaceId);
    return ctx.db
      .query("buckets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

/** Internal: resolve a bucket by its RustFS name (gateway). */
export const resolveBucketByRustfsName = internalQuery({
  args: { rustfsName: v.string() },
  handler: async (ctx, { rustfsName }) => {
    return ctx.db
      .query("buckets")
      .withIndex("by_rustfsName", (q) =>
        q.eq("rustfsName", rustfsName),
      )
      .unique();
  },
});

/** Internal: list a workspace's bucket rustfsNames (gateway). */
export const workspaceRustfsNames = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const rows = await ctx.db
      .query("buckets")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .collect();
    return rows.map((b) => b.rustfsName);
  },
});
