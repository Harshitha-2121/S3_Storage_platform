# Self-hosted stack (Convex + RustFS + OIDC sidecar)

This folder runs the platform's back end entirely on your own machine or host.

```
docker compose up -d
```

| Service | Container | Port | Purpose |
| --- | --- | --- | --- |
| `backend` | `ghcr.io/get-convex/convex-backend` | 3210 (API), 3211 (site) | Convex functions, database, auth, HTTP actions |
| `oidc-fix` | `node:20-alpine` | 3220 | Repairs the invalid JWKS/OIDC metadata of the upstream image |
| `dashboard` | `ghcr.io/get-convex/convex-dashboard` | 6791 | Convex dashboard |
| `rustfs` | `rustfs/rustfs` | 9000 (API), 9001 (console) | S3-compatible object storage |

## Setup

```bash
cp .env.example .env
# set RUSTFS_ACCESS_KEY and RUSTFS_SECRET_KEY
docker compose up -d
```

Then point the Convex deployment at RustFS (from `packages/backend`):

```bash
npx convex env set RUSTFS_ENDPOINT        http://rustfs:9000
npx convex env set RUSTFS_PUBLIC_ENDPOINT http://127.0.0.1:9000
npx convex env set RUSTFS_ACCESS_KEY      <same value as in .env>
npx convex env set RUSTFS_SECRET_KEY      <same value as in .env>
npx convex env set RUSTFS_REGION          us-east-1
npx convex dev --once
```

## Why the `oidc-fix` sidecar exists

The upstream `convex-backend` image serves an **invalid JWKS document** (unquoted JSON
keys) and truncated OIDC metadata on the site proxy. That makes OIDC discovery fail
(`AuthProviderDiscoveryFailed`) and no login can complete.

`oidc-fix-proxy.mjs` shares the backend's network namespace
(`network_mode: "service:backend"`, so `127.0.0.1:3220` resolves from inside the
backend container), serves a valid metadata + JWKS document, and reverse-proxies
everything else to the real site proxy.

Set `CONVEX_SITE_ORIGIN=http://127.0.0.1:3220` in `.env`, and the matching
`OIDC_SITE_URL` on the Convex deployment.

## Restarting safely

The `oidc-fix` sidecar shares the backend's network namespace, so a bulk
`docker compose restart` races the namespace rejoin and fails with:

```
cannot join network of a non running container
```

Use instead:

```bash
docker compose down
docker compose up -d
```

**Never** use `docker compose down -v` — it would delete the `rustfs-data` volume and
all stored objects. The volumes (`data`, `rustfs-data`) persist across `down`/`up`.

## Volumes

| Volume | Type | Contents |
| --- | --- | --- |
| `data` | managed | Convex database and deployment state |
| `rustfs-data` | **external** | Object bytes — declared `external: true` so it survives stack recreates |

If `rustfs-data` is missing, create it once:

```bash
docker volume create rustfs-data
```

## Health checks

```bash
curl -sf http://127.0.0.1:3210/version && echo "convex OK"
curl -sf http://127.0.0.1:6791/         && echo "dashboard OK"
curl -sf http://127.0.0.1:9000/minio/health/live && echo "rustfs OK"
curl -sf http://127.0.0.1:3220/.well-known/jwks.json && echo "jwks OK"
```

## Local email

`mailpit/` provides a local SMTP server (SMTP `:1025`, web inbox `:8025`) so signup and
password-reset emails can be tested without a real provider. See `mailpit/README.md`.
`glitchtip/` is a self-hosted Sentry alternative — see `glitchtip/README.md`.
