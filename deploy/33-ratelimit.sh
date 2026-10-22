#!/usr/bin/env bash
# Deploy tuned auth (5 failed/hr) and PROVE brute-force lockout on password sign-in.
set -uo pipefail
N=/usr/bin/node; C=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend
echo "=== deploy auth (maxFailedAttempsPerHour=5) ==="
cp /tmp/auth.ts /opt/myos/packages/backend/convex/auth.ts
"$N" "$C" deploy -y 2>&1 | tail -2

mkacct() {
  local email="$1" out code
  out=$("$N" "$C" run auth:signIn "{\"provider\":\"password\",\"params\":{\"email\":\"$email\",\"password\":\"Correct#2026\",\"flow\":\"signUp\"}}" 2>&1)
  code=$(printf '%s' "$out" | grep -oE "email verification code for $email: [0-9]+" | grep -oE '[0-9]+$' | tail -1)
  "$N" "$C" run auth:signIn "{\"provider\":\"password\",\"params\":{\"email\":\"$email\",\"code\":\"$code\",\"flow\":\"email-verification\"}}" >/dev/null 2>&1
}
signin() {
  local r; r=$("$N" "$C" run auth:signIn "{\"provider\":\"password\",\"params\":{\"email\":\"$1\",\"password\":\"$2\",\"flow\":\"signIn\"}}" 2>&1)
  echo "$r" | grep -qE '"token"' && echo OK || echo FAIL
}

A="rla$$@myos.test"; B="rlb$$@myos.test"
echo "=== control account A ==="; mkacct "$A"
echo "A: correct password (expect OK): $(signin "$A" "Correct#2026")"

echo "=== lockout account B ==="; mkacct "$B"
for i in $(seq 1 6); do echo "B: wrong attempt $i (expect FAIL): $(signin "$B" "Wrong$i!aA9")"; done
echo "B: CORRECT password after 6 wrong (expect FAIL = locked out): $(signin "$B" "Correct#2026")"
echo RL_PROBE_DONE
