import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { requireMember } from "./orgs";

/**
 * Hybrid backend adapter — Convex side.
 * PROXY:   dashboard -> Convex action -> your backend (service key + userId).
 * WEBHOOK: your backend -> /backend/webhook (http.ts) -> events table -> live dashboard.
 */

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function doCall(
  userId: string,
  path: string,
  method: string,
  body: unknown,
) {
  const base = process.env.BACKEND_BASE_URL;
  if (!base) throw new Error("BACKEND_BASE_URL not set on the Convex deployment");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-service-key": process.env.BACKEND_SERVICE_KEY ?? "",
      "x-user-id": userId,
    },
    body:
      method === "GET" || method === "HEAD"
        ? undefined
        : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: safeJson(text) };
}

export const callBackend = action({
  args: {
    path: v.string(),
    method: v.optional(v.string()),
    body: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return doCall(userId, args.path, args.method ?? "POST", args.body);
  },
});

export const callBackendInternal = internalAction({
  args: {
    userId: v.string(),
    path: v.string(),
    method: v.optional(v.string()),
    body: v.optional(v.any()),
  },
  handler: async (_ctx, args) =>
    doCall(args.userId, args.path, args.method ?? "POST", args.body),
});

/** Called by the webhook HTTP action when the external backend pushes an event. */
export const ingestEvent = internalMutation({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    source: v.string(),
    type: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("events", {
      workspaceId: args.workspaceId,
      source: args.source,
      type: args.type,
      payload: args.payload,
      receivedAt: Date.now(),
    });
  },
});

/** Reactive: a workspace's recent inbound events (for the dashboard). */
export const listEvents = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    return ctx.db
      .query("events")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(50);
  },
});
