import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, query } from "./_generated/server";
import { requireMember } from "./orgs";

/** Plain helper — increment a workspace's usage counter from any mutation. */
export async function recordUsage(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  metric: string,
  by = 1,
) {
  const existing = await ctx.db
    .query("usage")
    .withIndex("by_workspace_metric", (q) =>
      q.eq("workspaceId", workspaceId).eq("metric", metric),
    )
    .unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      count: existing.count + by,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("usage", { workspaceId, metric, count: by, updatedAt: now });
  }
}

export const record = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    metric: v.string(),
    by: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await recordUsage(ctx, a.workspaceId, a.metric, a.by ?? 1);
  },
});

export const mine = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    return ctx.db
      .query("usage")
      .withIndex("by_workspace_metric", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});
