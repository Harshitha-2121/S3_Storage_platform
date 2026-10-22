#!/usr/bin/env bash
# Verify workspace-scoped multi-tenancy end-to-end.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend
USERID="$("$NODE" "$CVX" run jobs:firstUserId 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "userId: $USERID"
WS="$("$NODE" "$CVX" run orgs:createWorkspaceForUser "{\"userId\":\"$USERID\",\"name\":\"Tenant-A\"}" 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "workspaceId: $WS"

echo "=== job in workspace (create -> done) ==="
"$NODE" "$CVX" run jobs:createInternal "{\"workspaceId\":\"$WS\",\"userId\":\"$USERID\",\"kind\":\"demo\",\"input\":{\"p\":1}}" 2>&1 | tail -1
sleep 2
echo "-- jobs (latest) --";      "$NODE" "$CVX" data jobs       2>&1 | tail -2
echo "-- usage (latest) --";     "$NODE" "$CVX" data usage      2>&1 | tail -2
echo "-- auditLogs (latest) --"; "$NODE" "$CVX" data auditLogs  2>&1 | tail -2

echo "=== api key in workspace + /api/verify-key returns workspaceId ==="
KEY="$("$NODE" "$CVX" run apiKeys:createForUser "{\"workspaceId\":\"$WS\",\"userId\":\"$USERID\",\"name\":\"mt-key\"}" 2>&1 | grep -oE 'sk_[0-9a-f]+' | head -1)"
echo -n "verify-key: "
curl -s -X POST http://127.0.0.1:3211/api/verify-key -H "x-api-key: $KEY"; echo
echo "VERIFY_MT_DONE"
