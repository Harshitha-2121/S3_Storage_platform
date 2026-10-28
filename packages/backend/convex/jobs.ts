import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { audit } from "./auditLog";
import { bump } from "./counters";
import { requireDevSeed } from "./devGuard";
import { notify } from "./notifications";
import { requireMember } from "./orgs";
import { recordUsage } from "./usage";

/**
 * Jobs module — workspace-scoped async/AI task primitive.
 * create -> processJob (proxy to backend) -> backend webhooks job.result -> complete.
 */

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    return ctx.db
      .query("jobs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(50);
  },
});

export const listPaged = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { workspaceId, paginationOpts }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { page: [], isDone: true, continueCursor: "" };
    await requireMember(ctx, userId, workspaceId);
    return ctx.db
      .query("jobs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    kind: v.string(),
    input: v.optional(v.any()),
  },
  handler: async (ctx, { workspaceId, kind, input }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireMember(ctx, userId, workspaceId);
    const jobId = await insertJob(ctx, workspaceId, userId, kind, input);
    return jobId;
  },
});

export const createInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    kind: v.string(),
    input: v.optional(v.any()),
  },
  handler: async (ctx, { workspaceId, userId, kind, input }) => {
    requireDevSeed();
    return insertJob(ctx, workspaceId, userId, kind, input);
  },
});

async function insertJob(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
  kind: string,
  input: unknown,
) {
  const now = Date.now();
  const jobId = await ctx.db.insert("jobs", {
    workspaceId,
    userId,
    kind,
    status: "pending",
    input: input ?? {},
    createdAt: now,
    updatedAt: now,
  });
  await recordUsage(ctx, workspaceId, "jobs.created");
  await audit(ctx, workspaceId, userId, "job.create", { jobId, kind });
  await bump(ctx, workspaceId, "jobs", 1);
  await bump(ctx, workspaceId, "openJobs", 1);
  await ctx.scheduler.runAfter(0, internal.jobs.processJob, { jobId });
  return jobId;
}

export const processJob = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await ctx.runMutation(internal.jobs.setStatus, {
      jobId,
      status: "running",
    });
    const job = await ctx.runQuery(internal.jobs.get, { jobId });
    if (!job) return;
    const rawBase = process.env.BACKEND_BASE_URL;
    if (!rawBase) {
      await ctx.runMutation(internal.jobs.complete, {
        jobId,
        error:
          "Backend configuration is missing. Set BACKEND_BASE_URL in the Convex deployment environment (e.g. `bunx convex env set BACKEND_BASE_URL http://host.docker.internal:4000`), ensure the external backend is running, then run the job again.",
      });
      return;
    }
    let base: string;
    try {
      base = normalizeBackendUrl(rawBase);
    } catch (e) {
      await ctx.runMutation(internal.jobs.complete, {
        jobId,
        error: `Backend configuration is invalid: ${(e as Error).message}`,
      });
      return;
    }
    try {
      const res = await fetch(`${base}/jobs/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-key": process.env.BACKEND_SERVICE_KEY ?? "",
          "x-user-id": job.userId,
        },
        body: JSON.stringify({ jobId, kind: job.kind, input: job.input }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        await ctx.runMutation(internal.jobs.complete, {
          jobId,
          error: `Backend processing failed (HTTP ${res.status}). Check the external backend logs and try again.`,
        });
        return;
      }
      // 202 Accepted: the backend webhooks job.result back asynchronously.
      if (res.status === 202) return;
      // Synchronous result: complete inline so jobs never stick in running.
      try {
        const body = (await res.json()) as {
          result?: unknown;
          error?: string;
        };
        if (
          body &&
          typeof body === "object" &&
          ("result" in body || "error" in body)
        ) {
          await ctx.runMutation(internal.jobs.complete, {
            jobId,
            result: body.result,
            error: body.error,
          });
          return;
        }
      } catch {
        // Non-JSON 200 (e.g. empty): fall through to done below.
      }
      await ctx.runMutation(internal.jobs.complete, {
        jobId,
        result: { httpStatus: res.status },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /fetch failed|connect|ECONNREFUSED|ENOTFOUND/i.test(msg)
        ? " The backend looks unreachable — is it running and is BACKEND_BASE_URL correct?"
        : "";
      await ctx.runMutation(internal.jobs.complete, {
        jobId,
        error: `Could not reach the backend (${msg}).${hint}`,
      });
    }
  },
});

/**
 * Normalize + validate the external backend base URL.
 * Strips trailing slashes; only http(s) allowed. Throws on invalid input.
 * Pure (no Convex dependencies) so it is unit-testable.
 */
export function normalizeBackendUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `URL must use http or https (got "${url.protocol.replace(":", "")}").`,
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export const get = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

export const setStatus = internalMutation({
  args: { jobId: v.id("jobs"), status: v.string() },
  handler: async (ctx, { jobId, status }) => {
    await ctx.db.patch(jobId, { status, updatedAt: Date.now() });
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("jobs"),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, result, error }) => {
    // Defend against webhook tampering/replay: ignore unknown ids and already-finished jobs.
    const job = await ctx.db.get(jobId);
    if (!job) return;
    if (job.status === "done" || job.status === "error") return;
    await ctx.db.patch(jobId, {
      status: error ? "error" : "done",
      result,
      error,
      updatedAt: Date.now(),
    });
    // Job left the open set (guard above ensures this runs once per job).
    if (job.workspaceId) await bump(ctx, job.workspaceId, "openJobs", -1);
    await notify(
      ctx,
      job.userId,
      "job",
      error ? "Job failed" : "Job completed",
      job.kind,
    );
    // Feed the Platform events card: every completion is also an event,
    // so the dashboard fills itself without manual emits.
    if (job.workspaceId) {
      await ctx.db.insert("events", {
        workspaceId: job.workspaceId,
        source: "backend",
        type: error ? "job.error" : "job.done",
        payload: { jobId, kind: job.kind, result, error },
        receivedAt: Date.now(),
      });
    }
  },
});

export const firstUserId = internalQuery({
  args: {},
  handler: async (ctx) => {
    requireDevSeed();
    const u = await ctx.db.query("users").first();
    return u?._id ?? null;
  },
});
