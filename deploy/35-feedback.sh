#!/usr/bin/env bash
# Increment 2: toasts + confirm dialogs.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next
cp /tmp/confirm-button.tsx /opt/myos/apps/app/src/components/confirm-button.tsx
cp /tmp/layout.tsx        "/opt/myos/apps/app/src/app/[locale]/(dashboard)/layout.tsx"
cp /tmp/jobs_page.tsx     "/opt/myos/apps/app/src/app/[locale]/(dashboard)/jobs/page.tsx"
cp /tmp/files_page.tsx    "/opt/myos/apps/app/src/app/[locale]/(dashboard)/files/page.tsx"
cp /tmp/platform_page.tsx "/opt/myos/apps/app/src/app/[locale]/(dashboard)/platform/page.tsx"
echo placed
cd /opt/myos/apps/app
set -e
"$NODE" "$NEXT" build 2>&1 | tail -8
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo FEEDBACK_DONE
