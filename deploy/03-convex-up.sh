#!/usr/bin/env bash
# Bring up self-hosted Convex (backend + dashboard) on the VM with production origins,
# then generate an admin key and wire it into packages/backend/.env.local.
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"

VM_IP=10.1.30.14
SH_DIR=/opt/myos/self-hosted
mkdir -p "$SH_DIR"
cd "$SH_DIR"

echo "=== fetch docker-compose.yml ==="
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/docker/docker-compose.yml

echo "=== write .env (production origins -> ${VM_IP}) ==="
cat > .env <<EOF
# Self-hosted Convex on test-vm-308. Origins are the VM's LAN address so
# browsers on the network can reach the backend / HTTP actions / dashboard.
DISABLE_BEACON=true
PORT=3210
SITE_PROXY_PORT=3211
DASHBOARD_PORT=6791
CONVEX_CLOUD_ORIGIN=http://${VM_IP}:3210
CONVEX_SITE_ORIGIN=http://${VM_IP}:3211
NEXT_PUBLIC_DEPLOYMENT_URL=http://${VM_IP}:3210
EOF

echo "=== docker compose up -d ==="
docker compose up -d

echo "=== wait for backend health ==="
ok=0
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3210/version >/dev/null 2>&1; then ok=1; echo "backend healthy after ${i} tries"; break; fi
  sleep 2
done
[ "$ok" = "1" ] || { echo "BACKEND DID NOT BECOME HEALTHY"; docker compose logs --tail=40 backend; exit 1; }

echo "=== generate admin key ==="
ADMIN_KEY=$(docker compose exec -T backend ./generate_admin_key.sh 2>/dev/null | tr -d '\r' | grep -F '|' | tail -1 | tr -d '[:space:]')
[ -n "$ADMIN_KEY" ] || { echo "FAILED to capture admin key"; exit 1; }
echo "admin key captured (length ${#ADMIN_KEY})"

echo "=== write /opt/myos/packages/backend/.env.local ==="
cat > /opt/myos/packages/backend/.env.local <<EOF
# Convex CLI -> local self-hosted backend on this VM.
CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
CONVEX_SELF_HOSTED_ADMIN_KEY='${ADMIN_KEY}'
EOF

echo "=== containers ==="
docker compose ps
echo "CONVEX_UP_DONE"
