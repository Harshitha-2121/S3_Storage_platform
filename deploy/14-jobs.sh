#!/usr/bin/env bash
# Deploy the Jobs module: place files, redeploy Convex, restart echo backend, rebuild dashboard.
set -euo pipefail
NODE=/usr/bin/node
NEXT=/opt/myos/node_modules/next/dist/bin/next
CVX=/opt/myos/node_modules/convex/bin/main.js

echo "=== place files ==="
cp /tmp/jobs.ts    /opt/myos/packages/backend/convex/jobs.ts
cp /tmp/schema.ts  /opt/myos/packages/backend/convex/schema.ts
cp /tmp/http.ts    /opt/myos/packages/backend/convex/http.ts
cp /tmp/server.mjs /opt/myos/backend-echo/server.mjs
mkdir -p "/opt/myos/apps/app/src/app/[locale]/(dashboard)/jobs"
cp /tmp/jobs_page.tsx  "/opt/myos/apps/app/src/app/[locale]/(dashboard)/jobs/page.tsx"
cp /tmp/navigation.tsx "/opt/myos/apps/app/src/app/[locale]/(dashboard)/_components/navigation.tsx"
echo ok

echo "=== redeploy Convex (Node) ==="
cd /opt/myos/packages/backend
"$NODE" "$CVX" deploy -y

echo "=== restart echo backend ==="
systemctl restart myos-echo.service
sleep 2
echo "echo: $(systemctl is-active myos-echo.service)"

echo "=== rebuild dashboard (Node) ==="
cd /opt/myos/apps/app
"$NODE" "$NEXT" build

echo "=== restart dashboard ==="
systemctl restart myos-app.service
sleep 6
echo "app: $(systemctl is-active myos-app.service)"
curl -fsSL -o /dev/null -w "/en/jobs -> %{http_code}\n" http://127.0.0.1:3000/en/jobs || echo "/en/jobs (auth redirect expected)"
echo "JOBS_DEPLOY_DONE"
