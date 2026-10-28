// Storage accounts — the top-level ownership + quota unit.
// An account belongs to one workspace and is managed by its
// owner/admins. Members may view; only owner/admin may mutate.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { audit } from "./auditLog";
import { bump } from "./counters";
import { requireMember, requireRole } from "./orgs";
import { accountNameError } from "./storageValidate";

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export async function uniqueAccountCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt++) {
    let code = "";
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    const clash = await ctx.db
      .query("storageAccounts")
      .withIndex("by_accountCode", (q) => q.eq("accountCode", code))
      .unique();
    if (!clash) return code;
  }
  throw new ConvexError("Could not allocate a unique account code");
}

async function accountUsage(ctx: QueryCtx, accountId: Id<"storageAccounts">) {
  const buckets = await ctx.db
    .query("buckets")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  let bytes = 0;
  let objects = 0;
  for (const b of buckets) {
    const rows = await ctx.db
      .query("objects")
      .withIndex("by_bucket", (q) => q.eq("bucketId", b._id))
      .collect();
    objects += rows.length;
    bytes += rows.reduce((n, o) => n + o.size, 0);
  }
  return { buckets: buckets.length, objects, bytes };
}

/** Create a storage account in the caller's workspace. */
export const createAccount = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    storageQuotaBytes: v.optional(v.number()),
    maxBuckets: v.optional(v.number()),
    maxObjectBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    await requireMember(ctx, userId, args.workspaceId);
    const nameErr = accountNameError(args.name);
    if (nameErr) throw new ConvexError(nameErr);

    const accountCode = await uniqueAccountCode(ctx);
    const now = Date.now();
    const accountId = await ctx.db.insert("storageAccounts", {
      workspaceId: args.workspaceId,
      userId,
      name: args.name.trim(),
      accountCode,
      status: "active",
      storageQuotaBytes: args.storageQuotaBytes ?? 50 * 1024 * 1024 * 1024, // 50 GiB
      maxBuckets: args.maxBuckets ?? 50,
      maxObjectBytes: args.maxObjectBytes ?? 5 * 1024 * 1024 * 1024, // 5 GiB
      createdAt: now,
    });
    await audit(ctx, args.workspaceId, userId, "storageaccount.create", {
      accountId,
      name: args.name,
      accountCode,
    });
    await bump(ctx, args.workspaceId, "storageAccounts", 1);
    return { accountId, accountCode };
  },
});

/** Idempotently ensure the workspace has at least one active storage account. */
export const ensureDefaultAccount = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    await requireMember(ctx, userId, workspaceId);

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

/** Accounts the caller can see in a workspace. */
export const listAccounts = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    const rows = await ctx.db
      .query("storageAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
    const out = [];
    for (const a of rows) {
      const usage = await accountUsage(ctx, a._id);
      out.push({ ...a, usage });
    }
    return out;
  },
});

/** Single account detail (with usage). */
export const getAccount = query({
  args: { id: v.id("storageAccounts") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const a = await ctx.db.get(id);
    if (!a) return null;
    await requireMember(ctx, userId, a.workspaceId);
    const usage = await accountUsage(ctx, a._id);
    return { ...a, usage };
  },
});

/** Update account label / quota (owner or admin). */
export const updateAccount = mutation({
  args: {
    id: v.id("storageAccounts"),
    name: v.optional(v.string()),
    storageQuotaBytes: v.optional(v.number()),
    maxBuckets: v.optional(v.number()),
    maxObjectBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const a = await ctx.db.get(args.id);
    if (!a) throw new ConvexError("Account not found");
    await requireRole(ctx, userId, a.workspaceId, ["owner", "admin"]);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const err = accountNameError(args.name);
      if (err) throw new ConvexError(err);
      patch.name = args.name.trim();
    }
    if (args.storageQuotaBytes !== undefined) {
      if (
        !Number.isFinite(args.storageQuotaBytes) ||
        args.storageQuotaBytes < 0 ||
        args.storageQuotaBytes > 5 * 1024 ** 4
      )
        throw new ConvexError("Invalid storage quota");
      patch.storageQuotaBytes = args.storageQuotaBytes;
    }
    if (args.maxBuckets !== undefined) {
      if (
        !Number.isInteger(args.maxBuckets) ||
        args.maxBuckets < 1 ||
        args.maxBuckets > 1000
      )
        throw new ConvexError("Invalid bucket limit");
      patch.maxBuckets = args.maxBuckets;
    }
    if (args.maxObjectBytes !== undefined) {
      if (
        !Number.isFinite(args.maxObjectBytes) ||
        args.maxObjectBytes < 1 ||
        args.maxObjectBytes > 5 * 1024 ** 3
      )
        throw new ConvexError("Invalid max object size");
      patch.maxObjectBytes = args.maxObjectBytes;
    }
    await ctx.db.patch(args.id, patch);
    await audit(ctx, a.workspaceId, userId, "storageaccount.update", {
      accountId: args.id,
    });
  },
});

/** Disable an account (blocks new S3 operations). */
export const disableAccount = mutation({
  args: { id: v.id("storageAccounts") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const a = await ctx.db.get(id);
    if (!a) throw new ConvexError("Account not found");
    await requireRole(ctx, userId, a.workspaceId, ["owner", "admin"]);
    await ctx.db.patch(id, { status: "disabled", disabledAt: Date.now() });
    await audit(ctx, a.workspaceId, userId, "storageaccount.disable", {
      accountId: id,
    });
  },
});

/** Re-enable a disabled account. */
export const enableAccount = mutation({
  args: { id: v.id("storageAccounts") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const a = await ctx.db.get(id);
    if (!a) throw new ConvexError("Account not found");
    await requireRole(ctx, userId, a.workspaceId, ["owner", "admin"]);
    await ctx.db.patch(id, {
      status: "active",
      disabledAt: undefined,
    });
    await audit(ctx, a.workspaceId, userId, "storageaccount.enable", {
      accountId: id,
    });
  },
});

/**
 * Delete an account. Safe lifecycle: refuses while the account
 * still owns buckets unless `force` is set, in which case the
 * caller must also empty them first (handled by the bucket
 * delete path). Here we only allow deletion when empty.
 */
export const deleteAccount = mutation({
  args: { id: v.id("storageAccounts") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const a = await ctx.db.get(id);
    if (!a) throw new ConvexError("Account not found");
    await requireRole(ctx, userId, a.workspaceId, ["owner", "admin"]);
    const buckets = await ctx.db
      .query("buckets")
      .withIndex("by_account", (q) => q.eq("accountId", id))
      .collect();
    if (buckets.length > 0) {
      throw new ConvexError(
        "Account still contains buckets. Delete all buckets first.",
      );
    }
    await ctx.db.delete(id);
    await bump(ctx, a.workspaceId, "storageAccounts", -1);
    await audit(ctx, a.workspaceId, userId, "storageaccount.delete", {
      accountId: id,
    });
  },
});

/** Internal: assert an account is active and owned by a workspace. */
export const assertAccountUsable = internalMutation({
  args: { id: v.id("storageAccounts"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    const a = await ctx.db.get(id);
    if (!a) throw new ConvexError("Account not found");
    await requireMember(ctx, userId, a.workspaceId);
    if (a.status !== "active") {
      throw new ConvexError("Storage account is disabled");
    }
    return a;
  },
});

/** Internal helper used by the gateway (server-side only). Private to prevent account enumeration. */
export const resolveAccount = internalQuery({
  args: { id: v.id("storageAccounts") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});
