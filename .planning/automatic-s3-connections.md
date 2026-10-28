# Automatic S3 connections

## Requirements and scope
- Existing stack: TypeScript, Next.js, Convex actions/mutations, RustFS, SigV4 gateway; Docker self-hosting.
- Existing creation returns secrets once; no consumer registry or delivery integration exists.
- Supported consumer: repository's reference `backend-echo`, explicitly extended to load a protected, versioned JSON connection file and initialize a gateway S3 client. Not AWS CLI/rclone auto-discovery.
- Register authorized workspace/account/bucket/consumer bindings and delivery URLs in server-only environment. No user-selected URLs or paths. Owner/admin only.
- Preserve manual credentials and unrelated working-tree changes.

## Waves
1. Consumer service: typed validation, gateway client using existing signing, private per-connection files, exclusive lock, atomic fsync/rename, persisted reload, verification, rollback, version fencing, safe errors.
2. Control plane: transactional pending/active credential state, scoped provisioning, authenticated delivery, non-secret results, retry idempotency, rotation after consumer acknowledgment.
3. UI and documentation: registered-consumer connect/retry/rotate flow; explicit deployment settings and limitations.
4. Verification: consumer filesystem/HTTP tests and Convex authorization/state tests; available type/lint/unit checks; in-agent review if CodeRabbit unavailable.

## Safety/recovery
- No arbitrary external files; operator-controlled absolute private state directory outside checkout, POSIX 0700/0600. Windows persistence fails closed unless protected ACL deployment is implemented.
- No production credentials or deployment changes in tests. Local simulated SigV4 endpoint for consumer integration, live stack only if available without exposing secrets.
- Delivery timeout leaves pending key for retry; never revoke the old active key on failure. Pending key is reused for same operation. New operations cannot replace an unresolved pending operation.
- Consumer serializes per-connection changes across processes with exclusive lock; busy/stale locks fail safely (operator recovery), not auto-deleted.
- At most five fix iterations; halt on identical repeated failure.
