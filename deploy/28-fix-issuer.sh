#!/usr/bin/env bash
# Fix: keep browser-facing Convex API on https (3215) but move the auth issuer / site origin
# back to plain-http (3211) so the Convex backend can self-discover OIDC without a self-signed cert.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js

cat > /opt/myos/self-hosted/.env <<EOF
DISABLE_BEACON=true
PORT=3210
SITE_PROXY_PORT=3211
DASHBOARD_PORT=6791
CONVEX_CLOUD_ORIGIN=https://10.1.30.14:3215
CONVEX_SITE_ORIGIN=http://10.1.30.14:3211
NEXT_PUBLIC_DEPLOYMENT_URL=https://10.1.30.14:3215
EOF
( cd /opt/myos/self-hosted && docker compose up -d --force-recreate )
sleep 6

sed -i 's#^CONVEX_SITE_URL=.*#CONVEX_SITE_URL=http://10.1.30.14:3211#' /opt/myos/backend-echo/.env
systemctl restart myos-echo

cd /opt/myos/packages/backend
"$NODE" "$CVX" deploy -y 2>&1 | tail -3
echo "CONVEX_SITE_URL=$("$NODE" "$CVX" env get CONVEX_SITE_URL 2>&1 | tail -1)"
echo FIX_ISSUER_DONE
