# Dashboard control-plane template

A clonable **dashboard + Convex control-plane** that attaches to *any* backend. Drop it in
front of a new AI SaaS and skip rebuilding auth, user management, billing, files, real-time
UI, jobs, usage metering, API keys, and audit logging. Your product/AI logic lives in a
separate backend; this is the platform plumbing.

## Architecture

```
Browser ─▶ Next.js dashboard (apps/app)
              │  reactive queries/mutations (live)
              ▼
        CONVEX control-plane (packages/backend)
        auth(OTP) · users · orgs/RBAC · jobs · files
        usage · api keys · audit · billing · JWKS · webhooks
              │ proxy (service key)        ▲ webhook (results/events)
              ▼                            │
        YOUR REAL BACKEND (swappable, any language)  ── reference impl: backend-echo/
```

Two planes:
- **Convex owns the platform plane** — identity, users, orgs, jobs, usage, files, audit, and the reactive UI state.
- **Your backend owns the domain plane** — the AI/business logic and its own data.

## Attach any backend (hybrid)

| Path | How | Use for |
|---|---|---|
| **Direct** | browser → your backend with the Convex JWT, verified via **JWKS** (`<site>/.well-known/jwks.json`, `aud=convex`) | reads, streaming AI responses |
| **Proxy** | Convex action `callBackend` → your backend with a shared **service key** + `x-user-id` | privileged / server-only ops |
| **Webhook** | your backend → `POST <site>/backend/webhook` (shared secret) → Convex tables → live UI | results, events, job completion |

`backend-echo/server.mjs` is a ~120-line reference backend implementing all three (JWKS verify in ~10 lines). Swap it for your real backend by changing `BACKEND_BASE_URL` + `NEXT_PUBLIC_BACKEND_URL`.

## What's included

- **Auth** — passwordless magic email OTP (Convex Auth + Resend), issues RS256 JWTs + JWKS
- **Users / Orgs / RBAC** — `users`, `workspaces`, `members` (owner/admin/member), `invites`, `requireRole`
- **Jobs** — async/AI task primitive with a live dashboard page (create → backend → webhook → done)
- **Usage metering**, **API keys** (+ `/api/verify-key`), **Audit log**, **Billing** (Polar)
- **Hybrid adapter** — `convex/backend.ts`, `/backend/webhook`, `apps/app/src/lib/backend-client.ts`

## Deploy / clone for a new project

1. Provision a fresh Ubuntu 24.04 VM. Copy this repo onto it (git clone or `scp`).
2. *(optional)* Re-scope the packages: `grep -rl '@v1/' . --include='*.ts*' --include='*.json' | xargs sed -i 's#@v1/#@myapp/#g'`
3. Install + deploy everything with one command:
   ```bash
   sudo HOST=<vm-ip-or-domain> bash deploy/setup.sh
   ```
4. Open `http://<host>:3000`, sign in (OTP is shown in the Convex dashboard logs at `:6791` until you set `RESEND_API_KEY`), set a username, and you're in.

`deploy/setup.sh` is idempotent for keys/secrets (won't clobber existing ones). The numbered
`deploy/01`–`17` scripts are the individual steps it composes (kept for reference/debugging).

## Add a feature module (the recipe)

1. **schema** slice in `packages/backend/convex/schema.ts`
2. **functions** file `packages/backend/convex/<feature>.ts` (query/mutation/action)
3. **route** `apps/app/src/app/[locale]/(dashboard)/<feature>/page.tsx` (use `useQuery` for live data)
4. **nav** tab in `_components/navigation.tsx`

The **Jobs** module is the worked example.

## Conventions

- **Bun for installs only; Node for the Convex CLI and Next** (Bun ws bug, convex-backend #390).
- Secrets live in Convex deployment env + `*.env`/`.env.local` (gitignored), never in code.
- Convex JWT: `iss=<site>`, `aud=convex` — verify with the JWKS endpoint from any language.

## Push as a GitHub template

```bash
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
# then: GitHub → repo Settings → "Template repository" ✓
```
New projects: **Use this template** (or `npx degit <you>/<repo> my-app`).
