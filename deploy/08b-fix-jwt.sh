#!/usr/bin/env bash
# Re-set JWT_PRIVATE_KEY (value starts with "-----BEGIN", which the CLI mis-parses as a flag).
# Regenerate so JWT_PRIVATE_KEY and JWKS remain a matched keypair, then set both.
set -uo pipefail
NODE=/usr/bin/node
CVX=/opt/myos/node_modules/convex/bin/main.js
cd /opt/myos/packages/backend

"$NODE" /opt/myos/generateKeys.mjs
JWT_PRIVATE_KEY="$(cat /tmp/jwt_private_key)"
JWKS="$(cat /tmp/jwks)"

echo "=== set JWKS ==="
"$NODE" "$CVX" env set -- JWKS "$JWKS" >/dev/null && echo "JWKS ok"

echo "=== set JWT_PRIVATE_KEY (-- end-of-options) ==="
if "$NODE" "$CVX" env set -- JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY" >/dev/null 2>&1; then
  echo "JWT_PRIVATE_KEY ok (-- form)"
else
  echo "-- form failed; trying NAME=VALUE single-arg form"
  "$NODE" "$CVX" env set "JWT_PRIVATE_KEY=$JWT_PRIVATE_KEY" >/dev/null && echo "JWT_PRIVATE_KEY ok (NAME=VALUE form)"
fi
rm -f /tmp/jwt_private_key /tmp/jwks

echo "=== verify env vars present (values redacted) ==="
"$NODE" "$CVX" env list | sed 's/=.*/=<set>/'
echo "FIX_JWT_DONE"
