import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Multi-tenant: resources carry workspaceId. It is `optional` on pre-existing tables only so
// deploys don't fail validation against pre-migration rows; the function layer always sets it.
export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    username: v.optional(v.string()),
    imageId: v.optional(v.id("_storage")),
  }).index("email", ["email"]),

  events: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    source: v.string(),
    type: v.string(),
    payload: v.any(),
    receivedAt: v.number(),
  })
    .index("by_received", ["receivedAt"])
    .index("by_workspace", ["workspaceId"]),

  jobs: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    userId: v.id("users"),
    kind: v.string(),
    status: v.string(),
    input: v.optional(v.any()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"]),

  auditLogs: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    userId: v.id("users"),
    action: v.string(),
    meta: v.optional(v.any()),
    at: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"]),

  usage: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    userId: v.optional(v.id("users")),
    metric: v.string(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_metric", ["userId", "metric"])
    .index("by_workspace_metric", ["workspaceId", "metric"]),

  apiKeys: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    userId: v.id("users"),
    name: v.string(),
    prefix: v.string(),
    hash: v.string(),
    revoked: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_hash", ["hash"]),

  // Files (workspace-scoped). Stored in Convex file storage; row holds metadata.
  files: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    name: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    contentType: v.string(),
    createdAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  workspaces: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    createdAt: v.number(),
  }),
  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_user_workspace", ["userId", "workspaceId"]),
  invites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: v.string(),
    invitedBy: v.id("users"),
    accepted: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_email", ["email"]),

  notifications: defineTable({
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  // Maintained counters so dashboard.stats is O(1) instead of scanning every row.
  counters: defineTable({
    workspaceId: v.id("workspaces"),
    metric: v.string(),
    value: v.number(),
  }).index("by_workspace_metric", ["workspaceId", "metric"]),

  // --- S3-compatible object storage (bytes live in RustFS, metadata here) ---

  // A storage account owns buckets and is billed/quota'd as a unit.
  // Bound to a workspace + owning user; never shared across workspaces.
  storageAccounts: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    name: v.string(),
    // Unique short code that prefixes every bucket name in the shared
    // RustFS namespace so different accounts may reuse the same bucket name.
    accountCode: v.string(),
    status: v.string(), // "active" | "disabled"
    storageQuotaBytes: v.number(),
    maxBuckets: v.number(),
    maxObjectBytes: v.number(),
    createdAt: v.number(),
    disabledAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_accountCode", ["accountCode"]),

  // A bucket. `name` is the user-facing name; `rustfsName` is the
  // globally-unique name actually created in RustFS (accountCode-prefixed).
  buckets: defineTable({
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    userId: v.id("users"),
    name: v.string(),
    rustfsName: v.string(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_account", ["accountId"])
    .index("by_rustfsName", ["rustfsName"]),

  // Object metadata. The bytes live in RustFS; this table exists for
  // quota/usage accounting and audit. Listings read from RustFS directly.
  objects: defineTable({
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    bucketId: v.id("buckets"),
    key: v.string(),
    size: v.number(),
    contentType: v.optional(v.string()),
    etag: v.optional(v.string()),
    userId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_bucket", ["bucketId"])
    .index("by_bucket_key", ["bucketId", "key"]),

  // Automatic S3 connection provisioning state for registered consumers.
  // One row per (workspace, account, bucket, consumer, connection).
  s3Connections: defineTable({
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    bucketId: v.id("buckets"),
    userId: v.id("users"),
    // Registered consumer identifier (server-configured, not user-selected).
    consumerId: v.string(),
    connectionId: v.string(),
    // Server-controlled delivery URL for this consumer/workspace pair.
    deliveryUrl: v.string(),
    // The currently active credential. Undefined until first connect.
    activeCredentialId: v.optional(v.id("s3Credentials")),
    // Pending credential during connect/rotate; committed only after consumer
    // acknowledgment.
    pendingCredentialId: v.optional(v.id("s3Credentials")),
    // Monotonically increased by the control plane. Prevents stale deliveries.
    version: v.number(),
    // connect / rotate / disconnect / active / failed
    status: v.string(),
    statusAt: v.number(),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_account", ["accountId"])
    .index("by_connection", ["workspaceId", "consumerId", "connectionId"])
    .index("by_active", ["activeCredentialId"])
    .index("by_pending", ["pendingCredentialId"]),

  // Application-issued S3 credentials (AWS SigV4). These are DISTINCT from the
  // dashboard `sk_` API keys. The secret is stored AES-GCM encrypted (key in
  // server env) so the gateway can verify SigV4 signatures; `secretHash` is a
  // SHA-256 verifier for safe duplicate detection. The plaintext secret is
  // returned exactly once at creation.
  s3Credentials: defineTable({
    workspaceId: v.id("workspaces"),
    accountId: v.id("storageAccounts"),
    userId: v.id("users"),
    name: v.string(),
    accessKeyId: v.string(),
    secretHash: v.string(),
    secretCipher: v.string(),
    // Optional scope restriction: specific buckets and/or S3 actions.
    // Undefined/null = all buckets / all supported actions on the account.
    buckets: v.optional(v.array(v.id("buckets"))),
    actions: v.optional(v.array(v.string())),
    revoked: v.boolean(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_accessKey", ["accessKeyId"])
    .index("by_account", ["accountId"])
    .index("by_workspace", ["workspaceId"]),
});
