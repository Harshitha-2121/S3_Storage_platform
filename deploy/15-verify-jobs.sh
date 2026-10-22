#!/usr/bin/env bash
# Prove the full Jobs loop on the VM: create -> running -> done (via backend webhook).
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend

echo "=== resolve a userId ==="
USERID="$("$NODE" "$CVX" run jobs:firstUserId 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "userId: $USERID"
[ -n "$USERID" ] || { echo "no user found"; exit 1; }

echo "=== create job (internal) ==="
"$NODE" "$CVX" run jobs:createInternal \
  "{\"userId\":\"$USERID\",\"kind\":\"demo\",\"input\":{\"prompt\":\"hello\"}}" 2>&1 | tail -3

echo "=== poll jobs (expect pending/running -> done within ~2-3s) ==="
for i in 1 2 3 4 5; do
  sleep 1
  echo "--- t+${i}s ---"
  "$NODE" "$CVX" data jobs 2>&1 | tail -3
done
echo "VERIFY_JOBS_DONE"
