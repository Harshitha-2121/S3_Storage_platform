# E2E & adversarial suites

These run against a **live deployed stack** (a real Convex backend + the Next app),
so they are intentionally **not** part of the blocking CI in `.github/workflows/ci.yml`.
The fast, in-process equivalents — including the full tenant-isolation/IDOR matrix —
live in `packages/backend/convex/security.test.ts` and **do** run on every PR.

## What's here
| Suite | Layer | What it proves |
|-------|-------|----------------|
| `p2-idor.js` | adversarial / contract | 23 IDOR/RBAC probes as two real authed tenants against the live backend |
| `p2-auth.js` | functional E2E | signup → email-verification → onboarding → reset → admin regression |
| `p-sidebar.js` | E2E | left nav renders + navigates, workspace switcher |
| `p-feedback.js` | E2E | toasts + confirm dialogs |
| `p-home.js` | E2E | overview stat cards + recent activity |
| `p-notif.js` | E2E | notifications bell + panel |
| `p-cmdk.js` | E2E | command palette (Ctrl/⌘+K) |
| `p-paging.js` | E2E | pagination first-page cap + Load more |
| `p-sessions.js` | E2E | active sessions list + sign-out-others |

Every Playwright suite asserts **zero `console.error`** and captures failed network
responses — that assertion catches the class of bug types/units can't see.

## Running
```bash
cd e2e && bun install        # or npm install
npx playwright install chromium

# point at your deployment (defaults target the current dev VM):
export E2E_BASE_URL="https://<your-app-host>"     # the Next app
export CONVEX_URL="http://<your-convex-host>:3210" # the Convex backend (for p2-idor)

node p2-idor.js              # adversarial isolation
node p2-auth.js              # full auth journey
npm run dashboard            # the dashboard E2E set
```

Notes:
- `p2-idor.js` and `p2-auth.js` complete the **mandatory email-verification** flow by
  reading the code the self-hosted backend streams to its logs — they expect log access
  (dev mode). With Resend configured, swap in a mailbox API instead.
- These are the right thing to wire into a **preview-deploy** CI job (spin up the stack,
  run, tear down) rather than the unit gate.
