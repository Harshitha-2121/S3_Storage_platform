#!/usr/bin/env bash
# Phase 1b: point Convex cloud origin + app build at the CF tunnel URLs (real TLS).
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next; CVX=/opt/myos/node_modules/convex/bin/main.js
# shellcheck disable=SC1091
source /opt/myos/.tunnel-urls
echo "APP_URL=$APP_URL"; echo "CVX_URL=$CVX_URL"
[ -n "$APP_URL" ] && [ -n "$CVX_URL" ] || { echo "missing tunnel URLs"; exit 1; }

cat > /opt/myos/self-hosted/.env <<EOF
DISABLE_BEACON=true
PORT=3210
SITE_PROXY_PORT=3211
DASHBOARD_PORT=6791
CONVEX_CLOUD_ORIGIN=$CVX_URL
CONVEX_SITE_ORIGIN=http://10.1.30.14:3211
NEXT_PUBLIC_DEPLOYMENT_URL=$CVX_URL
EOF
( cd /opt/myos/self-hosted && docker compose up -d )
sleep 6

cd /opt/myos/packages/backend
"$NODE" "$CVX" env set -- SITE_URL "$APP_URL" >/dev/null && echo "SITE_URL set"

cat > /opt/myos/apps/app/.env <<EOF
NEXT_PUBLIC_CONVEX_URL=$CVX_URL
NEXT_PUBLIC_BACKEND_URL=http://10.1.30.14:4000
EOF
cd /opt/myos/apps/app
"$NODE" "$NEXT" build 2>&1 | tail -4
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo "=== checks ==="
curl -s -o /dev/null -w "app tunnel /en/login: %{http_code}\n" -L "$APP_URL/en/login"
curl -s -o /dev/null -w "cvx tunnel /version: %{http_code}\n" "$CVX_URL/version"
echo CF_CUTOVER_DONE
