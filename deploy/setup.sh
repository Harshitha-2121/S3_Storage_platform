#!/usr/bin/env bash
# One-command installer for the dashboard control-plane template.
# Run as root from the repo root on a fresh Ubuntu 24.04 VM:
#     sudo HOST=<vm-ip-or-domain> bash deploy/setup.sh
# If HOST is omitted, the VM's primary IP is auto-detected.
#
# NOTE: Bun is used ONLY for `bun install`. The Convex CLI and Next.js run under
# Node, because Bun's WebSocket client breaks against self-hosted Convex (issue #390).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
HOST="${HOST:-$(hostname -I | awk '{print $1}')}"
echo "==> Installing $(basename "$REPO") for HOST=$HOST"
export DEBIAN_FRONTEND=noninteractive

echo "==> [1/9] toolchain (docker, node, bun, git)"
apt-get update -qq
apt-get install -y -qq ca-certificates curl unzip git openssl >/dev/null
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
[ -x /usr/bin/node ] || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs >/dev/null; }
[ -x "$HOME/.bun/bin/bun" ] || curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
NODE=/usr/bin/node
CVX="$REPO/node_modules/convex/bin/main.js"
NEXT="$REPO/node_modules/next/dist/bin/next"

echo "==> [2/9] bun install"
bun install

echo "==> [3/9] self-hosted Convex (Docker)"
mkdir -p self-hosted
[ -f self-hosted/docker-compose.yml ] || curl -fsSL -o self-hosted/docker-compose.yml \
  https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/docker/docker-compose.yml
cat > self-hosted/.env <<EOF
DISABLE_BEACON=true
PORT=3210
SITE_PROXY_PORT=3211
DASHBOARD_PORT=6791
CONVEX_CLOUD_ORIGIN=http://${HOST}:3210
CONVEX_SITE_ORIGIN=http://${HOST}:3211
NEXT_PUBLIC_DEPLOYMENT_URL=http://${HOST}:3210
EOF
( cd self-hosted && docker compose up -d )
echo "    waiting for backend health..."
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:3210/version >/dev/null 2>&1 && break; sleep 2; done

echo "==> [4/9] admin key -> packages/backend/.env.local"
if ! grep -q CONVEX_SELF_HOSTED_ADMIN_KEY packages/backend/.env.local 2>/dev/null; then
  ADMIN_KEY="$(cd self-hosted && docker compose exec -T backend ./generate_admin_key.sh | tr -d '\r' | grep -F '|' | tail -1 | tr -d '[:space:]')"
  cat > packages/backend/.env.local <<EOF
CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
CONVEX_SELF_HOSTED_ADMIN_KEY='${ADMIN_KEY}'
EOF
fi

cd "$REPO/packages/backend"

echo "==> [5/9] auth keys (JWT_PRIVATE_KEY / JWKS / SITE_URL)"
if ! "$NODE" "$CVX" env list 2>/dev/null | grep -q JWT_PRIVATE_KEY; then
  "$NODE" "$REPO/deploy/generateKeys.mjs"
  "$NODE" "$CVX" env set -- JWKS "$(cat /tmp/jwks)" >/dev/null
  "$NODE" "$CVX" env set -- JWT_PRIVATE_KEY "$(cat /tmp/jwt_private_key)" >/dev/null
  rm -f /tmp/jwt_private_key /tmp/jwks
fi
"$NODE" "$CVX" env set -- SITE_URL "http://${HOST}:3000" >/dev/null

echo "==> [6/9] hybrid adapter secrets + echo backend env"
mkdir -p "$REPO/backend-echo"
if [ ! -f "$REPO/backend-echo/.env" ]; then
  cat > "$REPO/backend-echo/.env" <<EOF
PORT=4000
SERVICE_KEY=$(openssl rand -hex 24)
WEBHOOK_SECRET=$(openssl rand -hex 24)
CONVEX_SITE_URL=http://${HOST}:3211
CONVEX_AUDIENCE=convex
EOF
fi
set -a; . "$REPO/backend-echo/.env"; set +a
"$NODE" "$CVX" env set -- BACKEND_BASE_URL "http://${HOST}:4000" >/dev/null
"$NODE" "$CVX" env set -- BACKEND_SERVICE_KEY "$SERVICE_KEY" >/dev/null
"$NODE" "$CVX" env set -- BACKEND_WEBHOOK_SECRET "$WEBHOOK_SECRET" >/dev/null

echo "==> [7/9] deploy Convex functions"
"$NODE" "$CVX" deploy -y

echo "==> [8/9] build dashboard"
cat > "$REPO/apps/app/.env" <<EOF
NEXT_PUBLIC_CONVEX_URL=http://${HOST}:3210
NEXT_PUBLIC_BACKEND_URL=http://${HOST}:4000
EOF
( cd "$REPO/apps/app" && "$NODE" "$NEXT" build )

echo "==> [9/9] systemd services"
cat > /etc/systemd/system/myos-app.service <<UNIT
[Unit]
Description=dashboard (Next.js)
After=network.target docker.service
[Service]
WorkingDirectory=$REPO/apps/app
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/bin/node $REPO/node_modules/next/dist/bin/next start
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/myos-echo.service <<UNIT
[Unit]
Description=echo reference backend
After=network.target
[Service]
WorkingDirectory=$REPO/backend-echo
EnvironmentFile=$REPO/backend-echo/.env
ExecStart=/usr/bin/node $REPO/backend-echo/server.mjs
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now myos-app.service myos-echo.service

echo
echo "==> DONE for HOST=$HOST"
echo "    Dashboard:        http://${HOST}:3000"
echo "    Convex dashboard: http://${HOST}:6791  (deployment URL http://${HOST}:3210)"
echo "    Admin key:        $(grep CONVEX_SELF_HOSTED_ADMIN_KEY "$REPO/packages/backend/.env.local" | cut -d= -f2-)"
echo "    (Sign-in OTP is logged to the Convex dashboard until RESEND_API_KEY is set.)"
