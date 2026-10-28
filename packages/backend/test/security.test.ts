/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { requireMember, requireRole } from "../convex/orgs";
import schema from "../convex/schema";

// Discover function modules for convex-test (convex/ tree, including
// _generated, excluding *.test.ts).
const modules = import.meta.glob([
  "../convex/**/*.*s",
  "!../convex/**/*.test.*",
]);

// Identity helper — getAuthUserId reads `subject = userId|sessionId`.
const as = (userId: string) => ({ subject: `${userId}|sess_${userId}` });

async function seedWorkspace(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "owner@t.test" });
    const member = await ctx.db.insert("users", { email: "member@t.test" });
    const outsider = await ctx.db.insert("users", { email: "outsider@t.test" });
    const ws = await ctx.db.insert("workspaces", {
      name: "WS",
      ownerId: owner,
      createdAt: Date.now(),
    });
    await ctx.db.insert("members", {
      workspaceId: ws,
      userId: owner,
      role: "owner",
      createdAt: Date.now(),
    });
    const memberRow = await ctx.db.insert("members", {
      workspaceId: ws,
      userId: member,
      role: "member",
      createdAt: Date.now(),
    });
    return { owner, member, outsider, ws, memberRow };
  });
}

describe("authorization helpers", () => {
  test("requireMember throws for a non-member", async () => {
    const t = convexTest(schema, modules);
    const { ws, outsider, member } = await seedWorkspace(t);
    await t.run(async (ctx) => {
      await expect(requireMember(ctx, member, ws)).resolves.toBeTruthy();
      await expect(requireMember(ctx, outsider, ws)).rejects.toThrow(
        /Forbidden/,
      );
    });
  });

  test("requireRole(owner) rejects a plain member", async () => {
    const t = convexTest(schema, modules);
    const { ws, owner, member } = await seedWorkspace(t);
    await t.run(async (ctx) => {
      await expect(
        requireRole(ctx, owner, ws, ["owner"]),
      ).resolves.toBeTruthy();
      await expect(requireRole(ctx, member, ws, ["owner"])).rejects.toThrow(
        /Forbidden/,
      );
    });
  });
});

describe("member management (RBAC + integrity)", () => {
  test("removeMember refuses to remove the owner", async () => {
    const t = convexTest(schema, modules);
    const { ws, owner } = await seedWorkspace(t);
    const ownerMemberRow = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("members")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
            .collect()
        ).find((m) => m.role === "owner")?._id,
    );
    await expect(
      t.withIdentity(as(owner)).mutation(api.orgs.removeMember, {
        workspaceId: ws,
        memberId: ownerMemberRow!,
      }),
    ).rejects.toThrow(/owner/i);
  });

  test("a plain member cannot remove anyone", async () => {
    const t = convexTest(schema, modules);
    const { ws, member, memberRow } = await seedWorkspace(t);
    await expect(
      t.withIdentity(as(member)).mutation(api.orgs.removeMember, {
        workspaceId: ws,
        memberId: memberRow,
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("changeRole rejects promotion to owner and bad roles", async () => {
    const t = convexTest(schema, modules);
    const { ws, owner, memberRow } = await seedWorkspace(t);
    const asOwner = t.withIdentity(as(owner));
    await expect(
      asOwner.mutation(api.orgs.changeRole, {
        workspaceId: ws,
        memberId: memberRow,
        role: "owner",
      }),
    ).rejects.toThrow(/Invalid role/);
    await expect(
      asOwner.mutation(api.orgs.changeRole, {
        workspaceId: ws,
        memberId: memberRow,
        role: "superuser",
      }),
    ).rejects.toThrow(/Invalid role/);
    await asOwner.mutation(api.orgs.changeRole, {
      workspaceId: ws,
      memberId: memberRow,
      role: "admin",
    });
    const role = await t.run(
      async (ctx) => (await ctx.db.get(memberRow))?.role,
    );
    expect(role).toBe("admin");
  });
});

describe("cross-tenant isolation (IDOR)", () => {
  test("an outsider cannot read another workspace's jobs", async () => {
    const t = convexTest(schema, modules);
    const { ws, outsider } = await seedWorkspace(t);
    await expect(
      t.withIdentity(as(outsider)).query(api.jobs.list, { workspaceId: ws }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("unauthenticated reads return empty, not an error", async () => {
    const t = convexTest(schema, modules);
    const { ws } = await seedWorkspace(t);
    expect(await t.query(api.jobs.list, { workspaceId: ws })).toEqual([]);
  });
});

describe("jobs.complete idempotency (webhook replay defense)", () => {
  test("completing an already-finished job is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { ws, owner } = await seedWorkspace(t);
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("jobs", {
        workspaceId: ws,
        userId: owner,
        kind: "demo",
        status: "done",
        result: { first: true },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.mutation(internal.jobs.complete, {
      jobId,
      result: { second: true },
    });
    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.result).toEqual({ first: true });
    expect(job?.status).toBe("done");
  });
});

// Full IDOR matrix: an authenticated outsider must be denied on EVERY workspace-scoped
// surface. This is the in-process, CI-runnable equivalent of the live p2-idor suite.
describe("cross-tenant isolation matrix (outsider vs workspace)", () => {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous fn table for a test matrix
  const cases: Array<[string, (b: any, ws: any) => Promise<unknown>]> = [
    ["jobs.list", (b, ws) => b.query(api.jobs.list, { workspaceId: ws })],
    [
      "jobs.listPaged",
      (b, ws) =>
        b.query(api.jobs.listPaged, {
          workspaceId: ws,
          paginationOpts: { numItems: 5, cursor: null },
        }),
    ],
    [
      "jobs.create",
      (b, ws) =>
        b.mutation(api.jobs.create, { workspaceId: ws, kind: "x", input: {} }),
    ],
    [
      "apiKeys.listMine",
      (b, ws) => b.query(api.apiKeys.listMine, { workspaceId: ws }),
    ],
    [
      "apiKeys.create",
      (b, ws) => b.action(api.apiKeys.create, { workspaceId: ws, name: "x" }),
    ],
    ["orgs.members", (b, ws) => b.query(api.orgs.members, { workspaceId: ws })],
    [
      "orgs.invite",
      (b, ws) =>
        b.mutation(api.orgs.invite, {
          workspaceId: ws,
          email: "x@x.test",
          role: "member",
        }),
    ],
    [
      "orgs.pendingInvites",
      (b, ws) => b.query(api.orgs.pendingInvites, { workspaceId: ws }),
    ],
    ["usage.mine", (b, ws) => b.query(api.usage.mine, { workspaceId: ws })],
    ["audit.recent", (b, ws) => b.query(api.audit.recent, { workspaceId: ws })],
    ["files.list", (b, ws) => b.query(api.files.list, { workspaceId: ws })],
    [
      "files.listPaged",
      (b, ws) =>
        b.query(api.files.listPaged, {
          workspaceId: ws,
          paginationOpts: { numItems: 5, cursor: null },
        }),
    ],
    [
      "files.generateUploadUrl",
      (b, ws) => b.mutation(api.files.generateUploadUrl, { workspaceId: ws }),
    ],
  ];
  for (const [name, call] of cases) {
    test(`outsider is denied: ${name}`, async () => {
      const t = convexTest(schema, modules);
      const { ws, outsider } = await seedWorkspace(t);
      await expect(call(t.withIdentity(as(outsider)), ws)).rejects.toThrow();
    });
  }
});

describe("maintained counters (dashboard.stats stays O(1) + correct)", () => {
  test("create workspace/job + complete keeps counters accurate", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "c@t.test" }),
    );
    const u = t.withIdentity(as(userId));

    const ws = await u.mutation(api.orgs.createWorkspace, { name: "C" });
    let s = await u.query(api.dashboard.stats, { workspaceId: ws });
    expect(s?.members).toBe(1); // owner
    expect(s?.jobs).toBe(0);

    await u.mutation(api.jobs.create, {
      workspaceId: ws,
      kind: "demo",
      input: {},
    });
    s = await u.query(api.dashboard.stats, { workspaceId: ws });
    expect(s?.jobs).toBe(1);
    expect(s?.openJobs).toBe(1);

    const jobId = await t.run(async (ctx) => {
      const j = await ctx.db
        .query("jobs")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
        .first();
      if (!j) throw new Error("job not found");
      return j._id;
    });
    await t.mutation(internal.jobs.complete, { jobId, result: { ok: true } });
    s = await u.query(api.dashboard.stats, { workspaceId: ws });
    expect(s?.openJobs).toBe(0); // left the open set
    expect(s?.jobs).toBe(1); // total unchanged
  });
});
