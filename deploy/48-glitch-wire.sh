#!/usr/bin/env bash
# Point the app's Sentry SDK at self-hosted GlitchTip + prove an event lands.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next
DSN='https://608c0e3c89a04c8283670450b88d7e00@approx-fountain-accepts-forget.trycloudflare.com/1'

echo "=== set NEXT_PUBLIC_SENTRY_DSN + rebuild app ==="
cd /opt/myos/apps/app
grep -v '^NEXT_PUBLIC_SENTRY_DSN=' .env > .env.tmp 2>/dev/null || true
mv .env.tmp .env 2>/dev/null || true
echo "NEXT_PUBLIC_SENTRY_DSN=$DSN" >> .env
"$NODE" "$NEXT" build 2>&1 | tail -3
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"

echo "=== send a test event via the Sentry SDK ==="
cat > /tmp/gtest.js <<'JS'
const Sentry = require("@sentry/node");
Sentry.init({ dsn: process.env.DSN, tracesSampleRate: 0 });
Sentry.captureException(new Error("glitchtip wiring test " + Date.now()));
Sentry.close(5000).then(() => console.log("flushed")).catch((e) => console.log("flush-err", e.message));
JS
( cd /opt/myos/apps/app && DSN="$DSN" "$NODE" /tmp/gtest.js )
echo "waiting for worker ingest..."; sleep 10

echo "=== verify GlitchTip stored it ==="
cd /opt/myos/glitchtip
docker compose exec -T web ./manage.py shell < /root/verify_glitch.py 2>&1 | grep -iE "count=|ERR"
echo GLITCH_WIRE_DONE
