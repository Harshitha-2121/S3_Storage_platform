import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
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
import { requireDevSeed } from "./devGuard";
import { requireMember, requireRole } from "./orgs";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return toHex(new Uint8Array(buf));
}
function genKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `sk_${toHex(bytes)}`;
}

export const store = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    name: v.string(),
    prefix: v.string(),
    hash: v.string(),
  },
  handler: async (ctx, a) => {
    await requireMember(ctx, a.userId, a.workspaceId);
    const id = await ctx.db.insert("apiKeys", {
      workspaceId: a.workspaceId,
      userId: a.userId,
      name: a.name,
      prefix: a.prefix,
      hash: a.hash,
      revoked: false,
      createdAt: Date.now(),
    });
    await audit(ctx, a.workspaceId, a.userId, "apikey.create", {
      name: a.name,
    });
    return id;
  },
});

/** Public: issue a workspace key for the authed user. Plaintext is returned ONCE. */
export const create = action({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, { workspaceId, name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const key = genKey();
    await ctx.runMutation(internal.apiKeys.store, {
      workspaceId,
      userId,
      name,
      prefix: key.slice(0, 11),
      hash: await sha256Hex(key),
    });
    return { key, prefix: key.slice(0, 11) };
  },
});

export const createForUser = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, { workspaceId, userId, name }) => {
    requireDevSeed();
    const key = genKey();
    await ctx.runMutation(internal.apiKeys.store, {
      workspaceId,
      userId,
      name,
      prefix: key.slice(0, 11),
      hash: await sha256Hex(key),
    });
    return { key };
  },
});

export const listMine = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
    return keys.map((k) => ({
      _id: k._id,
      name: k.name,
      prefix: k.prefix,
      revoked: k.revoked,
      createdAt: k.createdAt,
    }));
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const k = await ctx.db.get(id);
    if (!k) throw new Error("Not found");
    if (k.workspaceId) {
      await requireMember(ctx, userId, k.workspaceId);
      // Owner/admin may revoke any key; members only their own.
      try {
        await requireRole(ctx, userId, k.workspaceId, ["owner", "admin"]);
      } catch {
        if (k.userId !== userId) throw new Error("Forbidden");
      }
    } else if (k.userId !== userId) throw new Error("Forbidden");
    await ctx.db.patch(id, { revoked: true });
    if (k.workspaceId)
      await audit(ctx, k.workspaceId, userId, "apikey.revoke", {
        name: k.name,
      });
  },
});

/** Used by /api/verify-key — resolves a presented key to its user + workspace. */
export const resolveByHash = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const k = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!k || k.revoked) return null;
    return {
      userId: k.userId,
      workspaceId: k.workspaceId ?? null,
      keyId: k._id,
      name: k.name,
    };
  },
});
