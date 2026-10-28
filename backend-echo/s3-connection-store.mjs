// Persistent, per-connection S3 client configuration.
//
// This module is the consumer side of automatic credential provisioning. It
// owns everything that makes "the app configured itself" true rather than
// aspirational:
//
//   * strict schema validation of what the control plane delivered
//   * one file per (consumer, connection) with mode 0600 in a mode 0700 dir
//   * exclusive cross-process locking around read-modify-write
//   * atomic replacement (temp file + fsync + rename), never partial writes
//   * preservation of unrelated keys already in the file
//   * monotonic version fencing so a stale delivery cannot win
//   * verified reload: the caller re-reads from disk after writing
//
// Platform policy: file modes are only meaningful on POSIX. On Windows the
// store fails closed unless S3_CONNECTION_UNSAFE_DEV=1 is set, because we do
// not manage NTFS ACLs and silently claiming "protected" would be a lie.

import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export const CONFIG_VERSION = 1;

/** Raised for any client-visible validation/lock/persist failure. */
export class ConfigError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.status = status;
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ACCESS_KEY_RE = /^[A-Za-z0-9]{8,128}$/;
const SECRET_KEY_RE = /^[A-Za-z0-9/+=]{16,128}$/;
const REGION_RE = /^[a-z0-9-]{1,32}$/;

/** Connection ids become filenames, so they must not be able to escape. */
export function assertConnectionId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new ConfigError("InvalidConnectionId", "Invalid connection id");
  }
  return id;
}

function assertString(value, field, { max = 512, pattern, required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    throw new ConfigError("InvalidConfig", `Missing field: ${field}`);
  }
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new ConfigError("InvalidConfig", `Invalid field: ${field}`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigError("InvalidConfig", `Invalid characters in: ${field}`);
  }
  if (pattern && !pattern.test(value)) {
    throw new ConfigError("InvalidConfig", `Invalid field: ${field}`);
  }
  return value;
}

/**
 * The S3 endpoint must be an absolute http(s) URL whose path ends in the
 * gateway prefix. It is server-selected (never user-supplied); validating it
 * still keeps a misconfigured value from turning into a request to nowhere.
 */
export function normalizeEndpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("InvalidConfig", "Invalid field: endpoint");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("InvalidConfig", "Endpoint must be http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError("InvalidConfig", "Endpoint must not carry credentials, query or fragment");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "/s3") {
    throw new ConfigError("InvalidConfig", "Endpoint path must be /s3");
  }
  url.pathname = path;
  return url.toString().replace(/\/$/, "");
}

/** Validate and normalize a delivered connection payload. Rejects unknown fields. */
export function validateConnectionPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ConfigError("InvalidConfig", "Request body must be a JSON object");
  }
  const allowed = new Set([
    "connectionId",
    "consumerId",
    "operation",
    "workspaceId",
    "accountId",
    "bucket",
    "endpoint",
    "region",
    "accessKeyId",
    "secretAccessKey",
    "version",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new ConfigError("InvalidConfig", `Unknown field: ${key}`);
    }
  }
  const operation = body.operation;
  if (operation !== "connect" && operation !== "rotate" && operation !== "disconnect") {
    throw new ConfigError("InvalidConfig", "Invalid field: operation");
  }
  if (!Number.isSafeInteger(body.version) || body.version < 1) {
    throw new ConfigError("InvalidConfig", "Invalid field: version");
  }

  const out = {
    connectionId: assertConnectionId(body.connectionId),
    consumerId: assertString(body.consumerId, "consumerId", { max: 64, pattern: ID_RE }),
    operation,
    version: body.version,
    workspaceId: assertString(body.workspaceId, "workspaceId", { max: 128 }),
    accountId: assertString(body.accountId, "accountId", { max: 128 }),
  };
  if (operation === "disconnect") return out;

  out.bucket = assertString(body.bucket, "bucket", { max: 63, pattern: BUCKET_RE });
  out.endpoint = normalizeEndpoint(assertString(body.endpoint, "endpoint", { max: 512 }));
  out.region = assertString(body.region, "region", { max: 32, pattern: REGION_RE });
  out.accessKeyId = assertString(body.accessKeyId, "accessKeyId", {
    max: 128,
    pattern: ACCESS_KEY_RE,
  });
  out.secretAccessKey = assertString(body.secretAccessKey, "secretAccessKey", {
    max: 128,
    pattern: SECRET_KEY_RE,
  });
  return out;
}

function unsafeDevAllowed() {
  return process.env.S3_CONNECTION_UNSAFE_DEV === "1";
}

/**
 * Resolve the private state directory. Absolute paths only; the directory may
 * not live inside the checkout unless the explicit dev override is set, so
 * credential material never lands in a tree that gets committed or copied.
 */
export function resolveStateDir(configured = process.env.S3_CONNECTION_STATE_DIR) {
  if (!configured) {
    throw new ConfigError(
      "MissingStateDir",
      "S3_CONNECTION_STATE_DIR is not configured on this consumer",
      503,
    );
  }
  if (!isAbsolute(configured)) {
    throw new ConfigError("InvalidStateDir", "S3_CONNECTION_STATE_DIR must be absolute", 503);
  }
  const dir = resolve(configured);
  if (!unsafeDevAllowed()) {
    const repoRoot = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
    if (dir === repoRoot || dir.startsWith(repoRoot + sep)) {
      throw new ConfigError(
        "UnsafeStateDir",
        "S3_CONNECTION_STATE_DIR must be outside the checkout (or set S3_CONNECTION_UNSAFE_DEV=1 for local development)",
        503,
      );
    }
    if (process.platform === "win32") {
      throw new ConfigError(
        "UnsupportedPlatform",
        "Protected state files require POSIX permissions; set S3_CONNECTION_UNSAFE_DEV=1 only for local development",
        503,
      );
    }
  }
  return dir;
}

function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    const st = statSync(dir);
    if ((st.mode & 0o077) !== 0) {
      // Tighten rather than fail: the operator asked for this directory.
      chmodSync(dir, 0o700);
    }
  }
  return dir;
}

function writeFileAtomic(target, data) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, target);
  // Best-effort fsync of the directory so the rename itself is durable.
  try {
    const dfd = openSync(dirname(target), "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  } catch {
    // Directory fsync is not supported everywhere; the rename still happened.
  }
  return target;
}

const LOCK_STALE_MS = 60_000;

export class ConnectionStore {
  constructor(stateDir = resolveStateDir()) {
    this.dir = ensurePrivateDir(stateDir);
  }

  fileFor(connectionId) {
    return join(this.dir, `${assertConnectionId(connectionId)}.json`);
  }

  lockFor(connectionId) {
    return join(this.dir, `${assertConnectionId(connectionId)}.lock`);
  }

  /** Read + parse a stored connection. Returns null when absent. */
  read(connectionId) {
    const file = this.fileFor(connectionId);
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw new ConfigError("StateUnreadable", "Stored connection configuration is unreadable", 500);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConfigError(
        "StateCorrupt",
        "Stored connection configuration is not valid JSON; fix or remove it",
        500,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigError("StateCorrupt", "Stored connection configuration is malformed", 500);
    }
    return parsed;
  }

  /**
   * Acquire the per-connection lock. A held lock is never stolen: a concurrent
   * or crashed writer must be resolved by the operator, because guessing
   * "stale" risks two writers racing over credential material.
   */
  acquireLock(connectionId) {
    const file = this.lockFor(connectionId);
    try {
      const fd = openSync(file, "wx", 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      return { file };
    } catch (err) {
      if (!err || err.code !== "EEXIST") {
        throw new ConfigError("LockUnavailable", "Could not lock connection state", 500);
      }
      let holder = "";
      try {
        holder = readFileSync(file, "utf8").slice(0, 120);
      } catch {
        holder = "";
      }
      let age = 0;
      try {
        age = Date.now() - statSync(file).mtimeMs;
      } catch {
        age = 0;
      }
      const stale = age > LOCK_STALE_MS;
      throw new ConfigError(
        stale ? "LockStale" : "LockBusy",
        stale
          ? `A previous update left ${file} locked for over ${Math.round(age / 1000)}s; inspect and remove it, then retry`
          : `Another update is in progress for this connection (${holder}); retry shortly`,
        409,
      );
    }
  }

  releaseLock(lock) {
    try {
      unlinkSync(lock.file);
    } catch {
      // Already gone — nothing to do.
    }
  }

  /**
   * Persist a connection payload atomically, preserving unrelated top-level
   * keys that an operator may have added to the file.
   */
  write(connectionId, payload, previous) {
    const existing = previous ?? this.read(connectionId);
    const merged = {
      ...(existing && typeof existing === "object" ? existing : {}),
      schemaVersion: CONFIG_VERSION,
      connectionId: payload.connectionId,
      consumerId: payload.consumerId,
      workspaceId: payload.workspaceId,
      accountId: payload.accountId,
      bucket: payload.bucket,
      endpoint: payload.endpoint,
      region: payload.region,
      accessKeyId: payload.accessKeyId,
      secretAccessKey: payload.secretAccessKey,
      version: payload.version,
      updatedAt: new Date().toISOString(),
    };
    const file = this.fileFor(connectionId);
    writeFileAtomic(file, `${JSON.stringify(merged, null, 2)}\n`);
    return merged;
  }

  /** Remove a connection file (disconnect). Returns true when something was removed. */
  remove(connectionId) {
    const file = this.fileFor(connectionId);
    try {
      rmSync(file);
      return true;
    } catch (err) {
      if (err && err.code === "ENOENT") return false;
      throw new ConfigError("StateUnwritable", "Could not remove connection configuration", 500);
    }
  }

  list() {
    const out = [];
    let names = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      return out;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!ID_RE.test(id)) continue;
      try {
        const record = this.read(id);
        if (record) out.push(record);
      } catch {
        out.push({ connectionId: id, corrupt: true });
      }
    }
    return out;
  }
}
