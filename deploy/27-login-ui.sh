#!/usr/bin/env bash
# Place the password login UI (was missed in cutover) and rebuild.
set -euo pipefail
NODE=/usr/bin/node
NEXT=/opt/myos/node_modules/next/dist/bin/next
cp /tmp/password-signin.tsx /opt/myos/apps/app/src/components/password-signin.tsx
cp /tmp/login_page.tsx "/opt/myos/apps/app/src/app/[locale]/(public)/login/page.tsx"
cd /opt/myos/apps/app
"$NODE" "$NEXT" build 2>&1 | tail -6
systemctl restart myos-app
sleep 6
echo "app=$(systemctl is-active myos-app)"
curl -sk -o /dev/null -w "login: %{http_code}\n" -L https://10.1.30.14/en/login
echo LOGIN_UI_DONE
