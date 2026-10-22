#!/usr/bin/env bash
# Increment 1: left sidebar shell + workspace context + responsive layout.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next
cp /tmp/workspace-provider.tsx /opt/myos/apps/app/src/lib/workspace-provider.tsx
cp /tmp/useWorkspace.ts        /opt/myos/apps/app/src/lib/useWorkspace.ts
cp /tmp/sidebar.tsx   "/opt/myos/apps/app/src/app/[locale]/(dashboard)/_components/sidebar.tsx"
cp /tmp/layout.tsx    "/opt/myos/apps/app/src/app/[locale]/(dashboard)/layout.tsx"
echo "files placed"
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build 2>&1 | tail -8
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo SIDEBAR_DONE
