#!/usr/bin/env bash
# Prove the OTP login path: trigger sign-in step 1 (sends/【logs】 the code), then show
# the generated code in the backend logs and the authVerificationCodes row.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend

EMAIL="phase0@myos.test"
echo "=== trigger OTP send (auth:signIn step 1) for $EMAIL ==="
"$NODE" "$CVX" run auth:signIn "{\"provider\":\"resend-otp\",\"params\":{\"email\":\"$EMAIL\"}}" 2>&1 | tail -20 || echo "(signIn returned non-zero — checking side effects anyway)"

echo "=== authVerificationCodes table ==="
"$NODE" "$CVX" data authVerificationCodes 2>&1 | tail -8

echo "=== OTP code in backend logs ==="
cd /opt/myos/self-hosted && docker compose logs --since 3m backend 2>&1 | grep -i "OTP for" | tail -5 || echo "(no OTP log line found)"
echo "VERIFY_AUTH_DONE"
