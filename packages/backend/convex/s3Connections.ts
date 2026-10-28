// Automatic S3 connection provisioning — control plane.
//
// This module coordinates "Connect application" in the dashboard with the
// repository's reference external backend (backend-echo). It does NOT try to
// modify arbitrary hosts' files (impossible for Convex); instead it delivers
// scoped credentials to a registered consumer URL using a dedicated shared
// secret and waits for the consumer to confirm that it has persisted, reloaded
// and verified them.
//
// Security model:
//   * Only owner/admin can start/rotate/disconnect.
//   * Consumer bindings are server-configured, never user-chosen.
//   * Credentials are created with the narrowest scope:
//       account = the bucket's storage account
//       buckets = [selected bucket]
//       actions = [s3:ListBucket, s3:GetObject, s3:PutObject, s3:DeleteObject]
//   * The secret is sent once, server-to-server, and never stored in any
//     dashboard response or connection record.
//   * A pending/active split prevents rotation from revoking the old key before
//     the consumer has loaded the new one.
//   * Idempotency: retrying the same unresolved operation reuses the pending
//     credential; starting a new operation while another is unresolved is
//     rejected.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { audit } from "./auditLog";
import { decryptSecret, encryptSecret, generateAccessKeyId, generateSecretKey, hashSecret } from "./credCrypto";
import { requireMember, requireRole } from "./orgs";

// Server-configured registry of allowed consumers and their secrets.
// Example env shape:
//   S3_CONNECTION_CONSUMERS=echo:https://host:4000/s3-connections/apply
//   S3_CONNECTION_SECRET_echo=32-byte-hex-secret
// The public URL is in env; the secret is looked up via the same prefix.
const CONSUMER_ENV = process.env.S3_CONNECTION_CONSUMERS || "";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CONNECT_ACTIONS = [
  "s3:ListBucket",
  "s3:GetObject",
  "s3:PutObject",
  "s3:DeleteObject",
] as const;

type ConnectionRow = DataModel["s3Connections"]["document"];

export class ProvisioningError extends ConvexError {
  constructor(public code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function getGatewayEndpoint(): string {
  const raw = process.env.S3_GATEWAY_ENDPOINT || process.env.S3_GATEWAY_PUBLIC_URL || "";
  if (!raw) return "";
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/, "") || "/s3";
  url.pathname = path;
  return url.toString().replace(/\/$/, "");
}

function parseConsumers(): Map<string, { deliveryUrl: string; secretEnv: string }> {
  const out = new Map<string, { deliveryUrl: string; secretEnv: string }>();
  if (!CONSUMER_ENV) return out;
  for (const entry of CONSUMER_ENV.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf(":");
    if (eq <= 0) continue;
    const id = entry.slice(0, eq);
    const url = entry.slice(eq + 1);
    if (!ID_RE.test(id)) continue;
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    out.set(id, {
      deliveryUrl: url.replace(/\/+$/, ""),
      secretEnv: `S3_CONNECTION_SECRET_${id}`,
    });
  }
  return out;
}

/** A registered consumer binding is server-configured only. */
function resolveConsumer(consumerId: string) {
  const consumers = parseConsumers();
  const c = consumers.get(consumerId);
  if (!c) {
    throw new ProvisioningError("ConsumerNotRegistered", `Consumer "${consumerId}" is not registered for this deployment`);
  }
  const secret = process.env[c.secretEnv];
  if (!secret || secret.length < 32) {
    throw new ProvisioningError("ConsumerNotConfigured", `No delivery secret configured for consumer "${consumerId}"`);
  }
  return { deliveryUrl: c.deliveryUrl, secret };
}

/** Authorize caller and return validated connection record context. */
async function authConnection(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  bucketId: Id<"buckets">,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ProvisioningError("NotAuthenticated", "Not authenticated");
  await requireRole(ctx, userId, workspaceId, ["owner", "admin"]);

  const bucket = await ctx.db.get(bucketId);
  if (!bucket || bucket.workspaceId !== workspaceId) {
    throw new ProvisioningError("BucketNotFound", "Bucket not found");
  }
  const account = await ctx.db.get(bucket.accountId);
  if (!account || account.workspaceId !== workspaceId || account.status !== "active") {
    throw new ProvisioningError("AccountNotFound", "Storage account not found or disabled");
  }
  return { userId, bucket, account };
}

/** Idempotent scoped credential creation helper. */
async function createScopedCredential(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  accountId: Id<"storageAccounts">,
  userId: Id<"users">,
  bucketId: Id<"buckets">,
  name: string,
): Promise<{ id: Id<"s3Credentials">; accessKeyId: string; secretKey: string }> {
  const accessKeyId = generateAccessKeyId();
  const secretKey = generateSecretKey();
  const secretCipher = await encryptSecret(secretKey);
  const secretHash = await hashSecret(secretKey);
  const id = await ctx.db.insert("s3Credentials", {
    workspaceId,
    accountId,
    userId,
    name,
    accessKeyId,
    secretCipher,
    secretHash,
    buckets: [bucketId],
    actions: [...CONNECT_ACTIONS],
    revoked: false,
    createdAt: Date.now(),
  });
  return { id, accessKeyId, secretKey };
}

/** Build the next version, rejecting concurrent unresolved operations. */
function nextVersion(
  row: ConnectionRow | null,
  proposed: number,
  wantsNewOperation: boolean,
): number {
  const current = row?.version ?? 0;
  if (wantsNewOperation) {
    if (row?.pendingCredentialId || (row && row.status !== "active" && row.status !== "disconnected")) {
      throw new ProvisioningError(
        "OperationInProgress",
        `An earlier ${row.status} operation is still unresolved; retry that operation or wait for it to complete`,
      );
    }
    return current + 1;
  }
  if (!Number.isSafeInteger(proposed) || proposed < 1) {
    throw new ProvisioningError("InvalidVersion", "Invalid version");
  }
  if (proposed < current) {
    throw new ProvisioningError("StaleVersion", `Version ${proposed} is older than stored ${current}`);
  }
  // For retry of the same unresolved operation, keep the current version.
  return proposed === current ? current : proposed;
}

export const listRegisteredConsumers = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);

    const consumers = parseConsumers();
    const rows = await ctx.db
      .query("s3Connections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return [...consumers.keys()].map((consumerId) => {
      const row = rows.find((r) => r.consumerId === consumerId);
      return {
        consumerId,
        deliveryUrl: consumers.get(consumerId)!.deliveryUrl,
        status: row?.status ?? "disconnected",
        statusAt: row?.statusAt,
        version: row?.version ?? 0,
        bucketId: row?.bucketId,
        connectionId: row?.connectionId,
        accessKeyId: row?.activeCredentialId ? "configured" : null,
        errorCode: row?.errorCode,
      };
    });
  },
});

export const listMyConnections = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await requireMember(ctx, userId, workspaceId);
    const rows = await ctx.db
      .query("s3Connections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      consumerId: r.consumerId,
      connectionId: r.connectionId,
      bucketId: r.bucketId,
      status: r.status,
      statusAt: r.statusAt,
      version: r.version,
      activeCredentialId: r.activeCredentialId ? true : false,
      pendingCredentialId: r.pendingCredentialId ? true : false,
      errorCode: r.errorCode,
    }));
  },
});

/** Public: start or retry connecting a registered consumer to a bucket. */
export const connect = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    bucketId: v.id("buckets"),
    consumerId: v.string(),
    // Optional explicit version for retries; absent means a new attempt.
    version: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, bucketId, consumerId, version }) => {
    const { userId, bucket, account } = await authConnection(ctx, workspaceId, bucketId);
    const consumer = resolveConsumer(consumerId);
    const gatewayEndpoint = getGatewayEndpoint();
    if (!gatewayEndpoint) {
      throw new ProvisioningError("GatewayNotConfigured", "S3 gateway endpoint is not configured");
    }

    const connectionId = `${consumerId}-${bucketId}`;
    const existing = await ctx.db
      .query("s3Connections")
      .withIndex("by_connection", (q) =>
        q.eq("workspaceId", workspaceId).eq("consumerId", consumerId).eq("connectionId", connectionId),
      )
      .unique();

    const isNewOperation = version === undefined;
    const next = nextVersion(existing, version ?? 0, isNewOperation);

    let credentialId: Id<"s3Credentials">;
    let secret: string;
    let accessKeyId: string;

    if (existing?.pendingCredentialId) {
      // Reuse the pending credential for a retry of the same version.
      const pending = await ctx.db.get(existing.pendingCredentialId);
      if (!pending || pending.revoked) {
        // Pending credential is gone; we must create a new one.
        const created = await createScopedCredential(
          ctx,
          workspaceId,
          account._id,
          userId,
          bucketId,
          `${consumerId} auto-provision`,
        );
        credentialId = created.id;
        accessKeyId = created.accessKeyId;
        secret = created.secretKey;
      } else {
        credentialId = existing.pendingCredentialId;
        accessKeyId = pending.accessKeyId;
        secret = await decryptSecret(pending.secretCipher);
      }
    } else {
      const created = await createScopedCredential(
        ctx,
        workspaceId,
        account._id,
        userId,
        bucketId,
        `${consumerId} auto-provision`,
      );
      credentialId = created.id;
      accessKeyId = created.accessKeyId;
      secret = created.secretKey;
    }

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        pendingCredentialId: credentialId,
        status: "connect",
        statusAt: now,
        version: next,
        errorCode: undefined,
      });
    } else {
      await ctx.db.insert("s3Connections", {
        workspaceId,
        accountId: account._id,
        bucketId,
        userId,
        consumerId,
        connectionId,
        deliveryUrl: consumer.deliveryUrl,
        pendingCredentialId: credentialId,
        version: next,
        status: "connect",
        statusAt: now,
        createdAt: now,
      });
    }

    await audit(ctx, workspaceId, userId, "s3connection.connect", {
      consumerId,
      connectionId,
      bucketId,
      credentialId,
      version: next,
    });

    // The secret is intentionally NOT stored in the connection row. It is
    // delivered once by the action below and then discarded.
    return {
      workspaceId,
      bucketId,
      consumerId,
      credentialId,
      version: next,
      accessKeyId,
      secretKey: secret,
      endpoint: gatewayEndpoint,
      region: process.env.S3_GATEWAY_REGION || "us-east-1",
      bucket: bucket.rustfsName,
      deliveryUrl: consumer.deliveryUrl,
      consumerSecret: consumer.secret,
    };
  },
});

/** Internal action: deliver staged connection credentials to the consumer. */
export const deliver = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    bucketId: v.id("buckets"),
    consumerId: v.string(),
    operation: v.string(),
    version: v.number(),
    credentialId: v.id("s3Credentials"),
    accessKeyId: v.string(),
    secretKey: v.string(),
    endpoint: v.string(),
    region: v.string(),
    bucket: v.string(),
    deliveryUrl: v.string(),
    consumerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.s3Connections.getConnectionInternal, {
      workspaceId: args.workspaceId,
      consumerId: args.consumerId,
      connectionId: `${args.consumerId}-${args.bucketId}`,
    });
    if (!row) {
      throw new ProvisioningError("ConnectionNotFound", "Connection was removed before delivery");
    }
    if (row.version !== args.version) {
      throw new ProvisioningError("VersionMismatch", "Connection version changed during delivery");
    }
    if (row.pendingCredentialId !== args.credentialId) {
      throw new ProvisioningError("CredentialMismatch", "Pending credential changed during delivery");
    }

    const payload = {
      connectionId: `${args.consumerId}-${args.bucketId}`,
      consumerId: args.consumerId,
      operation: args.operation,
      workspaceId: args.workspaceId,
      accountId: row.accountId,
      bucket: args.bucket,
      endpoint: args.endpoint,
      region: args.region,
      accessKeyId: args.accessKeyId,
      secretAccessKey: args.secretKey,
      version: args.version,
    };

    let response: Response;
    try {
      response = await fetch(args.deliveryUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-s3-connection-secret": args.consumerSecret,
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.s3Connections.markFailed, {
        workspaceId: args.workspaceId,
        consumerId: args.consumerId,
        connectionId: payload.connectionId,
        version: args.version,
        errorCode: "DeliveryUnreachable",
        error: message,
      });
      throw new ProvisioningError("DeliveryUnreachable", `Consumer did not respond: ${message}`);
    }

    const text = await response.text().catch(() => "{}");
    let json: { ok?: boolean; status?: string; verified?: boolean; connectionId?: string; version?: number; error?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }

    if (!response.ok || !json || json.ok !== true || json.verified !== true || json.connectionId !== payload.connectionId || json.version !== args.version) {
      const errorCode = response.status === 401 ? "DeliveryUnauthorized" : "DeliveryRejected";
      await ctx.runMutation(internal.s3Connections.markFailed, {
        workspaceId: args.workspaceId,
        consumerId: args.consumerId,
        connectionId: payload.connectionId,
        version: args.version,
        errorCode,
        error: json.error || text.slice(0, 240),
      });
      throw new ProvisioningError(
        errorCode,
        `Consumer rejected the connection (HTTP ${response.status})`,
      );
    }

    // Consumer acknowledged and verified. Promote pending -> active.
    await ctx.runMutation(internal.s3Connections.commit, {
      workspaceId: args.workspaceId,
      consumerId: args.consumerId,
      connectionId: payload.connectionId,
      version: args.version,
      credentialId: args.credentialId,
    });

    return {
      ok: true,
      status: json.status || "delivered",
      connectionId: payload.connectionId,
      version: args.version,
    };
  },
});

/** Public action: orchestrate staging + delivery in one call. */
export const connectAndDeliver = action({
  args: {
    workspaceId: v.id("workspaces"),
    bucketId: v.id("buckets"),
    consumerId: v.string(),
  },
  handler: async (ctx, args) => {
    const staged = await ctx.runMutation(internal.s3Connections.connect, {
      ...args,
    });
    try {
      const delivered = await ctx.runAction(internal.s3Connections.deliver, {
        ...staged,
        operation: "connect",
      });
      return delivered;
    } catch (err) {
      // Surface the provisioning error to the dashboard; the pending credential
      // remains available for retry via the same connection row.
      if (err instanceof ProvisioningError) throw err;
      if (err instanceof ConvexError) throw err;
      throw new ProvisioningError(
        "DeliveryFailed",
        err instanceof Error ? err.message : String(err),
      );
    }
  },
});

/** Retry a failed/ambiguous delivery, reusing the pending credential. */
export const retryDelivery = action({
  args: {
    workspaceId: v.id("workspaces"),
    bucketId: v.id("buckets"),
    consumerId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.s3Connections.getConnectionInternal, {
      workspaceId: args.workspaceId,
      consumerId: args.consumerId,
      connectionId: `${args.consumerId}-${args.bucketId}`,
    });
    if (!row || !row.pendingCredentialId || row.status === "active") {
      throw new ProvisioningError("NothingToRetry", "No pending connection to retry");
    }
    await ctx.runQuery(internal.s3Connections.authorize, args);
    const consumer = resolveConsumer(args.consumerId);
    const gatewayEndpoint = getGatewayEndpoint();
    if (!gatewayEndpoint) {
      throw new ProvisioningError("GatewayNotConfigured", "S3 gateway endpoint is not configured");
    }
    // Decrypt the pending secret for redelivery.
    const full = await ctx.runQuery(internal.s3Connections.resolveCredentialById, {
      id: row.pendingCredentialId,
    });
    if (!full) {
      throw new ProvisioningError("PendingCredentialMissing", "Pending credential secret not found");
    }
    return ctx.runAction(internal.s3Connections.deliver, {
      workspaceId: args.workspaceId,
      bucketId: args.bucketId,
      consumerId: args.consumerId,
      operation: row.status === "rotate" ? "rotate" : "connect",
      version: row.version,
      credentialId: row.pendingCredentialId,
      accessKeyId: full.accessKeyId,
      secretKey: full.secretKey,
      endpoint: gatewayEndpoint,
      region: process.env.S3_GATEWAY_REGION || "us-east-1",
      bucket: row.bucketRustfsName,
      deliveryUrl: consumer.deliveryUrl,
      consumerSecret: consumer.secret,
    });
  },
});

/** Public: rotate the active credential for a connection. */
export const rotate = action({
  args: {
    workspaceId: v.id("workspaces"),
    bucketId: v.id("buckets"),
    consumerId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.s3Connections.getConnectionInternal, {
      workspaceId: args.workspaceId,
      consumerId: args.consumerId,
      connectionId: `${args.consumerId}-${args.bucketId}`,
    });
    if (!row || !row.activeCredentialId) {
      throw new ProvisioningError("NotConnected", "Connection is not active");
    }
    if (row.status === "connect" || row.status === "rotate") {
      throw new ProvisioningError("OperationInProgress", "An earlier connect/rotate is still unresolved");
    }
    const staged = await ctx.runMutation(internal.s3Connections.connect, {
      ...args,
      consumerId: args.consumerId,
    });
    try {
      const delivered = await ctx.runAction(internal.s3Connections.deliver, {
        ...staged,
        operation: "rotate",
      });
      // Promotion and revocation happen atomically inside commit.
      return delivered;
    } catch (err) {
      if (err instanceof ProvisioningError) throw err;
      if (err instanceof ConvexError) throw err;
      throw new ProvisioningError("RotationFailed", err instanceof Error ? err.message : String(err));
    }
  },
});

/** Public: disconnect a consumer and revoke its active credential. */
export const disconnect = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    bucketId: v.id("buckets"),
    consumerId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await authConnection(ctx, args.workspaceId, args.bucketId);
    resolveConsumer(args.consumerId);
    const connectionId = `${args.consumerId}-${args.bucketId}`;
    const row = await ctx.db
      .query("s3Connections")
      .withIndex("by_connection", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("consumerId", args.consumerId).eq("connectionId", connectionId),
      )
      .unique();
    if (!row) {
      throw new ProvisioningError("NotFound", "Connection not found");
    }
    const now = Date.now();
    if (row.pendingCredentialId) {
      await ctx.db.patch(row.pendingCredentialId, { revoked: true });
    }
    if (row.activeCredentialId) {
      await ctx.db.patch(row.activeCredentialId, { revoked: true });
    }
    await ctx.db.patch(row._id, {
      pendingCredentialId: undefined,
      activeCredentialId: undefined,
      status: "disconnected",
      statusAt: now,
      version: row.version + 1,
    });
    await audit(ctx, args.workspaceId, userId, "s3connection.disconnect", {
      consumerId: args.consumerId,
      connectionId,
    });
    return { ok: true, connectionId, version: row.version + 1 };
  },
});

// ---------------- internal helpers ----------------

export const getConnectionInternal = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    consumerId: v.string(),
    connectionId: v.string(),
  },
  handler: async (ctx, { workspaceId, consumerId, connectionId }) => {
    const row = await ctx.db
      .query("s3Connections")
      .withIndex("by_connection", (q) =>
        q.eq("workspaceId", workspaceId).eq("consumerId", consumerId).eq("connectionId", connectionId),
      )
      .unique();
    if (!row) return null;
    const bucket = await ctx.db.get(row.bucketId);
    return {
      ...row,
      bucketRustfsName: bucket?.rustfsName ?? "",
    };
  },
});

export const resolveCredentialById = internalQuery({
  args: { id: v.id("s3Credentials") },
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get(id);
    if (!c || c.revoked) return null;
    const account = await ctx.db.get(c.accountId);
    if (!account || account.status !== "active") return null;
    const secretKey = await decryptSecret(c.secretCipher);
    return { accessKeyId: c.accessKeyId, secretKey };
  },
});

export const commit = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    consumerId: v.string(),
    connectionId: v.string(),
    version: v.number(),
    credentialId: v.id("s3Credentials"),
  },
  handler: async (ctx, { workspaceId, consumerId, connectionId, version, credentialId }) => {
    const row = await ctx.db
      .query("s3Connections")
      .withIndex("by_connection", (q) =>
        q.eq("workspaceId", workspaceId).eq("consumerId", consumerId).eq("connectionId", connectionId),
      )
      .unique();
    if (row?.version === version && row.activeCredentialId === credentialId && !row.pendingCredentialId) return;
    if (!row || row.version !== version || row.pendingCredentialId !== credentialId) {
      throw new ConvexError("Connection changed during delivery");
    }
    const credential = await ctx.db.get(credentialId);
    if (!credential || credential.revoked) throw new ConvexError("Credential revoked during delivery");
    if (row.activeCredentialId && row.activeCredentialId !== credentialId) {
      await ctx.db.patch(row.activeCredentialId, { revoked: true });
    }
    await ctx.db.patch(row._id, {
      errorCode: undefined,
      activeCredentialId: credentialId,
      pendingCredentialId: undefined,
      status: "active",
      statusAt: Date.now(),
    });
  },
});

export const markFailed = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    consumerId: v.string(),
    connectionId: v.string(),
    version: v.number(),
    errorCode: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, consumerId, connectionId, version, errorCode }) => {
    const row = await ctx.db
      .query("s3Connections")
      .withIndex("by_connection", (q) =>
        q.eq("workspaceId", workspaceId).eq("consumerId", consumerId).eq("connectionId", connectionId),
      )
      .unique();
    if (!row || row.version !== version || !row.pendingCredentialId) return;
    await ctx.db.patch(row._id, {
      status: "failed",
      statusAt: Date.now(),
      errorCode,
    });
  },
});

export const authorize = internalQuery({
  args: { workspaceId: v.id("workspaces"), bucketId: v.id("buckets"), consumerId: v.string() },
  handler: async (ctx, args) => {
    await authConnection(ctx, args.workspaceId, args.bucketId);
    resolveConsumer(args.consumerId);
    return null;
  },
});
