import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { audit } from "./auditLog";
import { requireDevSeed } from "./devGuard";
import { requireMember } from "./orgs";

export { audit } from "./auditLog";

/** Internal entry point (explicit userId) — for automation/testing. */
export const record = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    action: v.string(),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    requireDevSeed();
    await audit(ctx, a.workspaceId, a.userId, a.action, a.meta);
  },
});

/** Reactive: the current user's recent audit entries (for the dashboard). */
export const recent = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    return ctx.db
      .query("auditLogs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(50);
  },
});
