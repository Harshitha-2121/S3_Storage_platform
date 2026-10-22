#!/usr/bin/env bash
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next
mkdir -p "/opt/myos/apps/app/src/app/[locale]/[...rest]"
cp /tmp/catchall_page.tsx "/opt/myos/apps/app/src/app/[locale]/[...rest]/page.tsx"
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build 2>&1 | tail -6
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo CATCHALL_DONE
