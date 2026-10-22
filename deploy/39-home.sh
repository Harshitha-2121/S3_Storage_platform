#!/usr/bin/env bash
# Home overview: stats query + dashboard home rebuild.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next; CVX=/opt/myos/node_modules/convex/bin/main.js
cp /tmp/dashboard.ts /opt/myos/packages/backend/convex/dashboard.ts
cp /tmp/home_page.tsx "/opt/myos/apps/app/src/app/[locale]/(dashboard)/page.tsx"
cd /opt/myos/packages/backend
set -e
"$NODE" "$CVX" deploy -y 2>&1 | tail -2
cd /opt/myos/apps/app
"$NODE" "$NEXT" build 2>&1 | tail -5
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo HOME_DONE
