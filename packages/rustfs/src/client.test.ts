import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type Credential,
  RustFSClient,
  RustFSError,
  type ServiceAccount,
} from "./client";
import { rustfsConfigFromEnv } from "./config";
import { genToken } from "./validate";

const hasCredentials =
  Boolean(process.env.RUSTFS_ACCESS_KEY) &&
  Boolean(process.env.RUSTFS_SECRET_KEY);

// These integration tests run only when root credentials for a
// reachable RustFS instance are provided (see .env.example). They
// create and destroy only clearly namespaced test resources.
const describeLive = hasCredentials ? describe : describe.skip;

/** Random per-run namespace isolating every resource these tests create. */
const NAMESPACE = `s3storage-itest-${genToken(4)}`;

const ROOT: Credential = {
  accessKeyId: process.env.RUSTFS_ACCESS_KEY ?? "",
  secretAccessKey: process.env.RUSTFS_SECRET_KEY ?? "",
};

let client: RustFSClient | null = null;

type TestAccount = {
  accessKey: string;
  secretKey: string;
  credential: Credential;
};

let accountA: TestAccount | null = null;
let accountB: TestAccount | null = null;
let bucketA = "";
const createdPolicies: string[] = [];
const createdUsers: string[] = [];
const createdServiceAccounts: string[] = [];

/**
 * IAM policy restricting an account to buckets whose names start
 * with `prefix` — the per-tenant isolation mechanism.
 */
function scopedPolicy(prefix: string) {
  return {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: "s3:ListAllMyBuckets", Resource: "*" },
      {
        Effect: "Allow",
        Action: [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:GetBucketLocation",
          "s3:ListBucket",
        ],
        Resource: `arn:aws:s3:::${prefix}-*`,
      },
      {
        Effect: "Allow",
        Action: ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"],
        Resource: `arn:aws:s3:::${prefix}-*/*`,
      },
    ],
  };
}

async function provisionAccount(
  suffix: string,
  policyPrefix: string,
): Promise<TestAccount> {
  const accessKey = `${NAMESPACE}-acct-${suffix}`;
  const secretKey = genToken(32);
  await client!.createUser(accessKey, secretKey);
  createdUsers.push(accessKey);
  const policyName = `${NAMESPACE}-policy-${suffix}`;
  await client!.addCannedPolicy(policyName, scopedPolicy(policyPrefix));
  createdPolicies.push(policyName);
  await client!.setUserPolicy(policyName, accessKey);
  return {
    accessKey,
    secretKey,
    credential: { accessKeyId: accessKey, secretAccessKey: secretKey },
  };
}

beforeAll(async () => {
  if (!hasCredentials) return;
  client = new RustFSClient(rustfsConfigFromEnv());
  accountA = await provisionAccount("a", `${NAMESPACE}-a`);
  accountB = await provisionAccount("b", `${NAMESPACE}-b`);
  bucketA = `${NAMESPACE}-a-bucket`;
});

afterAll(async () => {
  if (!client) return;
  // Remove only what these tests created. Buckets are drained with
  // the root credential before deletion.
  if (bucketA) {
    const listing = await client.listObjectsV2(ROOT, bucketA).catch(() => null);
    for (const object of listing?.objects ?? []) {
      await client
        .deleteObject(ROOT, bucketA, object.key)
        .catch(() => undefined);
    }
    await client.deleteBucket(ROOT, bucketA).catch(() => undefined);
  }
  for (const accessKey of createdServiceAccounts) {
    await client.deleteServiceAccount(accessKey).catch(() => undefined);
  }
  for (const accessKey of createdUsers) {
    await client.deleteUser(accessKey).catch(() => undefined);
  }
  for (const policyName of createdPolicies) {
    await client.removeCannedPolicy(policyName).catch(() => undefined);
  }
});

describeLive("RustFSClient against the live RustFS instance", () => {
  test("root credential lists IAM users", async () => {
    const result = await client!.listUsers();
    expect(
      result.users.some((user) => user.accessKey === accountA!.accessKey),
    ).toBe(true);
  });

  test("bucket and object lifecycle with the account credential", async () => {
    const a = accountA!.credential;
    await client!.createBucket(a, bucketA);
    expect(await client!.bucketExists(a, bucketA)).toBe(true);

    const content = "hello from the vertical slice";
    const { etag } = await client!.putObject(
      a,
      bucketA,
      "hello.txt",
      content,
      "text/plain",
    );
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);

    const head = await client!.headObject(a, bucketA, "hello.txt");
    expect(head?.size).toBe(content.length);
    expect(head?.contentType).toBe("text/plain");

    const listing = await client!.listObjectsV2(a, bucketA);
    expect(listing.objects.map((object) => object.key)).toEqual(["hello.txt"]);
    expect(listing.keyCount).toBe(1);

    const res = await client!.getObject(a, bucketA, "hello.txt");
    expect(await res.text()).toBe(content);

    await client!.deleteObject(a, bucketA, "hello.txt");
    const after = await client!.listObjectsV2(a, bucketA);
    expect(after.objects).toEqual([]);
    expect(await client!.headObject(a, bucketA, "hello.txt")).toBeNull();
  });

  test("presigned PUT and GET round-trip without credentials in the request", async () => {
    const a = accountA!.credential;
    const key = "presigned/upload.txt";
    const body = new TextEncoder().encode("presigned content");
    const putUrl = await client!.presign(a, "PUT", bucketA, key, 300, {
      "Content-Type": "text/plain",
    });
    const upload = await fetch(putUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body,
    });
    expect(upload.status).toBe(200);

    const getUrl = await client!.presign(a, "GET", bucketA, key, 300);
    const download = await fetch(getUrl);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("presigned content");

    await client!.deleteObject(a, bucketA, key);
  });

  test("another account is denied access (IAM policy enforcement)", async () => {
    const b = accountB!.credential;
    // B may not read A's objects…
    await expect(
      client!.getObject(b, bucketA, "hello.txt"),
    ).rejects.toMatchObject({ status: 403 });
    // …may not write into A's bucket…
    await expect(
      client!.putObject(b, bucketA, "intrusion.txt", "nope"),
    ).rejects.toMatchObject({ status: 403 });
    // …and may not even stat A's bucket.
    await expect(client!.bucketExists(b, bucketA)).rejects.toMatchObject({
      status: 403,
    });
  });

  test("service accounts can be issued, listed and revoked", async () => {
    const serviceAccount: ServiceAccount = await client!.createServiceAccount({
      targetUser: accountA!.accessKey,
      name: `${NAMESPACE}-sa`,
      description: "integration test credential",
    });
    expect(serviceAccount.accessKey).not.toBe("");
    // The secret is returned only at creation time.
    expect(serviceAccount.secretKey).not.toBeNull();
    createdServiceAccounts.push(serviceAccount.accessKey);

    const listed = await client!.listServiceAccounts(accountA!.accessKey);
    expect(
      listed.some((account) => account.accessKey === serviceAccount.accessKey),
    ).toBe(true);
    // Secrets are never disclosed in listings.
    expect(listed.every((account) => account.secretKey === null)).toBe(true);

    await client!.deleteServiceAccount(serviceAccount.accessKey);
    const after = await client!.listServiceAccounts(accountA!.accessKey);
    expect(
      after.some((account) => account.accessKey === serviceAccount.accessKey),
    ).toBe(false);
  });

  test("missing objects produce typed 404 errors", async () => {
    await expect(
      client!.getObject(accountA!.credential, bucketA, "does-not-exist.txt"),
    ).rejects.toBeInstanceOf(RustFSError);
    try {
      await client!.getObject(
        accountA!.credential,
        bucketA,
        "does-not-exist.txt",
      );
      expect.unreachable("expected a RustFSError");
    } catch (err) {
      expect(err).toBeInstanceOf(RustFSError);
      expect((err as RustFSError).status).toBe(404);
    }
  });
});
