#!/usr/bin/env bash
set -uo pipefail
N=/usr/bin/node; C=/opt/myos/node_modules/convex/bin/main.js
cp /tmp/seed.ts /opt/myos/packages/backend/convex/seed.ts
cd /opt/myos/packages/backend
"$N" "$C" deploy -y 2>&1 | tail -1
echo "purging seed rows..."
for i in $(seq 1 12); do
  D=$("$N" "$C" run seed:seedCleanupBatch 2>/dev/null | tail -1 | tr -d '"[:space:] ')
  echo "batch $i deleted: $D"
  [ "$D" = "0" ] && break
done
A=$("$N" "$C" run jobs:firstUserId 2>/dev/null | tail -1 | tr -d '"[:space:]')
echo -n "admin unread now: "; "$N" "$C" run seed:profileUnreadOld "{\"userId\":\"$A\"}" 2>/dev/null | grep rowsRead
echo CLEANUP_DONE
