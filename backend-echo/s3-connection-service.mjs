e// Automatic S3 connection provisioning — consumer-side orchestrator.
//
// One code path per operation, always in this order:
//
//   validate -> lock -> read -> fence -> write -> RELOAD FROM DISK -> verify
//
// Success is only reported after the *persisted* file was re-read and the
// credentials in it were used successfully against the real gateway. A failure
// after the write restores the previous file (or removes a first-time file) so
// the consumer is never left holding credentials nobody proved work.

import { ConnectionStore, ConfigError, validateConnectionPayload } from "./s3-connection-store.mjs";
import { GatewayS3Client, S3ConnectionError } from "./s3-client.mjs";

/** Fields safe to return to the control plane: no secret material, ever. */
function publicRecord(record) {
  if (!record) return null;
  return {
    connectionId: record.connectionId,
    consumerId: record.consumerId,
    workspaceId: record.workspaceId,
    accountId: record.accountId,
    bucket: record.bucket,
    endpoint: record.endpoint,
    region: record.region,
    accessKeyId: record.accessKeyId,
    version: record.version,
    updatedAt: record.updatedAt,
  };
}

function buildClient(record) {
  return new GatewayS3Client({
    endpoint: record.endpoint,
    region: record.region,
    accessKeyId: record.accessKeyId,
    secretAccessKey: record.secretAccessKey,
  });
}

/**
 * Re-read the just-written configuration through a brand-new store instance and
 * build a client from what is actually on disk. Anything that is not readable,
 * parseable and complete fails here rather than at first real use.
 */
function reloadFromDisk(stateDir, connectionId) {
  const fresh = new ConnectionStore(stateDir);
  const record = fresh.read(connectionId);
  if (!record) {
    throw new ConfigError("ReloadFailed", "Configuration was not found after writing", 500);
  }
  for (const field of [
    "endpoint",
    "region",
    "accessKeyId",
    "secretAccessKey",
    "bucket",
    "version",
  ]) {
    if (record[field] === undefined || record[field] === null) {
      throw new ConfigError(
        "ReloadFailed",
        `Persisted configuration is missing ${field}`,
        500,
      );
    }
  }
  return { record, client: buildClient(record) };
}

export class ConnectionService {
  constructor({ stateDir } = {}) {
    this.store = new ConnectionStore(stateDir);
    this.stateDir = this.store.dir;
  }

  /** List stored connections without secrets (operator/debug surface). */
  list() {
    return this.store.list().map((record) => publicRecord(record) ?? { corrupt: true });
  }

  /**
   * Apply a delivered connection payload.
   *
   * @param {unknown} body raw JSON body from the delivery request
   * @returns {Promise<{result: object, record: object|null}>}
   */
  async apply(body) {
    const payload = validateConnectionPayload(body);
    const { connectionId } = payload;

    const lock = this.store.acquireLock(connectionId);
    try {
      const existing = this.store.read(connectionId);

      // ---- Version fencing -------------------------------------------------
      // The control plane owns a monotonically increasing version per
      // connection. A lower version is a stale delivery (a retry that lost a
      // race, or an old operation replayed) and must never overwrite newer
      // credentials. An equal version is a retry of the same operation.
      if (existing && Number.isSafeInteger(existing.version)) {
        if (payload.version < existing.version) {
          throw new ConfigError(
            "StaleConfiguration",
            `Refusing stale update: stored version ${existing.version} is newer than delivered version ${payload.version}`,
            409,
          );
        }
        if (payload.version === existing.version) {
          const sameOperation =
            existing.accessKeyId === payload.accessKeyId &&
            existing.bucket === payload.bucket &&
            existing.endpoint === payload.endpoint;
          if (!sameOperation) {
            throw new ConfigError(
              "VersionConflict",
              `Version ${payload.version} is already stored with a different configuration; the control plane must allocate a new version`,
              409,
            );
          }
        }
      }

      if (payload.operation === "disconnect") {
        return await this.#disconnect(payload, existing);
      }
      return await this.#connectOrRotate(payload, existing);
    } finally {
      this.store.releaseLock(lock);
    }
  }

  async #connectOrRotate(payload, existing) {
    const { connectionId, version } = payload;

    // Idempotent replay: same version already stored. Don't rewrite; just prove
    // the stored credentials still work, so a duplicated delivery is harmless
    // and a caller retrying an ambiguous timeout gets a truthful answer.
    if (existing && existing.version === version && existing.accessKeyId === payload.accessKeyId) {
      const { client } = reloadFromDisk(this.stateDir, connectionId);
      await client.verify(existing.bucket);
      return {
        result: {
          operation: payload.operation,
          status: "already-applied",
          connectionId,
          version,
          verified: true,
        },
        record: publicRecord(existing),
      };
    }

    // Snapshot what to restore if anything downstream fails.
    const previous = existing ? { ...existing } : null;

    try {
      this.store.write(connectionId, payload, existing);
    } catch (err) {
      // Nothing was changed (atomic write), so there is nothing to roll back.
      if (err instanceof ConfigError) throw err;
      throw new ConfigError("StateUnwritable", "Could not persist connection configuration", 500);
    }

    let reloaded;
    try {
      reloaded = reloadFromDisk(this.stateDir, connectionId);
      await reloaded.client.verify(reloaded.record.bucket);
    } catch (err) {
      this.#rollback(connectionId, previous);
      if (err instanceof ConfigError || err instanceof S3ConnectionError) throw err;
      throw new ConfigError("VerificationFailed", "Connection could not be verified", 502);
    }

    return {
      result: {
        operation: payload.operation,
        status: payload.operation === "rotate" ? "rotated" : "connected",
        connectionId,
        version,
        verified: true,
        bucket: reloaded.record.bucket,
        endpoint: reloaded.record.endpoint,
        accessKeyId: reloaded.record.accessKeyId,
      },
      record: publicRecord(reloaded.record),
    };
  }

  async #disconnect(payload, existing) {
    if (!existing) {
      return {
        result: {
          operation: "disconnect",
          status: "already-absent",
          connectionId: payload.connectionId,
          version: payload.version,
        },
        record: null,
      };
    }
    // Fencing already rejected stale/conflicting versions above; require the
    // delivered version to be the stored one or newer.
    const removed = this.store.remove(payload.connectionId);
    return {
      result: {
        operation: "disconnect",
        status: removed ? "disconnected" : "already-absent",
        connectionId: payload.connectionId,
        version: payload.version,
      },
      record: null,
    };
  }

  /**
   * Restore the previous file after a failed write/reload/verify. If there was
   * no previous configuration the credential file is removed, so a failed first
   * connection does not leave usable-looking secrets behind.
   */
  #rollback(connectionId, previous) {
    try {
      if (previous) this.store.write(connectionId, previous);
      else this.store.remove(connectionId);
    } catch {
      // Rollback is best-effort; the caller still receives the verification
      // error and the operator can inspect the state directory.
    }
  }
}

export { ConfigError, S3ConnectionError, publicRecord };
