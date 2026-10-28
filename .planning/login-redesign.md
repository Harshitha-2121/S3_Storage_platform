# Login redesign: requirements, wave and verification

## Requirements and boundaries
- Match `image.png` and written brief: centered pure-black canvas, charcoal card, subtle border, glossy existing circular logo, segmented user/admin tabs, accessible dark fields and buttons.
- Preserve current Next.js/React/Convex auth action calls, OTP/email behavior, password/reset behavior, route, and server-side authorization without modifications.
- Responsive single card, semantic labels, focus/error/live state, reduced-motion support.
- Existing working tree has extensive unrelated and pre-existing login-page edits: do not reset or overwrite them.

## Wave 1: focused UI change
- Target: `apps/app/src/app/[locale]/(public)/login/page.tsx` only.
- Adjust shared style strings, card/logo/tabs and headings/field spacing. Leave signIn invocations and all backend files unchanged.
- Make tab navigation keyboard-accessible; keep OTP/admin forms isolated while allowing active request to finish safely.
- Verify desktop and mobile rendering, tabs, validation, pending/error states where local tooling allows.

## Verification commands and acceptance
- `node_modules/.bin/tsc.cmd --noEmit -p apps/app/tsconfig.json`
- `node_modules/.bin/biome.cmd check "apps/app/src/app/[locale]/(public)/login/page.tsx"`
- `node_modules/.bin/vitest.cmd run -c packages/backend/vitest.config.ts packages/backend/test/otp.test.ts` (if installed)
- Local Next development server and browser inspection if executable/browser available.
- Confirm diff excludes authentication/API/schema/environment changes, no secrets, no new dependencies, and record blocked checks honestly.
