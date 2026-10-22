#!/usr/bin/env bash
cd /opt/myos/packages/backend
N=/usr/bin/node; C=/opt/myos/node_modules/convex/bin/main.js
A=$("$N" "$C" run jobs:firstUserId 2>/dev/null | tail -1 | tr -d '"[:space:]')
WS=$("$N" "$C" data workspaces 2>/dev/null | grep LoadTest | grep -oE 'kx7[a-z0-9]+' | head -1)
echo "user=$A  ws=$WS"
echo "[dashboard.stats]";  "$N" "$C" run seed:profileStats     "{\"workspaceId\":\"$WS\"}" 2>/dev/null | grep -E 'rowsRead|jobs'
echo "[unreadCount OLD]";  "$N" "$C" run seed:profileUnreadOld  "{\"userId\":\"$A\"}"       2>/dev/null | grep -E 'rowsRead|unread'
echo "[unreadCount NEW]";  "$N" "$C" run seed:profileUnreadNew  "{\"userId\":\"$A\"}"       2>/dev/null | grep -E 'rowsRead'
echo DONE
