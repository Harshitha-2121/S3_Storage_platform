import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireDevSeed } from "./devGuard";

// Dependency-free counter helpers (no orgs import → no cycle). dashboard.stats reads these
// instead of .collect()-ing whole tables; mutations keep them current via bump().

async function counterRow(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  metric: string,
) {
  return ctx.db
    .query("counters")
    .withIndex("by_workspace_metric", (q) =>
      q.eq("workspaceId", workspaceId).eq("metric", metric),
    )
    .unique();
}

/** Adjust a workspace metric by delta (floored at 0). Creates the row if absent. */
export async function bump(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  metric: string,
  delta: number,
) {
  const row = await counterRow(ctx, workspaceId, metric);
  if (row) {
    await ctx.db.patch(row._id, { value: Math.max(0, row.value + delta) });
  } else {
    await ctx.db.insert("counters", {
      workspaceId,
      metric,
      value: Math.max(0, delta),
    });
  }
}

async function setCounter(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  metric: string,
  value: number,
) {
  const row = await counterRow(ctx, workspaceId, metric);
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("counters", { workspaceId, metric, value });
}

/** Read all counters for a workspace as a map (O(#metrics), ~5 rows). */
export async function readCounters(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Record<string, number>> {
  const rows = await ctx.db
    .query("counters")
    .withIndex("by_workspace_metric", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.metric] = r.value;
  return out;
}

/** One-time migration: recompute counters from existing rows for every workspace. */
export const backfillAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireDevSeed();
    const workspaces = await ctx.db.query("workspaces").collect();
    for (const ws of workspaces) {
      const [jobs, files, members] = await Promise.all([
        ctx.db
          .query("jobs")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
          .collect(),
        ctx.db
          .query("files")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
          .collect(),
        ctx.db
          .query("members")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
          .collect(),
      ]);
      const openJobs = jobs.filter(
        (j) => j.status === "pending" || j.status === "running",
      ).length;
      await setCounter(ctx, ws._id, "jobs", jobs.length);
      await setCounter(ctx, ws._id, "openJobs", openJobs);
      await setCounter(ctx, ws._id, "files", files.length);
      await setCounter(ctx, ws._id, "members", members.length);
      // Storage metrics.
      const storageAccounts = await ctx.db
        .query("storageAccounts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
        .collect();
      const wsBuckets = await ctx.db
        .query("buckets")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
        .collect();
      await setCounter(ctx, ws._id, "storageAccounts", storageAccounts.length);
      await setCounter(ctx, ws._id, "buckets", wsBuckets.length);
    }
    return workspaces.length;
  },
});
