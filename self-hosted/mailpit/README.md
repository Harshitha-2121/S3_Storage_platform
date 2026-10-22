# Local email inbox (Mailpit)

Catches all auth emails (verification / reset / OTP) in a local SMTP inbox with a web UI —
no external email provider needed for dev/self-hosted.

## Run
```bash
docker run -d --name mailpit --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 axllent/mailpit
```
- SMTP: `:1025`  ·  Web UI / API: `:8025` (expose via a tunnel for a remote browser).

## Wire the backend
The auth providers send via `convex/email.ts` (a `"use node"` action using `nodemailer`).
Point it at Mailpit:
```bash
cd packages/backend
convex env set SMTP_HOST <mailpit-host>   # e.g. the VM LAN IP reachable from the backend
convex env set SMTP_PORT 1025
convex env set SMTP_FROM auth@myos.local
```
Trigger a signup/reset/OTP — the message appears in the Mailpit UI. The code is also written
to the Convex logs as a fallback, so unsetting `SMTP_HOST` cleanly reverts to log-mode.

For **real** outbound mail, set `SMTP_*` (and `SMTP_USER`/`SMTP_PASS`) to any provider's SMTP
(Resend, SES, etc.) — no code change.
