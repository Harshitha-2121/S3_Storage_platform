#!/usr/bin/env bash
# Local email inbox: Mailpit (SMTP :1025, web UI :8025) + a CF tunnel for the UI.
set -uo pipefail
docker rm -f mailpit 2>/dev/null || true
docker run -d --name mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 axllent/mailpit 2>&1 | tail -1

cat > /etc/systemd/system/cf-mail.service <<EOF
[Unit]
Description=cloudflared tunnel (mailpit UI -> :8025)
After=network.target
[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:8025
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cf-mail >/dev/null 2>&1
systemctl restart cf-mail
sleep 12
MURL=$(journalctl -u cf-mail --no-pager -n 80 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
echo "MAILPIT_UI=$MURL"
curl -s -o /dev/null -w "mailpit api: %{http_code}\n" http://localhost:8025/api/v1/messages
echo MAILPIT_DONE
