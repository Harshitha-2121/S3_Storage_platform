#!/usr/bin/env bash
# Sessions (list/revoke/sign-out-others) + DEV_SEED gate for seed/test fns.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next; CVX=/opt/myos/node_modules/convex/bin/main.js
for f in sessions devGuard jobs orgs apiKeys audit; do
  cp "/tmp/$f.ts" "/opt/myos/packages/backend/convex/$f.ts"
done
cp /tmp/sessions-card.tsx /opt/myos/apps/app/src/components/sessions-card.tsx
cp /tmp/settings_page.tsx "/opt/myos/apps/app/src/app/[locale]/(dashboard)/settings/page.tsx"
cd /opt/myos/packages/backend
set -e
"$NODE" "$CVX" deploy -y 2>&1 | tail -2
set +e
echo "=== gate check: dev fn should FAIL while DEV_SEED unset ==="
"$NODE" "$CVX" env remove DEV_SEED >/dev/null 2>&1
"$NODE" "$CVX" run jobs:firstUserId 2>&1 | grep -q "Dev/seed functions are disabled" && echo "GATE_BLOCKS_OK" || echo "GATE_FAILED_TO_BLOCK"
"$NODE" "$CVX" env set DEV_SEED 1 >/dev/null 2>&1
"$NODE" "$CVX" run jobs:firstUserId 2>&1 | tail -1 | grep -q '"' && echo "GATE_REOPENS_OK" || echo "GATE_REOPEN_FAILED"
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build 2>&1 | tail -4
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo SESSIONS_DONE
