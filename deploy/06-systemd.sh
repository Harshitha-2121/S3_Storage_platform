#!/usr/bin/env bash
# Run both Next apps as systemd services (auto-restart, start on boot).
# app -> :3000, web -> :3001, bound to 0.0.0.0.
set -euo pipefail
BUN=/root/.bun/bin/bun

cat > /etc/systemd/system/myos-app.service <<EOF
[Unit]
Description=myos app (Next.js, apps/app)
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/opt/myos/apps/app
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=${BUN} run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/myos-web.service <<EOF
[Unit]
Description=myos web (Next.js, apps/web)
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/opt/myos/apps/web
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HOSTNAME=0.0.0.0
ExecStart=${BUN} run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now myos-app.service
systemctl enable --now myos-web.service

sleep 7
echo "=== app status ==="; systemctl --no-pager --full status myos-app.service | head -12
echo "=== web status ==="; systemctl --no-pager --full status myos-web.service | head -12
echo "=== local curl checks ==="
curl -fsS -o /dev/null -w "app(3000): %{http_code}\n" http://127.0.0.1:3000 || echo "app(3000) not responding yet"
curl -fsS -o /dev/null -w "web(3001): %{http_code}\n" http://127.0.0.1:3001 || echo "web(3001) not responding yet"
echo "SYSTEMD_DONE"
