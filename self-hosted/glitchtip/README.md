# Self-hosted observability (GlitchTip)

Error monitoring without an external SaaS. GlitchTip speaks the Sentry protocol, so the
app's existing `@sentry/nextjs` wiring (client/server/edge configs + `withSentryConfig`)
reports here with **no code change** — you only set a DSN.

## Deploy
```bash
cd self-hosted/glitchtip
cat > .env <<EOF
SECRET_KEY=$(openssl rand -hex 32)
GLITCHTIP_DOMAIN=https://<public-url-of-this-instance>
EOF
docker compose up -d
```
`GLITCHTIP_DOMAIN` must be the URL the **browser** uses to reach GlitchTip (it's baked into
the DSN). On a LAN, that's `http://<host>:8000`; for a remote browser, expose `:8000` (e.g.
a Cloudflare tunnel) and use that URL. The app's SSR/Convex reach it at the same URL.

## Create a project + DSN
```bash
docker compose exec -T web ./manage.py shell < ../../deploy/bootstrap_glitchtip.py
# prints DSN=https://<public_key>@<GLITCHTIP_DOMAIN>/<project_id>
```
This creates an admin user (`admin@myos.test`), an org (`myos`), and a project (`app`),
then prints the DSN.

## Wire the app
Set in `apps/app/.env` (baked at build; the SDK only sends in `NODE_ENV=production`):
```
NEXT_PUBLIC_SENTRY_DSN=<the DSN above>
# optional: NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
```
Rebuild the app. Errors (and the home-page error boundary / `global-error`) now report to
your GlitchTip. Verified end-to-end on the dev VM (an injected error landed as a stored
`IssueEvent`).

> `deploy/47-glitchtip.sh` does the tunnel + bring-up; `deploy/48-glitch-wire.sh` wires the
> DSN and proves ingestion. `ALLOWED_HOSTS` defaults to wildcard — set it for real prod.
