#!/usr/bin/env bash
# Phase 1 deploy: place adapter source, set Convex env, redeploy, run echo backend (:4000).
set -euo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js

echo "=== place source files ==="
cp /tmp/backend.ts  /opt/myos/packages/backend/convex/backend.ts
cp /tmp/schema.ts   /opt/myos/packages/backend/convex/schema.ts
cp /tmp/http.ts     /opt/myos/packages/backend/convex/http.ts
mkdir -p /opt/myos/apps/app/src/lib
cp /tmp/backend.config.ts /opt/myos/apps/app/src/lib/backend.config.ts
cp /tmp/backend-client.ts /opt/myos/apps/app/src/lib/backend-client.ts
mkdir -p /opt/myos/backend-echo
cp /tmp/server.mjs  /opt/myos/backend-echo/server.mjs
echo ok

echo "=== secrets + echo backend env ==="
if [ ! -f /opt/myos/backend-echo/.env ]; then
  SERVICE_KEY="$(openssl rand -hex 24)"
  WEBHOOK_SECRET="$(openssl rand -hex 24)"
  cat > /opt/myos/backend-echo/.env <<EOF
PORT=4000
SERVICE_KEY=${SERVICE_KEY}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
CONVEX_SITE_URL=http://10.1.30.14:3211
CONVEX_AUDIENCE=convex
EOF
fi
set -a; . /opt/myos/backend-echo/.env; set +a

echo "=== set Convex deployment env (adapter) ==="
cd /opt/myos/packages/backend
"$NODE" "$CVX" env set -- BACKEND_BASE_URL "http://10.1.30.14:4000" >/dev/null && echo "BACKEND_BASE_URL set"
"$NODE" "$CVX" env set -- BACKEND_SERVICE_KEY "$SERVICE_KEY" >/dev/null && echo "BACKEND_SERVICE_KEY set"
"$NODE" "$CVX" env set -- BACKEND_WEBHOOK_SECRET "$WEBHOOK_SECRET" >/dev/null && echo "BACKEND_WEBHOOK_SECRET set"

echo "=== deploy Convex (Node) ==="
"$NODE" "$CVX" deploy -y

echo "=== echo backend systemd (:4000, Node) ==="
cat > /etc/systemd/system/myos-echo.service <<'UNIT'
[Unit]
Description=myos echo reference backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/myos/backend-echo
EnvironmentFile=/opt/myos/backend-echo/.env
ExecStart=/usr/bin/node /opt/myos/backend-echo/server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now myos-echo.service
sleep 3
systemctl --no-pager --full status myos-echo.service | head -8
echo "=== echo health (no token -> 401 expected) ==="
curl -s -o /dev/null -w "/whoami(no token) -> %{http_code}\n" http://127.0.0.1:4000/whoami
echo "PHASE1_DEPLOY_DONE"
