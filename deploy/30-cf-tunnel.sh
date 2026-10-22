#!/usr/bin/env bash
# Phase 1: Cloudflare quick tunnels for real trusted HTTPS (app + Convex API).
set -uo pipefail

if [ ! -x /usr/local/bin/cloudflared ]; then
  echo "=== install cloudflared ==="
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
fi
/usr/local/bin/cloudflared --version

mk() {
  local name="$1" port="$2"
  cat > /etc/systemd/system/$name.service <<EOF
[Unit]
Description=cloudflared quick tunnel ($name -> :$port)
After=network.target
[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:$port
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
}
mk cf-app 3000
mk cf-cvx 3210
systemctl daemon-reload
systemctl enable cf-app cf-cvx >/dev/null 2>&1
systemctl restart cf-app cf-cvx
echo "waiting for tunnel URLs..."
sleep 12
APP=$(journalctl -u cf-app --no-pager -n 60 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
CVX=$(journalctl -u cf-cvx --no-pager -n 60 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
echo "APP_URL=$APP"
echo "CVX_URL=$CVX"
# persist for later scripts
printf 'APP_URL=%s\nCVX_URL=%s\n' "$APP" "$CVX" > /opt/myos/.tunnel-urls
echo "cf-app=$(systemctl is-active cf-app) cf-cvx=$(systemctl is-active cf-cvx)"
echo CF_TUNNEL_DONE
