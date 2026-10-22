#!/usr/bin/env bash
# Phase 0 auth on the VM: place updated source files, generate + set JWT/JWKS/SITE_URL,
# deploy backend (Node), and check the JWKS/OIDC endpoints. Run under Node (Bun ws bug #390).
set -euo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js

echo "=== sync changed source files into place ==="
cp /tmp/ResendOTP.ts         /opt/myos/packages/backend/convex/ResendOTP.ts
cp /tmp/auth.ts              /opt/myos/packages/backend/convex/auth.ts
cp /tmp/email-otp-signin.tsx /opt/myos/apps/app/src/components/email-otp-signin.tsx
cp /tmp/login_page.tsx      "/opt/myos/apps/app/src/app/[locale]/(public)/login/page.tsx"
echo "ok"

cd /opt/myos/packages/backend

echo "=== generate JWT keys ==="
"$NODE" /opt/myos/generateKeys.mjs
JWT_PRIVATE_KEY="$(cat /tmp/jwt_private_key)"
JWKS="$(cat /tmp/jwks)"

echo "=== set deployment env vars (JWT_PRIVATE_KEY, JWKS, SITE_URL) ==="
"$NODE" "$CVX" env set JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY" >/dev/null && echo "JWT_PRIVATE_KEY set"
"$NODE" "$CVX" env set JWKS "$JWKS" >/dev/null && echo "JWKS set"
"$NODE" "$CVX" env set SITE_URL "http://10.1.30.14:3000" >/dev/null && echo "SITE_URL set"
rm -f /tmp/jwt_private_key /tmp/jwks

echo "=== deploy backend functions (Node) ==="
"$NODE" "$CVX" deploy -y

echo "=== deployment env (names only) ==="
"$NODE" "$CVX" env list | sed 's/=.*/=<set>/'

echo "=== JWKS / OIDC endpoint reachability (site proxy :3211) ==="
curl -fsS http://127.0.0.1:3211/.well-known/jwks.json >/dev/null && echo "jwks: OK" || echo "jwks: NOT FOUND"
curl -fsS http://127.0.0.1:3211/.well-known/openid-configuration >/dev/null && echo "openid-config: OK" || echo "openid-config: NOT FOUND"
echo "PHASE0_AUTH_DONE"
