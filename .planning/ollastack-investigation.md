# Ollastack outage investigation

## Scope and safety
- Prioritize this investigation before authentication or deployment changes.
- Preserve all pre-existing tracked/untracked changes. No reset, deploy, data edits, credential rotation, or provider replacement.
- Never report tokens, OTPs, email addresses, database records, or raw provider responses.
- Environment files are access-restricted by tooling; do not bypass the restriction (including through Git content).
- At most five fix iterations; stop if the same error repeats twice.

## Atomic waves
1. [complete for accessible source/history; restricted config blocked] Searched current text and all seven available revisions. Compared auth source changes without reading restricted env content. No verified known-good SHA supplied.
2. [complete static trace; authenticated runtime blocked] Traced browser -> /api/auth -> Convex providers -> Resend; sessions, dashboard/workspace and onboarding dependencies inspected. No Ollastack runtime call found.
3. [complete available baseline] Public/local Chromium and bounded HTTP checks executed; anonymous Convex/session queries and service health checked; existing isolated OTP, backend and RustFS suites executed. Detailed results in ollastack-findings.md.
4. [reproduced; deployment fix blocked] OLL-001: required JS chunks return 400 both public and direct origin; Admin tab fails publicly. Added read-only regression probe. No auth/provider/deploy modification justified. Actual origin build/log inspection required.
5. [complete available review; essential release checks blocked] App typecheck, new-probe syntax/lint pass. Public regression and backend harness errors repeat twice; retries stopped. Production build deferred to isolated environment to avoid disrupting active .next. Release BLOCKED.

## Initial observations (not an outage root-cause claim)
- Repository has extensive pre-existing changes, including authEmailDelivery.ts and otp.test.ts as untracked files.
- Current auth providers call internal.email.sendEmail, implemented using api.resend.com.
- Available Git -G search finds Ollastack only in .env.example at commit 687174a; this file's content is restricted. No Ollastack references found in the scanned non-environment working-tree text.
- Only port 3000 was observed listening among 3000,3001,3210,3211,3220,9000,9001,8025,1025. Further bounded network checks required.
- No verified last-known-working revision has been supplied; do not label a commit known-good from its date or message.

## Evidence and result log
Full report: `.planning/ollastack-findings.md`.
- Local Chromium: 5 PASS. Public final Chromium: 2 PASS, 2 FAIL, 1 BLOCKED.
- Public/direct-origin required asset failures: HTTP 400; identical 1987-byte error bodies and SHA-256. Underlying origin artifact/runtime cause not yet confirmed.
- Existing OTP tests: 21 PASS. Full backend: 31 PASS / 24 FAIL; narrower diagnostic repeats instanceof harness error; halted further retries.
- RustFS suite: 38 PASS / 6 SKIPPED; client setup FAIL from unavailable local :9000.
- App tsc, new probe Node syntax and Biome lint: PASS.
- Anonymous auth/session/workspace/user queries: expected safe empty results; no live account used.
- Changes: only this plan, findings report and e2e/investigate-connectivity.cjs; no auth/deployment/data change.

## Asset-recovery continuation — 2026-10-26
1. [complete accessible read-only inspection; origin gate BLOCKED] Inspect app/root package scripts, Next config, middleware, locale layout, deployment script candidates, installed Next asset router, and connectivity probe. Record current local-only manifest/file results without treating them as origin evidence.
2. [STOPPED at explicit access gate] No authorized origin diagnostic account, sanitized origin logs, deployed SHA/BUILD_ID, or verified deployed artifact path supplied. Do not guess SSH credentials, use privileged access, or continue unchanged public retries. Required operator evidence is specified in findings section K.
3. [NOT RUN] Isolated build/manifest validation and bounded local smoke test deferred because the user requires stopping when origin access is unavailable. No worktree, build, install, service, or active artifact change made.
4. [proposal only; NOT AUTHORIZED] Select the smallest fix only after origin evidence distinguishes artifact mismatch, missing/unreadable files, request handling, or another runtime cause; require a verified retained-release rollback before any rollout.
5. [BLOCKED] Public asset MIME/status + hydration/Admin/User regression after authorized remediation; OTP/session/dashboard/storage tests are separate gates requiring isolated authorized resources. Existing probe syntax check passed; browser regressions were not rerun in this continuation.

## Resume first incomplete prerequisite
Obtain authorized origin logs/build metadata/deployed SHA plus a verified known-good SHA; identify why the two required chunks return 400 before attempting remediation. Restricted Ollastack config purpose/host/names and dedicated test account/mailbox/storage credentials remain needed. See report section J for ordered next actions.
