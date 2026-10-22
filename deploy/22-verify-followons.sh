#!/usr/bin/env bash
# Verify follow-ons: invite accept (2 users -> membership), events scoped, files table.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend

A="$("$NODE" "$CVX" run jobs:firstUserId 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "userA: $A"
WS="$("$NODE" "$CVX" run orgs:createWorkspaceForUser "{\"userId\":\"$A\",\"name\":\"Team-FollowOns\"}" 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "workspace: $WS"

echo "=== invites: create userB, invite, accept ==="
printf '%s\n' '{"email":"userb@myos.test","name":"User B"}' > /tmp/userb.jsonl
"$NODE" "$CVX" import --table users --append /tmp/userb.jsonl -y >/dev/null 2>&1 || true
B="$("$NODE" "$CVX" data users 2>&1 | grep userb@myos.test | head -1 | sed -E 's/^[[:space:]]*"([^"]+)".*/\1/')"
echo "userB: $B"
INV="$("$NODE" "$CVX" run orgs:inviteForUser "{\"workspaceId\":\"$WS\",\"invitedBy\":\"$A\",\"email\":\"userb@myos.test\",\"role\":\"member\"}" 2>&1 | tail -1 | tr -d '"[:space:]')"
echo "invite: $INV"
"$NODE" "$CVX" run orgs:acceptInviteForUser "{\"inviteId\":\"$INV\",\"userId\":\"$B\"}" 2>&1 | tail -1
echo "-- members of workspace (expect owner A + member B) --"
"$NODE" "$CVX" data members 2>&1 | grep "$WS"

echo "=== events scoped to workspace ==="
curl -s -X POST http://127.0.0.1:4000/emit-webhook -H "content-type: application/json" -d "{\"workspaceId\":\"$WS\",\"note\":\"scoped\"}" >/dev/null
sleep 1
echo "-- events carrying workspace --"
"$NODE" "$CVX" data events 2>&1 | grep "$WS" | head -2

echo "=== files table present ==="
"$NODE" "$CVX" data files 2>&1 | tail -1
echo "VERIFY_FOLLOWONS_DONE"
