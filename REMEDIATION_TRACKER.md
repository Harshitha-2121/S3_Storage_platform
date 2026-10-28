# S3 Storage Platform — Remediation Tracker

Working document for the security remediation. Evidence recorded as work completes.
Never print secret values here.

## Baseline (Phase 1)
- Branch `main`, HEAD `fb70126` (clean commits end there).
- ~20 modified files in working tree containing most of the fixes described by the QA report.
- Services up at inspection time: Convex :3210, S3 gateway :3211/s3, RustFS :9000. Frontend :3000 down.
- `REDACT_LOGS_TO_CLIENT=true` (default) is a real Convex self-hosted setting (verified against get-convex/convex-backend docs & source).

## Defect matrix

| ID | Sev | Defect | Files | Status |
|----|-----|--------|-------|--------|
| D1 | P0 | OTP code logged in fail-open branches; no explicit dev gate; no provider => code logged & flow continues | ResendOTP.ts, passwordProviders.ts | PARTIAL (working tree) — TODO harden |
| D2 | P0 | email.ts logs full email body (contains OTP) when RESEND_API_KEY missing | email.ts | TODO |
| D3 | P0 | SMTP_HOST referenced but no SMTP transport exists (misleading config branch) | passwordProviders.ts | TODO |
| D4 | P0 | Next.js hydration/auth asset 400 (stale/mixed .next) | apps/app | TODO: build procedure + build identity + verify |
| D5 | P1 | Hardcoded S3 creds in 6 python test files | test_*.py, run_benchmark.py | TODO: env-driven config |
| D6 | P1 | Compose ports bound to all interfaces | docker-compose.yml | FIXED in working tree (127.0.0.1 bindings) — verify |
| D7 | P1 | Deployment parity / build identity | apps/app, scripts | TODO |
| D8 | P1 | Invitation email normalization | orgs.ts | FIXED in working tree (mostly) — tests TODO |
| D9 | P2 | Multipart generic test uses undersized non-final parts | test_gateway_suite.py | TODO |
| D10 | P2 | ~20 TypeScript errors | backend + frontend | TODO: serial typecheck |
| D11 | P2 | Malformed percent-encoding returns 500 | gateway.ts | FIXED in working tree |
| D12 | P2 | copy/rename missing source-key validation | objects.ts | FIXED in working tree |
| D13 | P2 | storageAccount validation gaps | storageAccounts.ts | FIXED in working tree |
| D14 | P2 | createCredentialInternal callable without dev gate | s3Credentials.ts | FIXED in working tree (requireDevSeed) |
| D15 | P2 | sigv4 toHex indexing | sigv4.ts | cosmetic in tree; verify tests pass |
| D16 | P0/P1 | Authorization/tenant isolation suite currency | e2e/p2-idor.js, test_isolation.py | TODO: run live; report revision |
| D17 | P1 | Resend cooldown interval leak | login/page.tsx | FIXED in working tree |
| D18 | P2 | Hardcoded tunnel URL / endpoint in onboarding copy | onboarding/page.tsx | FIXED in working tree — verify |

## Verification log
(appended as commands are run)

### 2026-10-23 — OTP leak reproduced live
- POST http://127.0.0.1:3210/api/action (auth:signIn, resend-otp, test email) returned
  logLines containing the OTP `'[auth] OTP for <email>: <token>'` → P0 CONFIRMED S33.
- Cause: running backend container was started from the OLD compose (no
  REDACT_LOGS_TO_CLIENT) with OLD deployed functions (unconditional token logging).

### 2026-10-23 — P0 OTP code hardening
- New `packages/backend/convex/authEmailDelivery.ts`: explicit AUTH_DEV_FALLBACK gate;
  fail-closed when no provider; sanitized delivery-failure errors; no body logging.
- ResendOTP.ts, passwordProviders.ts rewritten against the policy (no SMTP-host
  fallback — SMTP transport never existed in this codebase).
- email.ts: no longer logs email body (recipient+subject only). Body may contain codes.
- Packages/backend .env.example: AUTH_DEV_FALLBACK documented (0/absent by default).
- `bun vitest run test/otp.test.ts` → **21/21 PASSED** (leaf: redaction of codes in console
  output in every path except the explicit dev fallback; fail-closed; sanitized errors).

### 2026-10-23 — Docker hardening live-applied (local stack)
- `docker compose config` → all 7 published ports resolve to host_ip 127.0.0.1.
- `docker compose up -d` → recreated backend/oidc-fix/dashboard/rustfs:
  - `docker ps` shows 127.0.0.1 bindings for 3210/3211/3220/6791/9000/9001.
  - backend container env has REDACT_LOGS_TO_CLIENT=true.
- `bunx convex env set AUTH_DEV_FALLBACK 1` → success (local dev deployment only).

### BLOCKED — function code push to local backend
- `bunx convex dev --once` (twice) → InvalidModules: module evaluation exceeded 4s.
- Docker VM resources: 4 CPUs, ~3 GB RAM (severe host memory pressure).
- Same timeout observed for `convex env list` system query before backend restart;
  restarted backend fixed that but not module loading.
- Operator action: after host memory is freed, run (from packages/backend):
    bunx convex dev --once
  then re-run test_otp_no_leak.py (written by Phase 3 watch).

