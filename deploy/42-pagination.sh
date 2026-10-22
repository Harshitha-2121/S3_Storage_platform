#!/usr/bin/env bash
# Pagination/load-more on jobs + files.
set -uo pipefail
NODE=/usr/bin/node; NEXT=/opt/myos/node_modules/next/dist/bin/next; CVX=/opt/myos/node_modules/convex/bin/main.js
cp /tmp/jobs.ts  /opt/myos/packages/backend/convex/jobs.ts
cp /tmp/files.ts /opt/myos/packages/backend/convex/files.ts
cp /tmp/jobs_page.tsx  "/opt/myos/apps/app/src/app/[locale]/(dashboard)/jobs/page.tsx"
cp /tmp/files_page.tsx "/opt/myos/apps/app/src/app/[locale]/(dashboard)/files/page.tsx"
cd /opt/myos/packages/backend
set -e
"$NODE" "$CVX" deploy -y 2>&1 | tail -2
cd /opt/myos/apps/app
"$NODE" "$NEXT" build 2>&1 | tail -4
set +e
systemctl restart myos-app; sleep 6
echo "app=$(systemctl is-active myos-app)"
echo PAGINATION_DONE
