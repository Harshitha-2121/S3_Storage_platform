import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

/**
 * Session management. Revoking deletes the session + its refresh tokens, so the
 * device can't refresh; its current JWT still works until expiry (~1h max).
 */

export const mySessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const current = await getAuthSessionId(ctx);
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    return sessions
      .map((s) => ({
        _id: s._id,
        createdAt: s._creationTime,
        expires: s.expirationTime,
        isCurrent: s._id === current,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

async function destroySession(ctx: MutationCtx, sessionId: Id<"authSessions">) {
  const tokens = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const t of tokens) await ctx.db.delete(t._id);
  await ctx.db.delete(sessionId);
}

export const revokeSession = mutation({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const s = await ctx.db.get(sessionId);
    if (!s || s.userId !== userId) throw new ConvexError("Not found");
    await destroySession(ctx, sessionId);
  },
});

/** Sign out everywhere else: revoke all of the user's sessions except this one. */
export const revokeOtherSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    const current = await getAuthSessionId(ctx);
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    let n = 0;
    for (const s of sessions) {
      if (s._id === current) continue;
      await destroySession(ctx, s._id);
      n++;
    }
    return n;
  },
});
