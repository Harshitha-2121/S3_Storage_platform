#!/usr/bin/env bash
# Cut over to HTTPS: Convex origins -> https, Node trusts Caddy CA, rebuild app with https URL.
set -uo pipefail
NODE=/usr/bin/node
NEXT=/opt/myos/node_modules/next/dist/bin/next
CA=/etc/caddy-root.crt

echo "=== publish caddy root CA ==="
cp /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt "$CA"
chmod 644 "$CA"

echo "=== convex origins -> https (recreate backend) ==="
cat > /opt/myos/self-hosted/.env <<EOF
DISABLE_BEACON=true
PORT=3210
SITE_PROXY_PORT=3211
DASHBOARD_PORT=6791
CONVEX_CLOUD_ORIGIN=https://10.1.30.14:3215
CONVEX_SITE_ORIGIN=https://10.1.30.14:3216
NEXT_PUBLIC_DEPLOYMENT_URL=https://10.1.30.14:3215
EOF
( cd /opt/myos/self-hosted && docker compose up -d --force-recreate )
sleep 6

echo "=== echo backend -> https site url ==="
sed -i 's#^CONVEX_SITE_URL=.*#CONVEX_SITE_URL=https://10.1.30.14:3216#' /opt/myos/backend-echo/.env

echo "=== systemd: NODE_EXTRA_CA_CERTS for app + echo ==="
mkdir -p /etc/systemd/system/myos-app.service.d /etc/systemd/system/myos-echo.service.d
printf '[Service]\nEnvironment=NODE_EXTRA_CA_CERTS=%s\n' "$CA" > /etc/systemd/system/myos-app.service.d/ca.conf
printf '[Service]\nEnvironment=NODE_EXTRA_CA_CERTS=%s\n' "$CA" > /etc/systemd/system/myos-echo.service.d/ca.conf
systemctl daemon-reload

echo "=== rebuild app (https convex url) ==="
cat > /opt/myos/apps/app/.env <<EOF
NEXT_PUBLIC_CONVEX_URL=https://10.1.30.14:3215
NEXT_PUBLIC_BACKEND_URL=http://10.1.30.14:4000
EOF
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build 2>&1 | tail -6
set +e

echo "=== restart services ==="
systemctl restart myos-echo
systemctl restart myos-app
sleep 7
echo "app=$(systemctl is-active myos-app) echo=$(systemctl is-active myos-echo) caddy=$(systemctl is-active caddy)"
echo "=== checks ==="
curl -sk -o /dev/null -w "app https /en/login: %{http_code}\n" -L https://10.1.30.14/en/login
curl -sk -o /dev/null -w "convex 3215 version: %{http_code}\n" https://10.1.30.14:3215/version
echo CUTOVER_DONE
