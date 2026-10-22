import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireDevSeed } from "./devGuard";

// Dev-only load generators + read profilers (DEV_SEED gated). Used to measure the
// read-amplification of count-by-collect queries on a large workspace.

export const seedJobs = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    count: v.number(),
  },
  handler: async (ctx, { workspaceId, userId, count }) => {
    requireDevSeed();
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("jobs", {
        workspaceId,
        userId,
        kind: "seed",
        status: i % 4 === 0 ? "pending" : "done",
        input: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    return count;
  },
});

export const seedNotifications = internalMutation({
  args: { userId: v.id("users"), count: v.number() },
  handler: async (ctx, { userId, count }) => {
    requireDevSeed();
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("notifications", {
        userId,
        type: "seed",
        title: "seed",
        read: i % 2 === 0,
        createdAt: now,
      });
    }
    return count;
  },
});

/** Reports rows READ by the dashboard.stats logic (= the amplification per re-render). */
export const profileStats = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    requireDevSeed();
    const [jobs, members, files, usage] = await Promise.all([
      ctx.db
        .query("jobs")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("files")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("usage")
        .withIndex("by_workspace_metric", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ]);
    return {
      rowsRead: jobs.length + members.length + files.length + usage.length,
      jobs: jobs.length,
    };
  },
});

/** OLD unreadCount behaviour: collect ALL notifications to count unread. */
export const profileUnreadOld = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    requireDevSeed();
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return { rowsRead: rows.length, unread: rows.filter((n) => !n.read).length };
  },
});

/** Remove seeded rows in batches (call until it returns 0). */
export const seedCleanupBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireDevSeed();
    let deleted = 0;
    const notifs = await ctx.db.query("notifications").take(2000);
    for (const n of notifs)
      if (n.type === "seed") {
        await ctx.db.delete(n._id);
        deleted++;
      }
    const jobs = await ctx.db.query("jobs").take(2000);
    for (const j of jobs)
      if (j.kind === "seed") {
        await ctx.db.delete(j._id);
        deleted++;
      }
    return deleted;
  },
});

/** NEW unreadCount behaviour: indexed + capped at 10. */
export const profileUnreadNew = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    requireDevSeed();
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", userId).eq("read", false))
      .take(10);
    return { rowsRead: rows.length };
  },
});
