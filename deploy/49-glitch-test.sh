#!/usr/bin/env bash
set -uo pipefail
DSN='https://608c0e3c89a04c8283670450b88d7e00@approx-fountain-accepts-forget.trycloudflare.com/1'
cd /opt/myos/apps/app
cat > _gtest.mjs <<'JS'
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.DSN, tracesSampleRate: 0 });
Sentry.captureException(new Error("glitchtip wiring test " + Date.now()));
await Sentry.close(6000);
console.log("flushed");
JS
DSN="$DSN" /usr/bin/node _gtest.mjs 2>&1 | tail -3
rm -f _gtest.mjs
echo "waiting for worker ingest..."; sleep 12
cd /opt/myos/glitchtip
docker compose exec -T web ./manage.py shell -c "from apps.issue_events.models import IssueEvent; print('GLITCHTIP_EVENTS=', IssueEvent.objects.count())" 2>&1 | grep GLITCHTIP_EVENTS
echo GLITCH_TEST_DONE
