# Release Checklist — S3 Storage Platform

Audience: an authorized operator with VM/SSH access.
Every step is evidence-based: run the command, observe the expected result.
Nothing here prints secrets; `.env` files stay on the host and out of Git.

> Last verified revision of this document: working tree at commit `fb70126`
> (2026-10-23). Verification evidence for the local stack is in
> `REMEDIATION_TRACKER.md`.

---

## 0. Preconditions (all are gates)

```bash
# Source of truth for what you are deploying:
git rev-parse HEAD          # record this — build identity reference
git status                  # must be clean or contain ONLY reviewed changes
docker --version && docker compose version
```

- Docker VM needs memory: the Convex backend module evaluation requires the
  host not be under load (module loading timed out at 4 s on a 3 GB VM).
- Email provider configured at the deployment (OLLASTACK_API_KEY with a `mail.*:send`-scoped API token) - see step 2.

## 1. Environment parity — deploy function code

The QA defect history shows deployments running stale functions (`logLines`
leaking OTP codes). Function code MUST be pushed on every release:

```bash
cd packages/backend
bunx convex env list                    # sanity: connectivity
bunx convex dev --once                  # push functions (local/dev deployment)
bunx convex deploy                      # prod deployments — NEVER run --settle args by hand
```

If push fails with `InvalidModules ... Function execution timed out (maximum
duration: 4s)`: free host memory (stop builds, other containers), then retry
ONCE. Do not loop retries.

**Do NOT set `AUTH_DEV_FALLBACK=1` on production deployments.** Dev-mode only:

```bash
bunx convex env set AUTH_DEV_FALLBACK 1   # DEV DEPLOYMENTS ONLY
```

## 2. Production email (OTP) configuration

Production OTP delivery requires exactly one value set on the deployment:

```bash
bunx convex env set OLLASTACK_API_KEY <value>
bunx convex env set OLLASTACK_MAILBOX_ID <mailbox-id from Ollastack dashboard>
bunx convex env remove AUTH_DEV_FALLBACK            # ensure it is ABSENT
```

Verify configuration WITHOUT leaking values:

```bash
bunx convex env list | grep -c "PRODVALUE" || true   # expect: key names only
python test_otp_no_leak.py                           # local run; see step 4
```

- If `OLLASTACK_API_KEY` is missing in production, sign-in fails closed with
  "Unable to deliver the verification code by email" - that is correct behavior.
- Sending requires a dedicated mail send scope (`mail.agent:send` or
  `mail.test:send`) on the Ollastack API token; `:read`/`:write` scopes are
  NOT sufficient, and a target mailbox must exist (pin `OLLASTACK_MAILBOX_ID`).

## 3. Infrastructure — Docker / network

```bash
cd self-hosted
docker compose config >/dev/null && echo "compose OK"

# Assert loopback-only binding (all published ports):
docker compose config | grep -c "host_ip: 127.0.0.1"   # expect 7 vaues below
docker compose up -d                                   # recreate; data volumes preserved

# Verify running state:
docker ps --format '{{.Names}}\t{{.Ports}}'
docker exec self-hosted-backend-1 sh -c 'env | grep REDACT'
```

Expected:
- backend 3210/3211(→3220), rustfs 9000/9001, dashboard 6791 — ALL bound to
  `127.0.0.1` (loopback). Public exposure only via the frontend and the
  intended tunnel/proxy.
- `REDACT_LOGS_TO_CLIENT=true` present in backend env.

If a service must be reachable by external hosts deliberately (reverse proxy
on another machine), that is a documented, reviewed exception — never an
accident of the default compose file.

## 4. OTP secrecy — live verification

From a machine that can reach the backend:

```bash
python test_otp_no_leak.py      # negative probes: signin + signup flows
```

Expected: `RESULT: PASS` (no code in HTTP responses or client logLines).
A FAIL means the deployment has stale functions or redaction is off — go to
step 1 and 3, then re-run.

## 5. Frontend — stop/build/start (never mixed artifacts)

The Next.js login regression (`/_next/static` 400s → no hydration) is caused
by serving a stale/mixed `.next` while rebuilding. Deploy with immutable
artifacts and a verified build ID:

```bash
cd apps/app
export NEXT_PUBLIC_CONVEX_URL=<public origin the browsers can reach>

# 1) stop first, build second, start third — never build while serving
(set +e; kill $(cat ../.next.pid) 2>/dev/null; sleep 2)
rm -rf .next        # stale artifacts are the failure mode
bun run build       # FAILS on typecheck/lint errors (see next.config)

# 2) record the build identity
node -e "console.log(require('fs').readFileSync('.next/BUILD_ID','utf8'))"

# 3) start only after the build is complete
nohup bun run start > ../frontend.log 2>&1 & echo $! > ../.next.pid
```

Fail-safe: because `rm -rf .next` happens BEFORE `bun run build`, a failed
build leaves NO artifacts instead of a partial replacement. A failed deploy
does not replace the last good deployment.

## 6. Build identity — parity proof

```bash
# served HTML build id
curl -s http://127.0.0.1:3000/login | grep -oE '__next_build_id[^,]+' | head -1
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/_next/static/$(node -p "require('fs').readFileSync('apps/app/.next/BUILD_ID','utf8')" )/nonexistent
# ^ static prefix must respond with the build-relative path (404/200, NEVER 400)

# deployment->git parity
git rev-parse HEAD                   # must equal the revision you deployed
```

## 7. Smoke tests (serial; full suites section below)

```bash
python test_gateway_suite.py            # S3 API matrix (needs S3_TEST_*)
python test_isolation.py                # tenant isolation
python test_security_hardening.py       # traversal / signature / quota defenses
python test_cross_tenant_copy_and_range.py
python test_multipart_5mb.py            # 5MB multipart
python test_otp_no_leak.py              # OTP secrecy (no test identity leakage)
node e2e/p2-idor.js                     # RBAC/IDOR matrix (needs test accounts)
```

All suites are env-credential driven (`.env.s3-test.example`); nothing in the
repository embeds credentials.

## 8. Rollback

1. `docker compose -f self-hosted/docker-compose.yml down` (keep volumes).
2. `git checkout <last-good-revision>` at the VM, redeploy per steps 1 & 5.
3. Data rollback: `deploy/backup.sh` restore procedure — DB compatibility is
   preserved (Convex migrations are versioned/forward-only; the backend logs
   "db metadata version up to date").

Rollback restores code only. Data written after the rollback point is not
discarded.

## 9. Known-ignorables (tracked debt)

- `b*.js`, `mainApp.js`, `loginPage.js`, `tunnel_login.html`,
  `ERROR_REPORT_*.txt`, `TODAYS_PROGRESS_*` at repo root are one-off local
  debug artifacts — untracked, and safe to ignore for release; recommend
  adding them to `.gitignore` at the next housekeeping commit.
- `apps/app/next.config.mjs` Sentry `tunnelRoute: "/monitoring"` — verify the
  tunnel host allows `/monitoring` before enabling Sentry transport in prod.
