#!/usr/bin/env bash
# Frontend: member-management UI + error boundary + 404.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next
cp /tmp/platform_page.tsx "/opt/myos/apps/app/src/app/[locale]/(dashboard)/platform/page.tsx"
cp /tmp/error.tsx     "/opt/myos/apps/app/src/app/[locale]/error.tsx"
cp /tmp/not-found.tsx "/opt/myos/apps/app/src/app/[locale]/not-found.tsx"
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build 2>&1 | tail -8
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo FRONTEND_DONE
