#!/usr/bin/env bash
# Deploy audit-log wiring + member management; verify audit rows are written.
set -uo pipefail
NODE=/usr/bin/node; CVX=/opt/myos/node_modules/convex/bin/main.js
for f in auditLog audit jobs orgs apiKeys files; do
  cp "/tmp/$f.ts" "/opt/myos/packages/backend/convex/$f.ts"
done
cd /opt/myos/packages/backend
echo "=== deploy ==="
"$NODE" "$CVX" deploy -y 2>&1 | tail -3
echo "=== exercise audited actions ==="
A=$("$NODE" "$CVX" run jobs:firstUserId 2>&1 | tail -1 | tr -d '"[:space:]')
WS=$("$NODE" "$CVX" run orgs:createWorkspaceForUser "{\"userId\":\"$A\",\"name\":\"AuditTest\"}" 2>&1 | tail -1 | tr -d '"[:space:]')
"$NODE" "$CVX" run apiKeys:createForUser "{\"workspaceId\":\"$WS\",\"userId\":\"$A\",\"name\":\"auditkey\"}" >/dev/null 2>&1
sleep 1
echo "=== auditLogs for this workspace (expect workspace.create + apikey.create) ==="
"$NODE" "$CVX" data auditLogs 2>&1 | grep "$WS"
echo AUDIT_DONE
