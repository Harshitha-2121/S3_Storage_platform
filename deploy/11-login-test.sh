#!/usr/bin/env bash
# Full passwordless login loop: step 1 (get code from dev-fallback log) -> step 2 (verify) ->
# confirm a session + user were created.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend

EMAIL="phase0-login@myos.test"

echo "=== step 1: request code ==="
OUT="$("$NODE" "$CVX" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\"}}" 2>&1)"
echo "$OUT" | tail -6
CODE="$(printf '%s\n' "$OUT" | grep -oE "OTP for $EMAIL: [0-9]+" | grep -oE '[0-9]+$' | tail -1)"
echo "captured code: ${CODE:-<none>}"
[ -n "$CODE" ] || { echo "no code captured"; exit 1; }

echo "=== step 2: verify code ==="
"$NODE" "$CVX" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}}" 2>&1 | tail -20

echo "=== users table ==="
"$NODE" "$CVX" data users 2>&1 | tail -6
echo "=== authSessions table ==="
"$NODE" "$CVX" data authSessions 2>&1 | tail -6
echo "LOGIN_TEST_DONE"
