#!/usr/bin/env bash
# Maintained counters for dashboard.stats (O(1)) + backfill existing workspaces.
set -uo pipefail
N=/usr/bin/node; C=/opt/myos/node_modules/convex/bin/main.js
for f in schema counters dashboard jobs files orgs; do
  cp "/tmp/$f.ts" "/opt/myos/packages/backend/convex/$f.ts"
done
cd /opt/myos/packages/backend
echo "=== deploy ==="
"$N" "$C" deploy -y 2>&1 | tail -3
echo "=== backfill counters from existing rows ==="
"$N" "$C" run counters:backfillAll 2>&1 | tail -2
echo "=== counters table (metric/value rows) ==="
"$N" "$C" data counters 2>&1 | head -25
echo COUNTERS_DONE
