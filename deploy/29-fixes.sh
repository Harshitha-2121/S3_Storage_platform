#!/usr/bin/env bash
# Apply P7 fixes: reboot survival (BUG-2), invite case + ConvexError (BUG-1/7), backups (BUG-3), onboarding log (BUG-9).
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next; CVX=/opt/myos/node_modules/convex/bin/main.js

echo "=== place fixed files ==="
cp /tmp/orgs.ts /opt/myos/packages/backend/convex/orgs.ts
cp /tmp/onboarding_page.tsx "/opt/myos/apps/app/src/app/[locale]/onboarding/page.tsx"
cp /tmp/docker-compose.override.yml /opt/myos/self-hosted/docker-compose.override.yml
mkdir -p /opt/myos/deploy && cp /tmp/backup.sh /opt/myos/deploy/backup.sh && chmod +x /opt/myos/deploy/backup.sh
echo ok

echo "=== BUG-2: restart policy (apply override) ==="
( cd /opt/myos/self-hosted && docker compose up -d )
docker inspect self-hosted-backend-1 --format "backend restart={{.HostConfig.RestartPolicy.Name}}"
docker inspect self-hosted-dashboard-1 --format "dashboard restart={{.HostConfig.RestartPolicy.Name}}"

echo "=== BUG-1/7: deploy convex (orgs fixes) ==="
cd /opt/myos/packages/backend
"$NODE" "$CVX" deploy -y 2>&1 | tail -3

echo "=== BUG-3: backup cron + run once ==="
( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh'; echo "0 3 * * * /opt/myos/deploy/backup.sh >> /var/log/myos-backup.log 2>&1" ) | crontab -
bash /opt/myos/deploy/backup.sh
ls -la /opt/backups/ 2>/dev/null | tail -2

echo "=== BUG-9: rebuild app ==="
cd /opt/myos/apps/app
"$NODE" "$NEXT" build 2>&1 | tail -4
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo FIXES_DONE
