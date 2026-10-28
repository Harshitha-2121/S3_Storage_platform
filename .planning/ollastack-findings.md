# Special investigation: Ollastack, login outage, and deployment

## A. Executive summary

**Release recommendation: BLOCKED.** The public login UI does not hydrate correctly: two required JavaScript assets return HTTP 400, and the Admin Login tab does not switch views in Chromium. The same interactions pass on the local development application.

**Ollastack is not established as the outage cause.** No runtime Ollastack imports, calls, handlers, or test retrieval logic were found in the accessible working-tree source or the seven available Git revisions. The only historical match is the access-restricted root `.env.example`, introduced by `687174affddbeaffc9aa2591d7a78bc54ed8dfd2`. Its contents, API host, and variable names were not inspected because environment-file access is denied by tooling. Do not infer that its configuration is active or inactive on the deployment.

The confirmed failure mechanism is origin-served JavaScript asset rejection preventing frontend interactivity before any provider request. The underlying filesystem/build/runtime cause is **not confirmed**. Do not equate this evidence with a proven stale build, missing files, permissions issue, or specific faulty commit.

No authentication, deployment, environment, credentials, sessions, or application data were changed in this investigation.

## B. Inventory and login trace

### Relevant modules
- Dashboard: Next.js 14.2.7 App Router, React 18, TypeScript.
- Authentication: installed `@convex-dev/auth` 0.0.80; Convex 1.19.2.
- Browser automation: installed Playwright 1.64.1; Chromium available.
- Unit/in-memory testing: installed Vitest 5.0.3; edge-runtime backend test environment.
- Local Next.js: port 3000. Local documented backend/storage ports 3210/3211/3220/9000 did not accept connections.
- Remote origin discovered in existing incident documentation: frontend, Convex, OIDC sidecar, and RustFS independently probed using non-mutating requests.

### Actual browser-to-backend path
1. `apps/app/src/app/[locale]/(public)/login/page.tsx`: `sendCode` calls `signIn("resend-otp", { email: normalizedEmail })`; verification supplies `code`. Password signup/signin/reset use provider `password` with flow parameters.
2. `apps/app/src/app/convex-client-provider.tsx`: `ConvexAuthNextjsProvider`; reactive client uses `env.NEXT_PUBLIC_CONVEX_URL` in the working tree.
3. Installed `@convex-dev/auth/dist/nextjs/client.js`: POST JSON `{action, args}` to same-origin `/api/auth`.
4. `apps/app/src/middleware.ts` and installed auth `src/nextjs/server/proxy.ts`: middleware proxies `auth:signIn` to Convex using `fetchAction`; auth cookies are set/cleared in this layer.
5. `packages/backend/convex/auth.ts`: password provider with verification/reset, `ResendOTP`, Google; brute-force configuration remains in place.
6. `ResendOTP.ts` / `passwordProviders.ts` -> `authEmailDelivery.ts` -> `internal.email.sendEmail` -> `packages/backend/convex/email.ts` -> POST `https://api.resend.com/emails`.
7. Delivery configuration in source: `RESEND_API_KEY`, `RESEND_SENDER_EMAIL_AUTH`; explicit development flag `AUTH_DEV_FALLBACK`. No SMTP transport import was found in accessible application source, despite nodemailer being declared as a dependency and SMTP documentation existing.
8. Successful authentication depends on session/JWT/cookie handling, not on any discovered Ollastack call. Already-authenticated dashboard initialization reads `users.getUser`, `orgs.myWorkspaces`, and workspace data from Convex. `WorkspaceProvider` may call `orgs.ensureWorkspace` when no workspace exists. No Ollastack dependency found in that path.
9. Onboarding sets a username then calls `provisioning.provisionDefaultStorage`; provisioning errors have a UI branch. Actual authenticated onboarding behavior was not executed.
10. `sessions.ts`: session listing and ownership checks; revocation deletes refresh tokens/session rows. Live revocation was intentionally not executed against shared accounts.

### Other integrations preserved
- `convex/web.ts`: newsletter form calls Loops (`app.loops.so`), not Ollastack.
- `convex/http.ts`: auth routes, S3 gateway, Polar webhook, backend webhook, API-key verification. No discovered Ollastack handlers.
- `convex/email/index.ts`: second Resend utility; no non-generated caller import found by the targeted source scan.
- Existing OTP E2E helpers retrieve codes from server/client logs. No Ollastack reference found in those helpers. They were not executed because some expose codes, use hard-coded accounts, require privileged SSH, or alter shared sessions.

## C. Git evidence and comparison

Available history contains seven revisions. All refs point at `fb70126` (main/recovery/origin refs); this is not evidence of what is deployed.

| Revision | Verified source change | Interpretation |
| --- | --- | --- |
| `aeb7317` | Initial available revision; auth, middleware, Resend transport already present | Pre-introduction comparison point only; NOT a verified known-good deployment |
| `687174a` | Only historical Ollastack match is added `.env.example`; same commit changes login/UI, gateway/HTTP routing and disables build-time checks | Presence in configuration does not establish runtime use or causal responsibility |
| `8b923f8` | OTP providers switch scheduler-first/caught delivery to action-first delivery; Resend error message parsing changes | Mail delivery behavior changed independently of any found Ollastack runtime call |
| `7465712` | OTP generators change from 8 digits to 6 | Source still contains 8-digit UI placeholders; not fixed in this incident investigation |
| `be52e5c` | Provider failures are caught/tolerated again | Historical behavior is not safe to restore blindly: it logs codes and tolerates failed delivery |
| `50dc50e` | Browser Convex target becomes same-origin `/api/convex`; rewrite points to local :3210 | Possible deployment-sensitive change; no causal claim for current asset rejection |
| `fb70126` | Browser Convex target becomes a hard-coded Quick Tunnel hostname | Working tree already removes this hard-coded override; that change predates this investigation |

Working-tree changes, which were present at investigation start:
- Auth delivery now fails closed unless a development fallback is explicitly enabled.
- `authEmailDelivery.ts` and `test/otp.test.ts` are untracked, pre-existing files, not authored here.
- Earlier notes said `next.config.mjs` re-enabled build checks. The 2026-10-26 continuation instead reads `ignoreBuildErrors: true` and `ignoreDuringBuilds: true` in the current working tree (lines 8 and 11). The earlier description is not a reliable statement of the present configuration; no config change was made in this continuation.
- Numerous unrelated storage/UI/backend edits exist. They were preserved.

`auth.ts`, `auth.config.ts`, and middleware have no diff against `aeb7317` in the current working tree. A verified last-working SHA, runtime environment change timeline, and deployed SHA are unavailable. Exact host/variable changes inside restricted environment files remain blocked; their values were neither read nor reported.

## D. Execution matrix and evidence

| ID | Check actually executed | Result | Evidence / limitation |
| --- | --- | --- | --- |
| INV-01 | Non-environment text search across working tree, excluding dependencies/build/cache/binary data | PASS (search completed) | No implementation Ollastack match; investigation docs themselves subsequently contain the term |
| INV-02 | `git log --all -G` plus non-environment `git grep` over all seven revisions | PASS (search completed) | `.env.example` at `687174a` is the sole historical match; restricted content not read |
| HTTP-01 | Public root/login GET | PASS | Root 307; login 200 |
| HTTP-02 | Local root/login GET | PASS | Root 307; login 200 |
| UI-LOCAL | Chromium read-only login/navigation probe | PASS: 5 checks | Dashboard redirect, Admin tab transition, User tab transition, storage redirect, all encountered scripts successful |
| UI-PUBLIC | Same final Chromium probe | 2 PASS, 2 FAIL, 1 BLOCKED | Redirect checks pass; Admin tab transition and scripts fail; User transition blocked rather than falsely passed from initial SSR content |
| ASSET-01 | Two failing assets via public tunnel | FAIL | Both HTTP 400, text/html; CF-Cache-Status DYNAMIC |
| ASSET-02 | Same two assets direct to origin | FAIL | Both HTTP 400; body length 1987; body SHA-256 identical to tunnel responses |
| API-01 | GET `/api/auth` on local/public | PASS | 405, expected method rejection |
| API-02 | POST invalid action on local/public | PASS | 400 and expected fixed rejection; no account/provider dispatch |
| API-03 | POST unsupported provider, no credentials on local/public | Confirmed failure-path behavior | 200 JSON null on both; installed proxy catches backend errors and returns null |
| BACKEND-01 | Separate Convex tunnel `/version` | PASS reachability only | 200; not proof of login/session correctness |
| BACKEND-02 | Anonymous Convex queries | PASS: 4 checks | auth:isAuthenticated false; sessions:mySessions []; orgs:myWorkspaces []; users:getUser null; all RPC success, HTTP 200, zero log lines |
| ORIGIN-01 | Direct origin frontend, Convex version, RustFS health, OIDC metadata GET | PASS reachability only | Each 200; no authenticated operation asserted |
| STORAGE-01 | Anonymous direct origin `/s3/` | PASS expected rejection | 403; does not verify signed storage operations |
| UNIT-OTP | Existing isolated `test/otp.test.ts` | PASS | 21/21; no live mail delivery exercised |
| UNIT-BACKEND | Complete existing backend suite | FAIL | 31 passed, 24 failed, 55 total; two files pass, two fail |
| UNIT-BACKEND-DIAG | Narrow security/provisioning diagnostic | FAIL, retries stopped | 4 passed, 24 failed; repeated `Right-hand side of 'instanceof' is not an object`; not product authorization proof |
| STORAGE-SUITE | Existing RustFS suite | FAIL setup / partial passes | 38 passed, six live tests skipped; client suite setup throws ECONNREFUSED for local :9000 |
| TYPE-01 | App `tsc --noEmit --incremental false` | PASS | Exit 0 |
| LINT-01 | Biome lint new incident probe | PASS | Exit 0; one file checked; no fixes applied |
| SYNTAX-01 | Node syntax check new probe | PASS | Exit 0 |
| BUILD-01 | Production build | NOT RUN | Active local dev server uses same .next location; avoid replacing its artifacts during diagnosis. Build in an isolated checkout/artifact directory next |
| E2E-AUTH | Real OTP/password login, logout, refresh/session renewal | BLOCKED | Dedicated authorized test account/mailbox not supplied; public hydration failure; unsafe existing scripts not used |
| E2E-DASHBOARD | Authenticated dashboard/onboarding | BLOCKED | Same account prerequisite; no fabricated session used |
| E2E-STORAGE | Signed object/bucket CRUD | BLOCKED | Requires isolated test credentials/resources; local RustFS unavailable; remote health alone is insufficient |

### Exact asset evidence
- `/_next/static/chunks/main-app-08bc60ea86904a0c.js`
- `/_next/static/chunks/app/%5Blocale%5D/layout-8db8f8d50c5fa55a.js`
- Both direct-origin and public error bodies: SHA-256 `49a1a1c650ead096c000af5d88e50b99eaf262ef3946c3680a8c7fe1483ec59f`.
- Identical hashes are supporting evidence of the same response, not authentication or integrity guarantees.

### Test execution caveats
- First browser-probe version incorrectly allowed the initial User OTP form to count as a successful reverse tab transition after the Admin transition failed. The probe was corrected to mark that dependent check BLOCKED. Only the final matrix above is authoritative.
- The first backend output summarizer hit a Windows Unicode console encoding error AFTER Vitest finished; the captured full-suite summary was 31 passed/24 failed. The bounded diagnostic rerun explicitly set UTF-8 and exposed the repeated harness error. No further retry performed.
- Public browser failures repeated twice; no further unchanged retry attempted. Remote deployment remediation is required first.
- Existing RustFS test setup attempted a connection/provisioning call to unavailable local :9000 and failed before creation succeeded. No successful resource creation or data change was observed.

## E. Defect register and security observations

### OLL-001 — Public login cannot initialize due to rejected required JS assets
- Severity/priority: P1 / high.
- Environment: public Quick Tunnel and its directly reachable origin; fresh Chromium context.
- Reproduce: open `/login`; observe the two asset GETs above returning 400; click Admin Login; Admin Portal heading never appears within bounded wait. Local equivalent succeeds.
- Expected: required scripts return executable JS successfully and tab click switches views.
- Actual: HTTP 400 HTML for required chunks; tab has no visible effect.
- Confirmed mechanism: asset rejection at/before origin asset serving prevents interactivity before auth/email dispatch. Same status/body via direct origin excludes Cloudflare as the sole source.
- Unconfirmed underlying cause: missing/inconsistent .next files, static server state, file permissions, request/path processing, or another origin deployment problem. Next.js installed router source can normalize multiple serveStatic errors to 400; 400 alone does not prove which occurred.
- Affected scope: deployed frontend artifact/runtime; corresponding repository entry points include locale layout and Convex provider, but no responsible source line identified.
- Fix: BLOCKED / not applied. Inspect actual origin process, deployed SHA, .next manifests/files and sanitized server-side errors. Produce a complete build in isolation; switch artifacts atomically only with a safe rollback plan.
- Regression: `e2e/investigate-connectivity.cjs`; currently FAIL public, PASS local.

### OLL-002 — Backend integration test harness fails before meaningful assertions
- Severity/priority: P2 / high verification gap.
- Reproduce: backend Vitest suite; narrow security/provisioning suite.
- Actual: 24 repeatable failures with `Right-hand side of 'instanceof' is not an object`.
- Root cause: not yet isolated beyond the harness/runtime failure; no verified application RBAC defect inferred.
- Fix: pending. Investigate compatible edge-runtime/convex-test/Vitest behavior separately without weakening assertions. Stop condition reached after the same error repeated twice.

### Additional security/error-handling risks (not proven outage causes)
- Historical code logs OTPs and tolerates mail failure. Do NOT restore it to regain apparent login success. Current fail-closed protections were preserved.
- Current explicit development fallback can log codes; actual deployed flag/redaction configuration is unknown. Never enable it on a shared/public deployment as a recovery shortcut.
- Existing live test helpers contain hard-coded login data and log-based OTP retrieval; they require redesign for dedicated accounts and safe private mailboxes before reuse.
- Installed auth proxy catches sign-in exceptions and returns HTTP 200 JSON null; observed with an unsupported provider. Client code expecting an object can then report a misleading redirect-property error. This is a separate failure-path risk, not evidence of a valid-login failure or Ollastack involvement.
- Auth Resend fetch has no explicit request timeout. Error parsing/logging includes provider text; real provider timeouts/rejections were NOT induced and no live message sent.
- dispatchAuthEmail supports scheduler enqueue and silently returns if no usable context; the scheduler path cannot confirm eventual delivery. These are static-review risks, not demonstrated production triggers in this session.
- No XSS/SQLi/credential abuse/stress tests were performed. Security compliance is not claimed.

## F. Deployment and Cloudflare findings

- Public root reaches application middleware; public login HTML is available. Earlier timeout is not a persistent outage conclusion.
- Cloudflare is not the sole cause of the demonstrated asset error: direct origin returns identical errors.
- The local application and remote origin are different runtime/artifact environments. Local success does not verify the deployed artifact or remote authentication.
- Separate backend tunnel responds; local backend absence must not be conflated with remote backend outage.
- Direct `/api/convex/version` without a session returned a redirect locally; middleware matches API paths. Do not assume this rewrite is a valid anonymous WebSocket transport based on its config alone.
- OIDC metadata endpoint responds, but issuer/JWKS/JWT correctness was not asserted. No WebSocket auth/session test completed.
- No tunnel restart, process restart, SSH login, build replacement, backend deploy, env mutation, or database operation was performed.
- Quick Tunnels remain development/testing infrastructure, not a production-reliability guarantee.

## G. Performance observations

Single low-load HTTP samples, concurrent group of five requests to remote services:
- Origin login: 0.772 s, HTTP 200.
- Origin Convex version: 0.507 s, HTTP 200.
- Origin RustFS health: 0.499 s, HTTP 200.
- Origin S3 anonymous rejection: 0.629 s, HTTP 403.
- Origin OIDC metadata: 0.496 s, HTTP 200.
These are one-off network samples, not p95 latency, page-load performance, throughput, SLO validation, or before/after optimization results. No optimization or load test executed.

## H. Changes authored in this investigation

1. `.planning/ollastack-investigation.md`: persistent safety scope, waves, observations and resume instructions.
2. `.planning/ollastack-findings.md`: evidence-backed report and defect/test matrix (this file).
3. `e2e/investigate-connectivity.cjs`: explicit-target, read-only Chromium regression probe; no credentials, OTP retrieval, email submission, or storage mutations; bounded waits; nonzero exit on failed assertions; no raw console/request bodies or query strings logged.

Pre-existing tracked/untracked changes were not reverted, edited, committed, or deployed. Rollback of investigation additions requires removing only these three new files; no data rollback needed. No authentication fix is claimed.

## I. Review and final verification

CodeRabbit CLI unavailable; in-agent review:

| Area | Review disposition |
| --- | --- |
| Security | Probe collects status/path/origin only, no cookies, storage state, bodies, OTPs, or user data. Explicit target URLs required. |
| Logic | Tests assert actual admin/user transitions; dependent User transition becomes BLOCKED on hydration failure. Checks require actual script responses. |
| Isolation | Fresh browser context per target, context/browser closed in finally; no shared user sessions. |
| Reliability | Navigation and control waits bounded; failing runs return nonzero. Same failures repeated twice; no further retry. |
| Scope | No auth/deploy/provider changes; large pre-existing diff preserved. |
| Coverage | Chromium desktop smoke only; no claim of complete auth, cross-browser, accessibility, or storage coverage. |

Essential verification remains incomplete. No confirmed P0 identified; one confirmed P1 origin asset failure and one P2 test-harness verification defect are registered. Further static-review risks remain untriaged, not silently classified as tested product bugs.

## J. Next actions / resume from first incomplete prerequisite

1. Obtain authorized read-only access to origin process logs and build directory, deployed SHA/build ID, and the last verified working release. Do not dump full environments or email payloads.
2. Determine actual cause of the two static asset 400s using logs, manifest/file existence and permissions. Do not assume a source rollback or provider change will repair it.
3. Prepare an isolated production build, verify all manifest-referenced assets, and propose an atomic rollout/rollback. No resets or data migrations required for asset diagnosis.
4. Obtain an approved, sanitized mapping of Ollastack variable NAMES/purpose and host from the restricted configuration owner. Need no token values. Establish whether any out-of-repository runtime injects it as a proxy; current source cannot answer that.
5. After origin remediation, rerun the new explicit-target probe. Then use dedicated test accounts/private mailbox and isolated test bucket credentials to run actual OTP/password login, refresh/logout, dashboard/onboarding and signed storage CRUD.
6. Diagnose the repeated in-memory harness failure as a separate bounded task before rerunning the same failing suites.
7. Resume the broader repository audit from its discovery/baseline checklist. This special investigation is not a complete repository audit and no full function coverage is claimed.

## K. Asset-recovery continuation — 2026-10-26

### K1. Disposition and safety gate

**STOPPED at Stage 1: authorized origin filesystem/log access is not available in the supplied context. Cause remains UNCONFIRMED; release remains BLOCKED.** An HTTP-reachable origin is not equivalent to authorized access to its process, logs, or release files. No approved read-only SSH account/session, origin diagnostic bundle, deployed SHA, deployed BUILD_ID, artifact location, or verified rollback release was supplied. No SSH login or credential discovery was attempted. Historical root-oriented scripts are not authorization to use privileged access.

The 400/body-hash and browser results in sections D–F are prior observations, not fresh network results from this continuation. No unchanged public/browser retries were made after the documented repeated-failure halt. No remote remediation occurred, so there are no post-remediation regression passes to report.

Preserved existing tracked/untracked changes, including restricted environment-file changes shown by Git status. Did not read any environment files or their Git contents. Did not restart services, delete/modify `.next`, install dependencies, build, change auth/providers/deployment configuration, or mutate data. This continuation edits only the existing findings and investigation-plan documents. Do not remove the pre-existing probe or delete these documents as a rollback of this continuation; undo only the continuation's document edits if needed.

### K2. Read-only source and runtime evidence actually obtained

| Check | Actual result | Meaning / boundary |
| --- | --- | --- |
| `git status --short --untracked-files=normal` | Completed; extensive pre-existing tracked/untracked changes, including both planning files and the connectivity probe | Baseline recorded; nothing reset/stashed/checked out. Combined discovery command exited 1 because optional command discovery included absent tools; Git status itself printed successfully. |
| `git rev-parse HEAD` | `fb70126a1bcfbd4b8da7a68b04d9727595b0ba28` | Local HEAD only, not a deployed SHA or a complete description of the dirty working tree. |
| Root/app package scripts and `turbo.json` | Root build `turbo build`; app build `next build`; app start `next start`; app dev `next dev -p 3000`; root package manager `bun@1.1.26` | Documented README Bun minimum is 1.3, inconsistent with the pin. No install/build performed. Turbo references `.env` as an input; those files were not opened. |
| App Next config | Sentry wrapper; tunnel `/monitoring`; TypeScript and ESLint build checks skipped; no explicit `distDir`, `assetPrefix`, `basePath`, custom rewrites, or custom static handler in the inspected config | Source only; Sentry-generated routing and the actual deployed config still need verification. `/monitoring` is not either failing asset path. |
| App middleware | First matcher excludes `_next/static`; second excludes `_next`/dotted paths; remaining entries are `/` and API/TRPC routes | Current source does not intentionally route these JS URLs through authentication/i18n. Deployed compiled matchers and any origin proxy still unverified. |
| Locale layout and Convex provider | Locale layout uses the client provider; provider uses `env.NEXT_PUBLIC_CONVEX_URL` | Explains dependency on layout JS; does not identify why static serving fails. No provider change justified. |
| Deployment scripts inspected, not executed | `05-build-apps.sh`, `06-systemd.sh`, `09-run-app.sh`, `30-cf-tunnel.sh`, `37-frontend.sh`, `38-catchall.sh` | Candidate historical app directory `/opt/myos/apps/app`, service `myos-app.service`, port 3000; scripts include both Bun and Node launch variants and historical host references. These are NOT proof of the affected origin's current unit, working directory, or runtime. |
| Installed router source inspection | Next 14.2.7; Node v24.13.0 locally | Exact deployed package/runtime versions unknown. See K3 for source-level error mapping. |
| Local listener and artifact inventory | Port 3000 listening, PID 7820; local `.next/BUILD_ID` and `routes-manifest.json` absent; `build-manifest.json` and `app-build-manifest.json` readable, both with zero literal matches for the two decoded requested asset paths; both local files return `ENOENT` on read-access checks | **LOCAL ONLY.** Compatible with an active dev artifact directory; not a production-build validation and not evidence the remote assets are missing. Manifest mtimes `2026-10-26T05:09:35.325Z` / `...327Z`; inventory taken around `05:10:34Z`, not an atomic filesystem snapshot. |
| Available dependencies | Root `node_modules` and `e2e/node_modules` exist; app-local `node_modules` absent | Directory presence is not proof a production build can complete. |
| `node --check e2e/investigate-connectivity.cjs` | PASS, exit 0 | Syntax only; no browser requests or application health assertions executed. |
| `Get-Command ... coderabbit` | CodeRabbit CLI not found | In-agent review below instead of claiming a CLI review. |

**Deployment documentation warning:** `deploy/RELEASE_CHECKLIST.md:109–131` asserts stale/mixed `.next` as the cause without the missing origin evidence, then deletes the active build before building. That sequence does not retain the last good artifact and cannot substantiate its stated rollback/fail-safe guarantee. Its claim that builds fail on typecheck/lint errors also contradicts the current skip flags. Do not execute that recovery recipe for this incident. The document was not modified; these are review findings, not proof that its commands were executed on the affected origin. Scripts that build into the service directory before restarting show a possible hazard, not a proven incident timeline.

### K3. What HTTP 400 does and does not distinguish

In the locally installed Next 14.2.7 implementation:
- `node_modules/next/dist/server/lib/router-utils/filesystem.js:146–180` reads BUILD_ID and inventories `.next/static` during production filesystem setup. Lines 426–440 support encoded and decoded paths; `%5Blocale%5D` alone is not evidence of an invalid URL. The failing `main-app` path has no encoded locale component, so a locale-bracket-only explanation is insufficient to explain both failures without additional evidence.
- `node_modules/next/dist/compiled/send/index.js`, `onStatError`, maps `ENOENT`/`ENOTDIR`/`ENAMETOOLONG` to 404 and other stat failures to 500. Its path decoder can emit 400 for malformed encoding or a NUL. No evidence shows either requested URL contains those invalid inputs.
- `node_modules/next/dist/server/lib/router-server.js:298–342` calls `serveStatic`; its allowed error-status set is `{500, 404, 403, 400, 412, 416}`. Other/undefined error statuses are normalized to 400. Separately, a `DecodeError` becomes 400 at lines 379–381.
- `node_modules/next/dist/server/serve-static.js:40–47` rejects directory access with an error whose code is `ENOENT` but which has no HTTP status; that can reach the normalization path above. This is one example, NOT an observed origin error.
- The caught static-serving branch renders the error without necessarily logging the original exception. Absence of a useful log entry would not prove files/requests are valid; read-only file/open checks and request correlation remain necessary. No runtime instrumentation was added.

| Possibility | Evidence needed to distinguish it | Current conclusion |
| --- | --- | --- |
| Missing file | Exact process artifact path, matching manifest entry, stat/open result and sanitized errno | Not checked at origin. A 400 alone is not the ordinary missing-file 404 path and proves neither presence nor absence. |
| Mixed/inconsistent build | Deployed manifests/HTML disagree; artifact hashes/mtime/inventory versus process start and release history; startup inventory no longer matches disk | Plausible but unconfirmed. Historical scripts/checklist do not prove this happened. |
| Wrong process/build directory | Listener PID/service/container -> runtime, cwd, resolved artifact path, release SHA/BUILD_ID | All origin mappings missing. Local HEAD cannot fill this gap. |
| File type/access problem | lstat/stat/realpath, parent traversal permissions, actual read/open as service identity, filesystem error | No origin access evidence; do not propose blanket chmod or privileged execution. |
| Invalid request/path/proxy handling | Raw asset pathname as received at each hop, redacted Host/routing context, encoded-vs-literal-bracket comparison, correlated error code | Valid-looking requested paths plus equal response bodies do not locate the rejection layer within the origin stack. |
| Other origin runtime/proxy issue | Sanitized logs, active routing metadata, deployed Next/runtime versions and artifact checks | Still open. Equal direct/tunnel bodies rule out Cloudflare as sole cause, not every origin proxy/runtime possibility. |

### K4. Exact sanitized evidence required from an authorized operator

Provide one correlated diagnostic bundle from the **affected origin/release**, with UTC collection time. No secrets, full environments, `.env` contents (including via Git), cookies, Authorization headers, OTPs, email payloads, account records, or unrestricted raw logs. Operator should redact privately before sharing. No restart/rebuild/deploy is required to collect this bundle.

1. **Process and artifact identity:** identify the process actually accepting frontend port 3000 (or the verified current port), service/container name, PID, service user, start time, Node/Bun and Next versions, sanitized executable/start arguments, cwd, configured `distDir`, resolved artifact directory, and any release symlink or container image digest/mount. Confirm whether traffic passes another origin proxy. For the historical candidate service, a limited property query such as `systemctl show myos-app.service -p MainPID -p User -p WorkingDirectory -p ExecStart -p ActiveEnterTimestamp` is useful only after confirming the unit is correct and redacting argument secrets; do NOT include its Environment properties or read `/proc/<pid>/environ`.
2. **Release/build metadata:** full deployed source SHA from release/CI provenance, artifact digest, `.next/BUILD_ID`, build completion time and exact build command, lockfile checksum and dependency/runtime versions. State whether source was dirty at build time and whether any build/cleanup/copy happened after process start. A current checkout SHA alone does not prove the build's SHA. Supply the last verified working release's SHA, BUILD_ID, immutable artifact location/digest and smoke-test evidence separately. Mark unknown fields unknown rather than guessing.
3. **Manifest-to-request mapping:** from that resolved artifact directory, supply the relevant entries (or sanitized files) from `build-manifest.json`, `app-build-manifest.json`, and the login route's `server/app/.../page_client-reference-manifest.js` if needed to account for layout references. Include sanitized active `routes-manifest.json` routing fields and `server/middleware-manifest.json` matchers. For each of the two URLs, report which manifest/key references it or explicitly report no match; decode the URL once for on-disk comparison. Do not dump `required-server-files.json` wholesale because serialized configuration can contain sensitive values; supply only selected nonsecret path/routing fields if needed.
4. **Exact file inventory/readability:** for `static/chunks/main-app-08bc60ea86904a0c.js` and `static/chunks/app/[locale]/layout-8db8f8d50c5fa55a.js` under the verified dist directory, report existence, real path, regular-file/directory/symlink type, size, SHA-256, mtime, owner/group, mode and applicable ACL/parent traversal permissions. Test opening/reading as the existing service identity using already-authorized access; report errno on failure. Do not elevate privileges or change permissions to collect this. Also report manifest-referenced alternative main-app/layout filenames and whether those exist/read successfully. Inventory a readable neighboring JS asset as a control; use literal-path-safe handling for `[locale]`.
5. **Correlated origin/proxy logs:** provide a small sanitized window (e.g. at most 200 relevant lines in the two minutes surrounding one authorized diagnostic GET per failing asset) from the verified frontend unit/container and any origin proxy. Include UTC timestamp/request correlation, method and exact asset pathname, status, original error class/message/code/errno/syscall and filesystem path/stack where available. Exclude full request headers/bodies. If the runtime does not log these errors, state that explicitly; do not enable debug/instrumentation or restart without approval.
6. **HTTP-to-build comparison:** at the same collection time, report public URL/origin mapping and sanitized same-release `/login` script-src paths, then each failing asset's status, Content-Type, byte count, body SHA-256, relevant cache headers and request correlation ID via public tunnel, direct origin and (if authorized) origin loopback. No cookies/query secrets. Use plain GET without Range/conditional headers; record the request Host/proxy hop used. A bounded encoded-vs-literal `[locale]` check and one known-good manifest JS control can distinguish path handling without traversal/fuzzing. Do not share raw HTML/error bodies. If no newly authorized request is made, clearly identify the logs as historical instead.

**Stop condition:** until this bundle or explicitly authorized nonprivileged read-only origin access is provided, exact deployed-manifest comparison, origin error attribution, and root-cause confirmation are blocked. No SSH host/user guessing or further deployment action is warranted.

### K5. Stages 2 and 3 — deferred validation and conditional remediation only

**Stage 2 NOT RUN.** The user explicitly requires stopping when origin access is unavailable; this takes precedence over building unrelated local source now. No isolated worktree, build, generated manifest comparison, or smoke-test server was created. Thus there is no build failure or successful build to report, and no evidence to classify this as a build-time rather than deployment/runtime defect.

After the access gate is satisfied, validate in a separate path with reviewed source provenance, preserving dirty/untracked source as applicable and excluding restricted environment files and active `.next`. A clean worktree at local HEAD would omit current uncommitted changes and is not an equivalent build. Use reviewed documented scripts and available dependencies without invoking deployment/backend tasks or Sentry upload side effects. Approved nonsecret isolated build inputs may be needed; do not copy restricted deployment secrets. Record command, cwd, runtime, exit code and sanitized output. Check both incident filenames against generated manifests, but **different content hashes in a fresh build are not themselves a failure**: verify the build's own manifest-referenced JS files exist and are readable. Smoke-test that isolated artifact on loopback with a bounded foreground lifecycle or owned-process cleanup; never overwrite/serve from active `.next` or replace deployed artifacts.

**No cause-specific fix is justified yet.** Select the smallest fix only after K4 distinguishes the cause:
- Confirmed incomplete/mixed release: prepare and validate a complete immutable frontend release in isolation, then propose an authorized atomic release switch, retaining the old artifact and any old hashed chunks needed by open clients. Do not delete the active directory or rebuild it in place.
- Confirmed wrong cwd/artifact selection: propose correcting only the frontend process's release selection to the verified artifact, with explicit approval before service/config changes.
- Confirmed access/type or path/proxy defect: propose the narrow per-file/parent or exact-path handling correction indicated by the error and inventory; preserve the prior ACL/config and prove the same bytes serve correctly. No blanket permission changes or speculative rewrite/auth bypass.

**Rollback prerequisite, not an executed plan:** an authorized operator must first identify and verify a retained last-working frontend release (artifact digest, BUILD_ID/SHA, readability, launch inputs and smoke result), plus the current release pointer/process configuration. For any approved release switch, define the reverse switch and necessary frontend-only process action, its owner, and trigger (asset/MIME failure, hydration/tab failure, or new frontend errors). Preserve both releases and required old assets; validate the rollback target on an isolated port first. For narrow ACL/routing fixes, save the exact prior state and define its restoration before approval. This investigation has neither a verified rollback artifact nor authorization for a switch, so **do not deploy**. No backend rollback, database mutation, credential/session change, or Resend/Ollastack modification is part of static-asset recovery.

### K6. Regression status and in-agent review

| Gate | Continuation result / required completion evidence |
| --- | --- |
| Required assets return success + JavaScript MIME | NOT RERUN / BLOCKED pending authorized remediation. Require actual GET 200 (not redirect/HTML) for both exact paths, JavaScript Content-Type and bytes matching the approved artifact. If a replacement release uses different names, test those additionally; do not silently count old paths returning 404 as meeting this requirement. |
| Login hydration, Admin then User transitions, no new frontend errors | NOT RERUN / BLOCKED. Prior public probe failed; syntax check alone is not a regression pass. |
| Probe adequacy | Current probe asserts encountered script statuses and zero page errors but accepts 3xx, does not assert exact incident paths or JavaScript MIME, and does not capture console error events. Supplement with explicit asset checks and sanitized console-error classification after remediation; no probe modification in this read-only stage. |
| OTP delivery and verification; session creation/renewal | NOT RUN / BLOCKED; separately require an authorized isolated account/private mailbox, provider delivery evidence and actual verified session, never log-scraped OTPs. |
| Authenticated dashboard and storage operations | NOT RUN / BLOCKED; require dedicated isolated test resources/credentials, scoped object/bucket operations and authorized cleanup. No shared data used. |

CodeRabbit CLI unavailable; in-agent continuation review:

| Area | Disposition |
| --- | --- |
| Security | No restricted configuration content, SSH credentials, environments, OTPs, cookies or user data accessed; operator evidence explicitly sanitized. |
| Logic | Identical response bodies retained as reproduction evidence only; local dev inventory and historical deployment candidates are not mislabeled deployed evidence. Missing-file, decode, permission and stale-inventory explanations remain distinguished hypotheses. |
| Isolation / performance | Only bounded local reads and one syntax check; no builds, network retries, new server, active artifact writes or service/data changes. |
| Rollback | Unsafe checklist recipe flagged but not executed/edited; no rollout allowed without a verified retained rollback release. |
| Coverage | No fresh browser/build/auth/storage regression passes claimed. Stop at missing origin prerequisite rather than guessing a fix. |
