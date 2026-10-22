/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { privateBucketNameForUser } from "../convex/storageValidate";

// Discover function modules for convex-test (convex/ tree, including
// _generated, excluding *.test.ts).
const modules = import.meta.glob(["../convex/**/*.*s", "!../convex/**/*.test.*"]);

async function seedUser(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("users", {
      email: "newbie@t.test",
      username: "newbie",
    });
  });
}

describe("privateBucketNameForUser", () => {
  test("uses the username", () => {
    expect(
      privateBucketNameForUser({ username: "harshitha", userId: "x" }),
    ).toBe("harshitha-storage");
  });
  test("falls back to the email prefix", () => {
    expect(
      privateBucketNameForUser({ email: "User.A@t.test", userId: "x" }),
    ).toBe("usera-storage");
  });
  test("falls back to the user id", () => {
    expect(privateBucketNameForUser({ userId: "m57b17kgg25aznx" })).toBe(
      "user-gg25aznx-storage",
    );
  });
  test("names stay DNS-safe", () => {
    const name = privateBucketNameForUser({
      username: "ab",
      email: "a b@c.test",
      userId: "id",
    });
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });
});

describe("provisioning mutations (idempotent)", () => {
  test("workspace + account converge on re-run", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);

    const ws1 = await t.mutation(internal.provisioning.ensureWorkspaceForUser, {
      userId,
    });
    const ws2 = await t.mutation(internal.provisioning.ensureWorkspaceForUser, {
      userId,
    });
    expect(ws2).toEqual(ws1);

    const a1 = await t.mutation(internal.provisioning.ensureAccountForUser, {
      userId,
      workspaceId: ws1,
    });
    const a2 = await t.mutation(internal.provisioning.ensureAccountForUser, {
      userId,
      workspaceId: ws1,
    });
    expect(a2.accountId).toEqual(a1.accountId);
    expect(a2.accountCode).toEqual(a1.accountCode);
  });

  test("bucket record + first credential are singletons", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const workspaceId = await t.mutation(
      internal.provisioning.ensureWorkspaceForUser,
      { userId },
    );
    const { accountId } = await t.mutation(
      internal.provisioning.ensureAccountForUser,
      { userId, workspaceId },
    );

    const r1 = await t.mutation(internal.provisioning.recordBucketForUser, {
      userId,
      workspaceId,
      accountId,
      name: "newbie-storage",
      rustfsName: "code1234-newbie-storage",
    });
    const r2 = await t.mutation(internal.provisioning.recordBucketForUser, {
      userId,
      workspaceId,
      accountId,
      name: "newbie-storage",
      rustfsName: "code1234-newbie-storage",
    });
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.bucketId).toEqual(r1.bucketId);

    const c1 = await t.mutation(
      internal.provisioning.createFirstCredentialForUser,
      { userId, workspaceId, accountId, bucketId: r1.bucketId },
    );
    expect(c1).not.toBeNull();
    expect(c1?.accessKeyId).toMatch(/\S+/);
    expect(c1?.secretKey).toMatch(/\S+/);
    const c2 = await t.mutation(
      internal.provisioning.createFirstCredentialForUser,
      { userId, workspaceId, accountId, bucketId: r1.bucketId },
    );
    expect(c2).toBeNull();
  });
});
