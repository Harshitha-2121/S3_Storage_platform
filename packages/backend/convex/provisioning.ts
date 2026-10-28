// Automatic storage provisioning (Phase 4).
//
// When a new user becomes eligible for storage (today: right after they pick
// a username in onboarding), this creates everything they need, idempotently:
//   1. workspace  (their existing personal workspace, created if missing)
//   2. storage account ("Default Storage", quotas initialized)
//   3. private RustFS bucket  (<username>-storage, accountCode-prefixed)
//   4. first S3 credential     (secret returned exactly once)
//
// Ordering + failure safety (matches buckets.createBucket convention):
//   - RustFS is touched FIRST, from the action (only actions may use fetch).
//   - Convex rows are recorded only after RustFS succeeds, via internal
//     mutations. If any step throws, nothing partial is left behind except
//     possibly the account row — the next run resumes from it (idempotent).
//   - Bucket ownership always comes from server-side data (auth user +
//     workspace membership), never from client-supplied owner IDs.
//   - Re-runs converge: existing workspace/account/bucket/credential rows are
//     reused, never duplicated.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { audit } from "./auditLog";
import { bump } from "./counters";
import {
  encryptSecret,
  generateAccessKeyId,
  generateSecretKey,
  hashSecret,
} from "./credCrypto";
import { RustfsError, rustfs } from "./rustfsHelpers";
import { uniqueAccountCode } from "./storageAccounts";
import { isValidBucketName, privateBucketNameForUser } from "./storageValidate";

/** User profile fields needed for provisioning (readable from actions). */
export const getProvisioningUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      username: user.username,
      email: user.email,
    };
  },
});

/** Ensure the user has a personal workspace; create "Personal" if none. */
export const ensureWorkspaceForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) return existing.workspaceId;
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");
    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Personal",
      ownerId: userId,
      createdAt: now,
    });
    await ctx.db.insert("members", {
      workspaceId,
      userId,
      role: "owner",
      createdAt: now,
    });
    await audit(ctx, workspaceId, userId, "workspace.create", {
      name: "Personal",
    });
    await bump(ctx, workspaceId, "members", 1);
    return workspaceId;
  },
});

/** Idempotently ensure an active storage account for the workspace. */
export const ensureAccountForUser = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, { userId, workspaceId }) => {
    const existing = await ctx.db
      .query("storageAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (existing) {
      return { accountId: existing._id, accountCode: existing.accountCode };
    }
    const accountCode = await uniqueAccountCode(ctx);
    const now = Date.now();
    const accountId = await ctx.db.insert("storageAccounts", {
      workspaceId,
      userId,
      name: "Default Storage",
      accountCode,
      status: "active",
      storageQuotaBytes: 50 * 1024 * 1024 * 1024, // 50 GiB
      maxBuckets: 50,
      maxObjectBytes: 5 * 1024 * 1024 * 1024, // 5 GiB
      createdAt: now,
    });
    await audit(ctx, workspaceId, userId, "storageaccount.create", {
      accountId,
      name: "Default Storage",
      accountCode,
    });
    await bump(ctx, workspaceId, "storageAccounts", 1);
    return { accountId, accountCode };
  },
});

/** Find the user's private bucket row on an account (if already recorded). */
export const findBucketForUser = internalQuery({
  args: {
    accountId: v.id("storageAccounts"),
    name: v.string(),
  },
  handler: async (ctx, { accountId, name }) => {
    const rows = await ctx.db
      .query("buckets")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const found = rows.find((b) => b.name === name);
    return found ?? null;
  },
});

/** Record the bucket row AFTER RustFS creation succeeded. */
export const recordBucketForUser = internalMutation({
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
      .collect();
    const found = dup.find((b) => b.name === args.name);
    if (found) return { bucketId: found._id, created: false as const };
    const bucketId = await ctx.db.insert("buckets", {
      workspaceId: args.workspaceId,
      accountId: args.accountId,
      userId: args.userId,
      name: args.name,
      rustfsName: args.rustfsName,
      createdAt: Date.now(),
    });
    await audit(ctx, args.workspaceId, args.userId, "bucket.create", {
      bucketId,
      name: args.name,
      rustfsName: args.rustfsName,
    });
    await bump(ctx, args.workspaceId, "buckets", 1);
    return { bucketId, created: true as const };
  },
});

/** Create the user's first S3 credential (secret returned exactly once). */
export const createFirstCredentialForUser = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    bucketId: v.id("buckets"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("s3Credentials")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (existing) return null;
    const accessKeyId = generateAccessKeyId();
    const secretKey = generateSecretKey();
    const id = await ctx.db.insert("s3Credentials", {
      workspaceId: args.workspaceId,
      accountId: args.accountId,
      userId: args.userId,
      name: "default",
      accessKeyId,
      secretCipher: await encryptSecret(secretKey),
      secretHash: await hashSecret(secretKey),
      buckets: [args.bucketId],
      actions: undefined, // all supported actions on the scoped bucket
      revoked: false,
      createdAt: Date.now(),
    });
    await audit(ctx, args.workspaceId, args.userId, "s3credential.create", {
      id,
      accessKeyId,
    });
    return { id, accessKeyId, secretKey };
  },
});

/**
 * Orchestrator (internal so admins/CLI can provision any user; the public
 * action below authenticates and delegates here).
 */
export const provisionForUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (
    ctx,
    { userId },
  ): Promise<{
    workspaceId: Id<"workspaces">;
    accountId: Id<"storageAccounts">;
    accountCode: string;
    bucketId: Id<"buckets">;
    bucketName: string;
    rustfsName: string;
    credential: {
      id: Id<"s3Credentials">;
      accessKeyId: string;
      secretKey: string;
    } | null;
  }> => {
    const profile = await ctx.runQuery(
      internal.provisioning.getProvisioningUser,
      { userId },
    );
    if (!profile) throw new ConvexError("User not found");

    const workspaceId: Id<"workspaces"> = await ctx.runMutation(
      internal.provisioning.ensureWorkspaceForUser,
      { userId },
    );
    const {
      accountId,
      accountCode,
    }: { accountId: Id<"storageAccounts">; accountCode: string } =
      await ctx.runMutation(internal.provisioning.ensureAccountForUser, {
        userId,
        workspaceId,
      });

    const bucketName = privateBucketNameForUser({
      username: profile.username,
      email: profile.email,
      userId,
    });

    let bucketRow = await ctx.runQuery(
      internal.provisioning.findBucketForUser,
      { accountId, name: bucketName },
    );
    if (!bucketRow) {
      const rustfsName = `${accountCode}-${bucketName}`;
      if (!isValidBucketName(rustfsName)) {
        throw new ConvexError("Internal bucket name invalid");
      }
      // RustFS FIRST: if this throws, nothing is recorded (safe to retry).
      // A name clash means a previous partial run succeeded remotely —
      // fall through and record the row (reconciliation).
      try {
        await rustfs.createBucket(rustfsName);
      } catch (e) {
        if (
          !(e instanceof RustfsError) ||
          (e.code !== "BucketAlreadyExists" &&
            e.code !== "BucketAlreadyOwnedByYou")
        ) {
          throw e;
        }
      }
      // Browser direct uploads need bucket CORS (best-effort).
      try {
        await rustfs.putBucketCors(rustfsName);
      } catch (e) {
        console.warn(
          `[rustfs] CORS setup failed for ${rustfsName}: ${(e as Error).message}`,
        );
      }
      const recorded = await ctx.runMutation(
        internal.provisioning.recordBucketForUser,
        { userId, workspaceId, accountId, name: bucketName, rustfsName },
      );
      bucketRow = await ctx.runQuery(internal.provisioning.findBucketForUser, {
        accountId,
        name: bucketName,
      });
      if (!bucketRow) {
        throw new ConvexError("Bucket record missing after provisioning");
      }
      void recorded;
    }

    const credential: {
      id: Id<"s3Credentials">;
      accessKeyId: string;
      secretKey: string;
    } | null = await ctx.runMutation(
      internal.provisioning.createFirstCredentialForUser,
      { userId, workspaceId, accountId, bucketId: bucketRow._id },
    );

    await ctx.scheduler.runAfter(0, internal.provisioning.markReady, {
      userId,
      workspaceId,
      accountId,
      bucketId: bucketRow._id,
    });

    return {
      workspaceId,
      accountId,
      accountCode,
      bucketId: bucketRow._id,
      bucketName,
      rustfsName: bucketRow.rustfsName,
      credential,
    };
  },
});

/** Final audit marker (runs after everything else succeeded). */
export const markReady = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    bucketId: v.id("buckets"),
  },
  handler: async (ctx, args) => {
    await audit(ctx, args.workspaceId, args.userId, "provisioning.ready", {
      accountId: args.accountId,
      bucketId: args.bucketId,
    });
  },
});

/** Public entry: provision storage for the signed-in caller. */
export const provisionDefaultStorage = action({
  args: {},
  // Explicit return type breaks the inference cycle through the generated
  // `internal` API object (which is built from this module's own types).
  handler: async (
    ctx,
  ): Promise<{
    workspaceId: Id<"workspaces">;
    accountId: Id<"storageAccounts">;
    accountCode: string;
    bucketId: Id<"buckets">;
    bucketName: string;
    rustfsName: string;
    credential: {
      id: Id<"s3Credentials">;
      accessKeyId: string;
      secretKey: string;
    } | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    return ctx.runAction(internal.provisioning.provisionForUser, { userId });
  },
});
