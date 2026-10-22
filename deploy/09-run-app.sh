#!/usr/bin/env bash
# Build apps/app (the dashboard) under Node and run it as a systemd service on :3000.
set -uo pipefail
NODE=/usr/bin/node
NEXT=/opt/myos/node_modules/next/dist/bin/next
VM_IP=10.1.30.14

echo "=== write apps/app/.env ==="
cat > /opt/myos/apps/app/.env <<EOF
NEXT_PUBLIC_CONVEX_URL=http://${VM_IP}:3210
NEXT_PUBLIC_OPENPANEL_CLIENT_ID=
OPENPANEL_SECRET_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
EOF

echo "=== build apps/app (Node) ==="
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build
set +e

echo "=== systemd unit (Next under Node) ==="
cat > /etc/systemd/system/myos-app.service <<'UNIT'
[Unit]
Description=myos dashboard (Next.js apps/app)
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/opt/myos/apps/app
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/bin/node /opt/myos/node_modules/next/dist/bin/next start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now myos-app.service
sleep 7
echo "=== status ==="
systemctl --no-pager --full status myos-app.service | head -14
echo "=== curl checks ==="
curl -fsSL -o /dev/null -w "/ -> %{http_code}\n" http://127.0.0.1:3000/ || echo "/ failed"
curl -fsSL -o /dev/null -w "/en/login -> %{http_code}\n" http://127.0.0.1:3000/en/login || echo "/en/login failed"
echo "RUN_APP_DONE"
