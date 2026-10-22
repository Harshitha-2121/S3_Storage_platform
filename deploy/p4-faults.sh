#!/usr/bin/env bash
# P4 failure injection: webhook auth, job-error path when backend down, OTP single-use.
set -uo pipefail
N=/usr/bin/node; C=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend

echo "=== [1] webhook rejects bad/missing secret ==="
curl -s -o /dev/null -w "bad-secret -> %{http_code} (expect 401)\n" -X POST http://127.0.0.1:3211/backend/webhook -H "x-webhook-secret: WRONG" -H "content-type: application/json" -d '{}'
curl -s -o /dev/null -w "no-secret  -> %{http_code} (expect 401)\n" -X POST http://127.0.0.1:3211/backend/webhook -H "content-type: application/json" -d '{}'

echo "=== [2] job flips to error when backend is down ==="
A=$("$N" "$C" run jobs:firstUserId 2>&1 | tail -1 | tr -d '"[:space:]')
WS=$("$N" "$C" run orgs:createWorkspaceForUser "{\"userId\":\"$A\",\"name\":\"P4\"}" 2>&1 | tail -1 | tr -d '"[:space:]')
systemctl stop myos-echo
JID=$("$N" "$C" run jobs:createInternal "{\"workspaceId\":\"$WS\",\"userId\":\"$A\",\"kind\":\"faulttest\",\"input\":{}}" 2>&1 | tail -1 | tr -d '"[:space:]')
echo "jobId=$JID (echo stopped)"
sleep 6
echo "-- job row (expect status=error) --"; "$N" "$C" data jobs 2>&1 | grep "$JID"
systemctl start myos-echo; sleep 2; echo "echo restarted: $(systemctl is-active myos-echo)"

echo "=== [3] OTP is single-use (replay must fail) ==="
EMAIL="p4otp$$@myos.test"
OUT=$("$N" "$C" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\"}}" 2>&1)
CODE=$(printf '%s' "$OUT" | grep -oE "OTP for $EMAIL: [0-9]+" | grep -oE '[0-9]+$' | tail -1)
echo "code=$CODE"
echo -n "verify #1: "; "$N" "$C" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}}" 2>&1 | grep -qE '"token"' && echo "SUCCESS (tokens issued)" || echo "FAILED"
echo -n "verify #2 (replay): "; "$N" "$C" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}}" 2>&1 | grep -qE '"token"' && echo "SUCCESS (BUG: code reusable!)" || echo "rejected (good, single-use)"
echo P4_DONE
