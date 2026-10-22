#!/usr/bin/env bash
# Daily backup of the self-hosted Convex deployment (snapshot export). Keeps last 7.
set -uo pipefail
mkdir -p /opt/backups
cd /opt/myos/packages/backend
ts=$(date +%Y%m%d-%H%M%S)
/usr/bin/node /opt/myos/node_modules/convex/bin/main.js export --path "/opt/backups/convex-$ts.zip"
ls -1t /opt/backups/convex-*.zip 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "backup written: /opt/backups/convex-$ts.zip"
