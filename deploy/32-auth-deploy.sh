#!/usr/bin/env bash
# Deploy full auth (password+verify+reset+google) + rebuild app + restart log capture.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next; CVX=/opt/myos/node_modules/convex/bin/main.js
cp /tmp/auth.ts /opt/myos/packages/backend/convex/auth.ts
cp /tmp/passwordProviders.ts /opt/myos/packages/backend/convex/passwordProviders.ts
cp /tmp/auth-form.tsx /opt/myos/apps/app/src/components/auth-form.tsx
cp /tmp/login_page.tsx "/opt/myos/apps/app/src/app/[locale]/(public)/login/page.tsx"

cd /opt/myos/packages/backend
echo "=== deploy convex ==="
"$NODE" "$CVX" deploy -y 2>&1 | tail -6

echo "=== rebuild app ==="
cd /opt/myos/apps/app
"$NODE" "$NEXT" build 2>&1 | tail -5
systemctl restart myos-app; sleep 6; echo "app=$(systemctl is-active myos-app)"

echo "=== restart log capture (for verify/reset codes) ==="
systemctl stop cvxlogs 2>/dev/null; systemctl reset-failed cvxlogs 2>/dev/null; rm -f /tmp/cvxlogs.txt
systemd-run --unit=cvxlogs --working-directory=/opt/myos/packages/backend /bin/bash -lc "/usr/bin/node /opt/myos/node_modules/convex/bin/main.js logs > /tmp/cvxlogs.txt 2>&1" >/dev/null 2>&1
sleep 3; echo "cvxlogs=$(systemctl is-active cvxlogs)"
echo AUTH_DEPLOY_DONE
