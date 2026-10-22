<p align="center">
  <h1 align="center">S3 Storage Platform</h1>
  <p align="center">
    Multi-tenant, S3-compatible object storage platform — a self-hosted Convex control plane,
    a RustFS data plane, and an AWS SigV4 gateway that any S3 client can talk to.
  </p>
</p>

<p align="center">
  <a href="self-hosted/README.md">Self-hosting</a> •
  <a href="#quick-start">Quick start</a> •
  <a href="#s3-api">S3 API</a> •
  <a href="#security-model">Security model</a> •
  <a href="#testing">Testing</a>
</p>

---

## What this is

A storage platform that gives every tenant an isolated S3 namespace, an S3 API that
works with off-the-shelf tooling (`aws s3`, `boto3`, `rclone`, `s3cmd`), and a web
dashboard to manage buckets, objects, credentials and access.

**The problem it solves:** cloud object storage is billed and metered per account, but
most teams need to hand out *scoped* storage to many different users or products.
Typical DIY solutions either (a) share one bucket and bolt on path prefixes — which
leaks billing, quota and blast-radius boundaries, or (b) hand out raw cloud keys,
which is unauditable and unrevocable in practice. This platform puts a real control
plane in front of a single object store: real buckets, real per-credential keys,
real quotas, real revocation, and a tenant-isolated S3 API.

## Key features

**Object storage (S3-compatible)**
- Storage *accounts* → *buckets* → *objects*, with a unique `accountCode` prefix on every
  physical bucket so different tenants can reuse the same bucket name safely.
- Dashboard CRUD for buckets and objects; presigned `PUT` upload URLs and presigned
  download URLs; copy and rename of objects.
- Object metadata (size, content type, ETag) is stored in Convex; **bytes live in RustFS**.
- Per-account quotas: total bytes, max bucket count, max object size.

**S3 gateway**
- `GET/PUT/POST/DELETE` on `<convex-site>/s3/…`, signed with **AWS SigV4**.
- Verified end-to-end against `boto3`: `ListBuckets`, `PutObject`, `GetObject`,
  `HeadObject`, `CopyObject`, `DeleteObject`, bucket versioning/tagging/CORS,
  multipart upload parts, and `DeleteObjects` (batch delete).
- Works with path-style addressing, so `aws --endpoint-url http://127.0.0.1:3211/s3` works as-is.

**Credentials & isolation**
- Application-issued S3 credentials (AWS-style `accessKeyId` / `secretAccessKey`).
  The secret is returned **exactly once** at creation, stored AES-GCM encrypted, and
  mirrored by a SHA-256 verifier for duplicate detection.
- Optional scope restriction per credential: allowed buckets and/or allowed S3 actions.
- Credentials can be rotated and revoked; revocation takes effect immediately at the gateway.
- Every request is bound to one account. Cross-tenant reads/writes are rejected with
  `403 AccessDenied`.

**Multi-tenant control plane**
- Workspaces, members, roles (`owner` / `admin` / `member`), email invitations, and
  accept-invite flow.
- Dashboard `sk_` API keys (hashed, revocable) for programmatic access, separate from S3 credentials.
- Usage metering, background jobs, audit log, notifications, file storage, and
  an optional Polar billing integration.

**Authentication**
- Email + password with mandatory email verification, password reset, magic-link OTP,
  password policy, and brute-force lockout.
- Google OAuth provider (requires credentials).
- Self-hosted OIDC: an `oidc-fix` sidecar repairs the invalid JWKS/OIDC metadata
  served by the upstream Convex backend image.

**Hybrid backend adapter (optional)**
The dashboard can attach to an external backend service through three interchangeable paths:
- **JWKS-direct** — the external backend verifies the Convex-issued JWT against the
  public JWKS endpoint.
- **Proxy** — a Convex action calls the backend with a shared service key and forwards the user id.
- **Webhook** — the backend posts results and events back into Convex (`/backend/webhook`),
  which surfaces them live in the dashboard.
`backend-echo/server.mjs` is a working reference implementation of all three.

## Technology stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript 5.5 (strict) |
| Package manager | Bun 1.3.x (workspace protocol) |
| Monorepo | Turborepo 2.1 (`apps/*`, `packages/*`, `tooling/*`) |
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS, shadcn/ui, next-international (i18n), nuqs, cmdk |
| Backend | Convex (self-hosted) — database, auth, HTTP actions, reactive queries |
| Object store | RustFS (S3-compatible, Docker) |
| Auth | `@convex-dev/auth` (password + OTP + Google), custom `ResendOTP` / SMTP action |
| Billing | Polar (`@convex-dev/polar`) |
| Email | React Email templates, Resend or SMTP (Mailpit for local) |
| Observability | Sentry, GlitchTip (self-hosted), OpenPanel analytics |
| Testing | Vitest (unit + `convex-test`), Playwright (live E2E / adversarial suites) |
| Lint / format | Biome 1.8 |
| Infra | Docker Compose (Convex backend + dashboard + RustFS + OIDC sidecar + Mailpit + GlitchTip), Caddy, Cloudflare Tunnel |

## Architecture

```
                         ┌──────────────────────────────────────────┐
   Browser ─────────────▶│  Next.js dashboard (apps/app, :3000)     │
                         │  Convex reactive queries/mutations/actions│
                         └───────────────────┬──────────────────────┘
                                             │
                         ┌───────────────────▼──────────────────────┐
                         │  Convex backend (self-hosted, :3210)      │
                         │  auth · orgs · buckets · objects         │
                         │  s3Credentials · storageAccounts · jobs  │
                         │  usage · audit · notifications · gateway  │
                         └───┬───────────────────────┬──────────────┘
                             │ actions (RustFS-first)│ HTTP :3211/s3/*
                             ▼                       ▼
                    ┌────────────────┐      ┌──────────────────────┐
                    │ RustFS :9000   │◀─────│ SigV4 gateway        │
                    │ (object bytes) │      │ verify → scope →    │
                    └────────────────┘      │ re-sign → proxy      │
                                            └──────────┬───────────┘
                                                       │ optional
                                                       ▼
                                            external backend service
                                       (JWKS-direct / proxy / webhook)
```

**Key invariants**

1. **Convex `query`/`mutation` never make network calls.** Any function that talks to
   RustFS is an `action` (or `internalAction`); DB writes are then done by
   `internalMutation` helpers. RustFS operations always complete *before* the
   Convex record is written, so a failed upload never leaves a phantom object row.
2. **The gateway re-signs.** Client SigV4 signatures are verified against the
   *tenant's* credential, then the request is re-signed with the server-side RustFS
   root credentials. Root keys never leave the server.
3. **Every row carries `workspaceId`.** Authorisation is enforced in the function
   layer, not just in the UI.
4. **Dynamic `import()` is avoided inside Convex isolates** — the RustFS helpers use
   static imports (the module is pure SigV4 crypto with no side effects).

## Repository structure

```
.
├── apps/
│   ├── app/                      # Product dashboard (Next.js App Router, :3000)
│   │   └── src/app/[locale]/
│   │       ├── (dashboard)/      # home · buckets · credentials · files · jobs
│   │       │                      # platform · settings · onboarding
│   │       ├── (public)/login/   # sign-in / sign-up
│   │       └── ...
│   └── web/                      # Marketing site (Next.js)
├── packages/
│   ├── backend/convex/           # Convex backend (the core of the platform)
│   │   ├── schema.ts             # Data model (workspaces, buckets, objects, …)
│   │   ├── auth.ts / auth.config.ts / passwordProviders.ts / ResendOTP.ts
│   │   ├── orgs.ts               # Workspaces, members, roles, invitations
│   │   ├── buckets.ts            # Bucket lifecycle (action + DB helpers)
│   │   ├── objects.ts            # Object upload/list/download/copy/rename
│   │   ├── s3Credentials.ts      # App-issued AWS-style credentials
│   │   ├── storageAccounts.ts    # Accounts, quotas, enable/disable
│   │   ├── rustfs.ts             # Low-level signed RustFS client
│   │   ├── rustfsHelpers.ts      # Convex-safe wrapper around rustfs.ts
│   │   ├── sigv4.ts              # AWS SigV4 signing/verification
│   │   ├── gateway.ts            # S3 HTTP gateway handler
│   │   ├── http.ts               # HTTP router (/s3/*, /backend/webhook, /api/verify-key)
│   │   ├── jobs.ts · backend.ts  # Background jobs + hybrid backend adapter
│   │   └── usage.ts · audit.ts · counters.ts · notifications.ts · apiKeys.ts
│   ├── rustfs/                   # Standalone S3 client package (client, sigv4, xml, validate)
│   ├── ui/                       # Shared shadcn/ui components
│   ├── email/                    # React Email templates
│   ├── analytics/                # OpenPanel analytics
│   └── logger/                   # Shared logger
├── self-hosted/                  # Docker Compose stack + OIDC-fix sidecar
├── deploy/                       # Numbered, ordered provisioning scripts (01…54)
├── backend-echo/                 # Reference external backend (JWKS / proxy / webhook)
├── e2e/                          # Live Playwright suites (auth, IDOR, dashboard)
├── tooling/typescript/           # Shared tsconfig presets
└── scripts/                      # Dev utilities (key generation, RustFS probes)
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3 (the only hard requirement for the app)
- [Docker Desktop](https://docs.docker.com/desktop/) — for the self-hosted Convex + RustFS stack
- Node.js ≥ 20 (required by the `e2e` Playwright suites and some tooling)
- A RustFS/Convex-compatible environment (the self-hosted Compose stack provides it)

## Quick start

### 1. Install dependencies

```bash
bun install
```

### 2. Start the self-hosted backend + object store

```bash
cd self-hosted
cp .env.example .env       # fill in RUSTFS_ACCESS_KEY / RUSTFS_SECRET_KEY
docker compose up -d
```

Services come up as:

| Service | URL |
| --- | --- |
| Convex API | http://127.0.0.1:3210 |
| Convex site (HTTP actions, `/s3/*`) | http://127.0.0.1:3211 |
| OIDC-fix sidecar (public site origin) | http://127.0.0.1:3220 |
| Convex dashboard | http://127.0.0.1:6791 |
| RustFS API | http://127.0.0.1:9000 |
| RustFS console | http://127.0.0.1:9001 |

> **Do not use `docker compose restart` with this stack.** The `oidc-fix` sidecar runs with
> `network_mode: "service:backend"`, so a bulk restart races the network-namespace rejoin
> and fails with *"cannot join network of a non running container"*. Use
> `docker compose down && docker compose up -d` (never `down -v`, which would delete the
> `rustfs-data` volume).

### 3. Point the Convex deployment at RustFS

From `packages/backend`:

```bash
npx convex env set RUSTFS_ENDPOINT        http://rustfs:9000
npx convex env set RUSTFS_PUBLIC_ENDPOINT http://127.0.0.1:9000
npx convex env set RUSTFS_ACCESS_KEY      <your key>
npx convex env set RUSTFS_SECRET_KEY      <your secret>
npx convex env set RUSTFS_REGION          us-east-1
```

Copy the remaining values from `packages/backend/.env.example` into the deployment
environment (`npx convex env set NAME value`), then deploy:

```bash
npx convex dev --once
```

### 4. Configure the frontend

```bash
cp apps/app/.env.example apps/app/.env      # Convex URL, Sentry, OpenPanel, Resend
cp apps/web/.env.example apps/web/.env
```

At minimum `apps/app/.env` needs:

```bash
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
```

### 5. Run it

```bash
bun dev            # everything (web + app + convex) in parallel
bun dev:app        # dashboard only  → http://localhost:3000
bun dev:web        # marketing site only
```

Sign up from the dashboard, create a workspace, and you get a storage account with a
default bucket automatically (`provisioning.provisionDefaultStorage`).

## Configuration

All configuration is environment-driven. **No real `.env` file is committed** — the
repository ships templates only:

| Template | Purpose |
| --- | --- |
| `self-hosted/.env.example` | Docker Compose stack (ports, origins, RustFS keys) |
| `packages/backend/.env.example` | Convex deployment variables (backend adapter, email, RustFS, S3 gateway) |
| `packages/backend/.env.local.example` | Local `convex dev` connection settings |
| `packages/rustfs/.env.example` | Standalone RustFS client credentials |
| `apps/app/.env.example` | Dashboard app variables |
| `apps/web/.env.example` | Marketing site variables |

The variables that matter most for storage:

| Variable | Where | Meaning |
| --- | --- | --- |
| `RUSTFS_ENDPOINT` | Convex | Internal RustFS URL (`http://rustfs:9000`) used by actions |
| `RUSTFS_PUBLIC_ENDPOINT` | Convex | Browser-reachable RustFS URL used to build presigned URLs |
| `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` | Convex + Compose | RustFS root credentials (server-side only) |
| `S3_CREDENTIAL_ENCRYPTION_KEY` | Convex | AES-GCM key used to encrypt S3 credential secrets |
| `S3_MAX_OBJECT_BYTES` | Convex | Hard cap on a single object |
| `S3_PRESIGN_TTL` | Convex | Lifetime of presigned URLs (seconds) |
| `S3_GATEWAY_MAX_BYTES` | Convex | Max body size accepted by the gateway (default 10 MiB) |
| `OIDC_SITE_URL` | Convex | Public site origin for OIDC discovery (self-hosted: `:3220`) |

## Commands

| Command | Description |
| --- | --- |
| `bun dev` | Run all workspaces in dev mode |
| `bun dev:app` / `bun dev:web` | Run a single app |
| `bun build` | Build all workspaces (Turborepo) |
| `bun typecheck` | `tsc --noEmit` across workspaces |
| `bun lint` | Biome lint + `sherif` monorepo dependency check |
| `bun format` | Biome format (write) |
| `bun test` | Vitest across workspaces |
| `bun clean` | Remove workspace build artifacts |
| `cd packages/backend && npx convex dev --once` | Deploy the backend |
| `cd packages/backend && npx convex dev --tail-logs` | Deploy + stream logs |

## Usage

### Dashboard

`http://localhost:3000` → sign up → onboarding creates your workspace and a default
storage account. From there: **Buckets** (create/delete/inspect), **Bucket detail**
(upload, download, delete objects), **Credentials** (create/rotate/revoke S3 keys and
`sk_` API keys), **Platform** (members, roles, invitations, usage, audit, events),
**Files**, **Jobs**, **Settings**.

### S3 API

Point any S3 client at the gateway:

```bash
aws s3 --endpoint-url http://127.0.0.1:3211/s3 ls
aws s3 --endpoint-url http://127.0.0.1:3211/s3 cp ./file.txt s3://<bucket>/file.txt
```

```python
import boto3
s3 = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:3211/s3",
    aws_access_key_id="<accessKeyId>",
    aws_secret_access_key="<secretAccessKey>",
    region_name="us-east-1",
)
s3.put_object(Bucket="<bucket>", Key="hello.txt", Body=b"hi")
```

The bucket name on the wire is the **physical** name (`<accountCode>-<yourName>`); the
dashboard shows the friendly name and resolves it for you.

Supported operations (mapped by `storageValidate.s3ActionForRequest`): `ListAllMyBuckets`,
`ListBucket`, `ListBucketVersions`, `CreateBucket`, `DeleteBucket`, `GetBucketLocation`,
`Get/PutBucketTagging`, `Get/PutBucketCors`, `Get/PutBucketVersioning`, `PutObject`,
`GetObject`, `HeadObject`, `DeleteObject`, `GetObjectVersion`, `DeleteObjectVersion`,
`Get/Put/DeleteObjectTagging`, multipart upload (`CreateMultipartUpload`, `UploadPart`,
`CompleteMultipartUpload`, `AbortMultipartUpload`) and `DeleteObjects` (batch).

## Security model

- **Tenant isolation.** Every table carries `workspaceId`; every function re-checks
  membership and role. A credential is bound to one storage account, and the gateway
  rejects any bucket outside that account (`403 AccessDenied`).
- **Least-privilege credentials.** A credential may be restricted to specific buckets
  and specific S3 actions. Violations return `403 AccessDenied` before any upstream
  request is made.
- **Secrets never leave the server.** RustFS root credentials are used only inside
  actions and the gateway; S3 credential secrets are AES-GCM encrypted at rest and
  shown once. Dashboard API keys are stored hashed.
- **Revocation is immediate.** Revoking a credential or disabling an account blocks
  subsequent gateway requests and dashboard mutations.
- **Auth hardening.** Mandatory email verification, password policy, lockout after
  repeated failures, short-lived sessions, and invite-role validation
  (only `admin` / `member` can be invited).
- **Auditability.** Storage and platform actions are written to the audit log and
  event stream.

## Testing

```bash
bun test                      # unit + convex-test suites
cd packages/backend && npx vitest run
cd packages/rustfs && npx vitest run
```

Live suites (require a running stack) live in `e2e/`:

```bash
cd e2e
npm install
node p2-auth.js               # auth journeys
node p2-idor.js               # adversarial cross-tenant isolation
npm run dashboard             # dashboard UI suites (Playwright)
```

The `convex-test` harness in `packages/backend/test/` is currently unstable; the live
Convex + RustFS stack plus the `e2e/` suites are the authoritative verification path.

## Deployment

- **Self-hosted (recommended here):** `self-hosted/docker-compose.yml` runs the Convex
  backend, dashboard, RustFS and the OIDC-fix sidecar. `deploy/` contains ordered,
  idempotent provisioning scripts (`01-host-setup.sh` … `54-email.sh`) for a Linux host,
  Caddy TLS, Cloudflare Tunnel, Mailpit and GlitchTip.
- **Convex Cloud:** drop the `self-hosted/` stack, point `NEXT_PUBLIC_CONVEX_URL` at the
  cloud deployment, and set `RUSTFS_ENDPOINT` to a reachable RustFS/S3 endpoint.

## Further documentation

- `ROADMAP.md` — current state and planned work.
- `S3_BUILD_RECOMMENDATIONS_REPORT.txt` — gap analysis and engineering feasibility for S3 parity.
- `aws-s3-comparison-2026-10-16.txt` — feature-by-feature comparison against the AWS S3 API.
- `TEMPLATE.md` — the reusable "dashboard + Convex control plane" template this project is built on.
- `packages/backend/convex/README.md` — Convex backend notes.
- `e2e/README.md` — how to run the live suites.

## Future improvements

- Streaming/multipart uploads from the dashboard for large objects.
- Bucket-level quotas and lifecycle policies (expiration, transition).
- S3 event notifications (queue targets) and replication.
- Range reads / partial GETs on the gateway.
- Named tunnels + stable domains to replace ephemeral Cloudflare URLs.
- Replace the unstable `convex-test` harness with the live-stack suites as the CI gate.

## License

See [LICENSE.md](./LICENSE.md).
