# S3 compatibility implementation

## Scope / safety
Preserve pre-existing dirty/untracked changes. No environment-file reads, deployment, codegen against a live backend, service changes, or live storage mutations. RustFS remains authoritative for durable tags, bucket configuration, versions and delete markers; Convex objects remain a current-object accounting projection, not a version store.

## Atomic waves
1. Inspect guidance, gateway/SigV4, rustfs primitives, schema, dashboard APIs, authorization/audit and test conventions. COMPLETE: gateway already proxies requested subresources; primitives expose multipart initiate/part/complete/abort, bucket CORS/tagging/versioning. No separate version database is appropriate.
2. Add strict bounded S3 subresource/XML validation, preserve decoded keys and original signature semantics, authorize version-specific operations and each batch's required scopes, maintain transparent upstream responses. Remove stale authorization caches and filter ListBuckets by account and bucket scope.
3. Extend existing storage primitives for version-aware reads/deletes/presigned downloads and multipart validation, keeping existing callers source-compatible. Use native RustFS versioning consistently for dashboard latest-object operations. Do not invent backend support or transactional guarantees.
4. Add isolated mocked-HTTP routing/XML/auth/regression tests; run focused and existing safe unit checks. At most five fix iterations; halt a repeated identical error after twice. No live integration suites or unsafe harness retry loops.
5. Review security/logic/performance/tests, document operations, native persistence semantics, accounting/rename/concurrency limits and unverified backend capabilities. Record actual validation output here.

## Acceptance boundaries
Native RustFS must supply complete S3 versioning, tagging, multipart/listing and batch partial-error semantics. Tests of signed forwarding are not proof of deployed RustFS parity. Batch delete is not atomic. Never substitute Convex latest-object rows for retained-version storage/quota accounting. No storage-class/select/replication/acceleration features.

## Results
Implementation and validation pending.
