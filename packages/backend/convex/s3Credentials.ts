// S3 credentials — application-issued access keys used
// by external S3 clients against the SigV4 gateway.
//
// These are DISTINCT from the dashboard `sk_` API keys
// (apiKeys.ts). The secret is stored AES-GCM encrypted
// (key in server env) so the gateway can verify SigV4
// signatures; a SHA-256 verifier is stored alongside for
// safe duplicate detection. The plaintext secret is
// returned exactly once, at creation.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { audit } from "./auditLog";
import {
  decryptSecret,
  encryptSecret,
  generateAccessKeyId,
  generateSecretKey,
  hashSecret,
} from "./credCrypto";
import { requireDevSeed } from "./devGuard";
import { requireMember, requireRole } from "./orgs";
import { S3_ACTIONS, isValidS3Action } from "./storageValidate";

/** Create an S3 access key for an account. */
export const createCredential = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    name: v.string(),
    // Optional scope restriction.
    buckets: v.optional(v.array(v.id("buckets"))),
    actions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    await requireMember(ctx, userId, args.workspaceId);

    const account = await ctx.db.get(args.accountId);
    if (!account || account.workspaceId !== args.workspaceId) {
      throw new ConvexError("Storage account not found");
    }
    if (account.status !== "active") {
      throw new ConvexError("Storage account is disabled");
    }

    // Validate action scope.
    if (args.actions) {
      for (const a of args.actions) {
        if (!isValidS3Action(a)) {
          throw new ConvexError(`Invalid S3 action: ${a}`);
        }
      }
    }
    // Validate bucket scope belongs to this account.
    if (args.buckets) {
      for (const bid of args.buckets) {
        const b = await ctx.db.get(bid);
        if (!b || b.accountId !== args.accountId) {
          throw new ConvexError(
            "Scoped bucket does not belong to this account",
          );
        }
      }
    }

    const accessKeyId = generateAccessKeyId();
    const secretKey = generateSecretKey();
    const secretCipher = await encryptSecret(secretKey);
    const secretHash = await hashSecret(secretKey);

    const id = await ctx.db.insert("s3Credentials", {
      workspaceId: args.workspaceId,
      accountId: args.accountId,
      userId,
      name: args.name,
      accessKeyId,
      secretCipher,
      secretHash,
      buckets: args.buckets,
      actions: args.actions,
      revoked: false,
      createdAt: Date.now(),
    });
    await audit(ctx, args.workspaceId, userId, "s3credential.create", {
      id,
      accessKeyId,
    });
    // Secret returned exactly once.
    return { id, accessKeyId, secretKey };
  },
});

/** Credentials the caller can see (workspace-scoped). */
export const listCredentials = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    const rows = await ctx.db
      .query("s3Credentials")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
    // Never return the secret cipher/hash to the client.
    return rows.map((c) => ({
      _id: c._id,
      accountId: c.accountId,
      name: c.name,
      accessKeyId: c.accessKeyId,
      buckets: c.buckets,
      actions: c.actions,
      revoked: c.revoked,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    }));
  },
});

/** Rotate: issue a new key and revoke the old one. */
export const rotateCredential = mutation({
  args: { id: v.id("s3Credentials") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const old = await ctx.db.get(id);
    if (!old) throw new ConvexError("Credential not found");
    await requireRole(ctx, userId, old.workspaceId, ["owner", "admin"]);

    // Issue a new credential with the same scope.
    const accessKeyId = generateAccessKeyId();
    const secretKey = generateSecretKey();
    const secretCipher = await encryptSecret(secretKey);
    const secretHash = await hashSecret(secretKey);
    const newId = await ctx.db.insert("s3Credentials", {
      workspaceId: old.workspaceId,
      accountId: old.accountId,
      userId: old.userId,
      name: old.name,
      accessKeyId,
      secretCipher,
      secretHash,
      buckets: old.buckets,
      actions: old.actions,
      revoked: false,
      createdAt: Date.now(),
    });
    // Revoke the old one.
    await ctx.db.patch(id, { revoked: true });
    await audit(ctx, old.workspaceId, userId, "s3credential.rotate", {
      oldId: id,
      newId,
    });
    return { id: newId, accessKeyId, secretKey };
  },
});

/** Revoke a credential (takes effect immediately). */
export const revokeCredential = mutation({
  args: { id: v.id("s3Credentials") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const c = await ctx.db.get(id);
    if (!c) throw new ConvexError("Credential not found");
    await requireRole(ctx, userId, c.workspaceId, ["owner", "admin"]);
    await ctx.db.patch(id, { revoked: true });
    await audit(ctx, c.workspaceId, userId, "s3credential.revoke", {
      id,
      accessKeyId: c.accessKeyId,
    });
  },
});

/**
 * Internal: resolve a credential by access key id for the
 * gateway. Returns the decrypted secret + scope. Used only
 * server-side.
 */
export const resolveCredential = internalQuery({
  args: { accessKeyId: v.string() },
  handler: async (ctx, { accessKeyId }) => {
    const c = await ctx.db
      .query("s3Credentials")
      .withIndex("by_accessKey", (q) => q.eq("accessKeyId", accessKeyId))
      .unique();
    if (!c || c.revoked) return null;
    const account = await ctx.db.get(c.accountId);
    if (!account || account.status !== "active") return null;
    const secretKey = await decryptSecret(c.secretCipher);
    return {
      id: c._id,
      workspaceId: c.workspaceId,
      accountId: c.accountId,
      userId: c.userId,
      accessKeyId: c.accessKeyId,
      secretKey,
      buckets: c.buckets,
      actions: c.actions,
    };
  },
});

/** Internal: mark a credential as used (best-effort). */
export const touchCredential = internalMutation({
  args: { id: v.id("s3Credentials") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { lastUsedAt: Date.now() });
  },
});

/** Internal: list buckets belonging to an account (for scope checks). */
export const accountBucketIds = internalQuery({
  args: { accountId: v.id("storageAccounts") },
  handler: async (ctx, { accountId }) => {
    const rows = await ctx.db
      .query("buckets")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    return rows.map((b) => ({ _id: b._id, rustfsName: b.rustfsName }));
  },
});

export const createCredentialInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    userId: v.id("users"),
    name: v.string(),
    buckets: v.optional(v.array(v.id("buckets"))),
    actions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    requireDevSeed();
    const accessKeyId = generateAccessKeyId();
    const secretKey = generateSecretKey();
    const secretCipher = await encryptSecret(secretKey);
    const secretHash = await hashSecret(secretKey);

    const id = await ctx.db.insert("s3Credentials", {
      workspaceId: args.workspaceId,
      accountId: args.accountId,
      userId: args.userId,
      name: args.name,
      accessKeyId,
      secretCipher,
      secretHash,
      buckets: args.buckets,
      actions: args.actions,
      revoked: false,
      createdAt: Date.now(),
    });
    return { id, accessKeyId, secretKey };
  },
});

export { S3_ACTIONS };
