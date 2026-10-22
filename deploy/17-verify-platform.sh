#!/usr/bin/env bash
# Verify all Phase 2 platform modules end-to-end on the VM.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend
USERID="$("$NODE" "$CVX" run jobs:firstUserId 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "userId: $USERID"

echo "=== usage.record + audit.record (direct) ==="
"$NODE" "$CVX" run usage:record "{\"userId\":\"$USERID\",\"metric\":\"verify.metric\",\"by\":3}" 2>&1 | tail -1
"$NODE" "$CVX" run audit:record "{\"userId\":\"$USERID\",\"action\":\"verify.audit\",\"meta\":{\"x\":1}}" 2>&1 | tail -1

echo "=== orgs: create workspace (owner membership) ==="
WS="$("$NODE" "$CVX" run orgs:createWorkspaceForUser "{\"userId\":\"$USERID\",\"name\":\"Acme\"}" 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "workspaceId: $WS"

echo "=== apiKeys: create + verify via HTTP /api/verify-key ==="
KEY="$("$NODE" "$CVX" run apiKeys:createForUser "{\"userId\":\"$USERID\",\"name\":\"verify-key\"}" 2>&1 | grep -oE 'sk_[0-9a-f]+' | head -1)"
echo "issued key: ${KEY:0:14}…"
echo -n "verify-key response: "
curl -s -X POST http://127.0.0.1:3211/api/verify-key -H "x-api-key: $KEY"; echo
echo -n "bad-key response:    "
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3211/api/verify-key -H "x-api-key: sk_bogus"

echo "=== jobs.create wiring -> usage + audit ==="
"$NODE" "$CVX" run jobs:createInternal "{\"userId\":\"$USERID\",\"kind\":\"demo\",\"input\":{}}" 2>&1 | tail -1
sleep 1
echo "-- usage --";      "$NODE" "$CVX" data usage      2>&1 | tail -4
echo "-- auditLogs --";  "$NODE" "$CVX" data auditLogs  2>&1 | tail -4
echo "-- workspaces --"; "$NODE" "$CVX" data workspaces 2>&1 | tail -3
echo "-- members --";    "$NODE" "$CVX" data members    2>&1 | tail -3
echo "VERIFY_PLATFORM_DONE"
