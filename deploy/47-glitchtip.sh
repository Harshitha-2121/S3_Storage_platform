#!/usr/bin/env bash
# Self-hosted error monitoring: GlitchTip (Sentry-protocol compatible) + a CF tunnel
# so the remote browser AND the VM can reach it with one public DSN.
set -uo pipefail
SH=/opt/myos/glitchtip
mkdir -p "$SH"; cd "$SH"

echo "=== cloudflared tunnel for :8000 ==="
cat > /etc/systemd/system/cf-glitch.service <<EOF
[Unit]
Description=cloudflared tunnel (glitchtip -> :8000)
After=network.target
[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:8000
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cf-glitch >/dev/null 2>&1
systemctl restart cf-glitch
sleep 12
GURL=$(journalctl -u cf-glitch --no-pager -n 80 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
echo "GLITCHTIP_URL=$GURL"
[ -n "$GURL" ] || { echo "no tunnel url"; exit 1; }

echo "=== write compose + env ==="
SECRET=$(openssl rand -hex 32)
cat > .env <<EOF
SECRET_KEY=$SECRET
GLITCHTIP_DOMAIN=$GURL
EOF

cat > docker-compose.yml <<'YAML'
x-environment: &default-environment
  DATABASE_URL: postgres://postgres:postgres@postgres:5432/postgres
  SECRET_KEY: ${SECRET_KEY}
  PORT: 8080
  EMAIL_URL: consolemail://
  GLITCHTIP_DOMAIN: ${GLITCHTIP_DOMAIN}
  DEFAULT_FROM_EMAIL: noreply@glitchtip.local
  CELERY_WORKER_AUTOSCALE: "1,2"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped
  redis:
    image: redis
    restart: unless-stopped
  web:
    image: glitchtip/glitchtip
    depends_on: [postgres, redis]
    ports:
      - "8000:8080"
    environment: *default-environment
    restart: unless-stopped
  worker:
    image: glitchtip/glitchtip
    command: ./bin/run-celery-with-beat.sh
    depends_on: [postgres, redis]
    environment: *default-environment
    restart: unless-stopped
  migrate:
    image: glitchtip/glitchtip
    depends_on: [postgres, redis]
    command: ./manage.py migrate
    environment: *default-environment
volumes:
  pg-data:
YAML

echo "=== docker compose up ==="
docker compose up -d 2>&1 | tail -6
echo "waiting for glitchtip web (migrations can take ~1m)..."
ok=0
for i in $(seq 1 80); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/ 2>/dev/null || echo 000)
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then ok=1; echo "web up after ${i} (HTTP $code)"; break; fi
  sleep 3
done
docker compose ps
[ "$ok" = "1" ] || { echo "WEB NOT UP"; docker compose logs --tail=30 web; exit 1; }
printf '%s\n' "$GURL" > /opt/myos/glitchtip/url.txt
echo "GLITCHTIP_UP_DONE url=$GURL"
