#!/usr/bin/env bash
# Prove all three hybrid paths end-to-end on the VM.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend
set -a; . /opt/myos/backend-echo/.env; set +a

echo "=== PROXY PATH: Convex action -> echo backend (service key + userId) ==="
"$NODE" "$CVX" run backend:callBackendInternal \
  "{\"userId\":\"u_demo_123\",\"path\":\"/proxy-echo\",\"body\":{\"hello\":\"world\"}}" 2>&1 | tail -15

echo
echo "=== DIRECT PATH: external backend verifies Convex JWT via JWKS ==="
EMAIL="phase1@myos.test"
OUT="$("$NODE" "$CVX" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\"}}" 2>&1)"
CODE="$(printf '%s\n' "$OUT" | grep -oE "OTP for $EMAIL: [0-9]+" | grep -oE '[0-9]+$' | tail -1)"
TOK="$("$NODE" "$CVX" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}}" 2>&1 | grep -oE '"token": "[^"]+"' | head -1 | sed 's/"token": "//; s/"$//')"
echo "issued JWT length: ${#TOK}"
echo "-> echo backend /whoami with the JWT:"
curl -s http://127.0.0.1:4000/whoami -H "authorization: Bearer $TOK"; echo

echo
echo "=== WEBHOOK PATH: echo backend -> Convex -> events table ==="
curl -s -X POST http://127.0.0.1:4000/emit-webhook -H "content-type: application/json" -d "{\"note\":\"hello from echo\"}"; echo
sleep 1
echo "-> events table:"
"$NODE" "$CVX" data events 2>&1 | tail -6
echo "VERIFY_PHASE1_DONE"
