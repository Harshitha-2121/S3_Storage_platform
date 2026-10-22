#!/usr/bin/env bash
# In-app notifications: schema + backend + bell. Verify a job completion emits one.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next; CVX=/opt/myos/node_modules/convex/bin/main.js
cp /tmp/schema.ts        /opt/myos/packages/backend/convex/schema.ts
cp /tmp/notifications.ts /opt/myos/packages/backend/convex/notifications.ts
cp /tmp/jobs.ts          /opt/myos/packages/backend/convex/jobs.ts
cp /tmp/orgs.ts          /opt/myos/packages/backend/convex/orgs.ts
cp /tmp/topbar.tsx "/opt/myos/apps/app/src/app/[locale]/(dashboard)/_components/topbar.tsx"
cp /tmp/bell.tsx   "/opt/myos/apps/app/src/app/[locale]/(dashboard)/_components/notifications-bell.tsx"
cd /opt/myos/packages/backend
set -e
"$NODE" "$CVX" deploy -y 2>&1 | tail -2
set +e
echo "=== emit notification via job completion ==="
A=$("$NODE" "$CVX" run jobs:firstUserId 2>&1 | tail -1 | tr -d '"[:space:]')
WS=$("$NODE" "$CVX" run orgs:createWorkspaceForUser "{\"userId\":\"$A\",\"name\":\"NotifTest\"}" 2>&1 | tail -1 | tr -d '"[:space:]')
"$NODE" "$CVX" run jobs:createInternal "{\"workspaceId\":\"$WS\",\"userId\":\"$A\",\"kind\":\"notiftest\"}" >/dev/null 2>&1
sleep 5
echo "=== notifications for $A ==="
"$NODE" "$CVX" data notifications 2>&1 | grep "$A" | head -3
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build 2>&1 | tail -4
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo NOTIF_DONE
