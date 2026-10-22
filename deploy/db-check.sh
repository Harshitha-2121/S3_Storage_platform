#!/usr/bin/env bash
# Verify local self-hosted Convex DB end-to-end using the NODE runtime
# (Bun's websocket client is broken vs self-hosted Convex - convex-backend issue #390).
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "=== installing Node 22 LTS ==="
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs >/dev/null 2>&1
fi
echo "node: $(node --version)"

cd /mnt/c/Users/test/Downloads/myos/packages/backend
CVX=../../node_modules/convex/bin/main.js

echo "=== tables (before) ==="
node "$CVX" data || true
echo "=== users (before) ==="
node "$CVX" data users || true
echo "=== create test user ==="
printf '%s\n' '{"name":"Test User","email":"test@example.com","username":"testuser"}' > /tmp/testuser.jsonl
node "$CVX" import --table users --append /tmp/testuser.jsonl -y
echo "=== users (after) ==="
node "$CVX" data users
echo "DB_CHECK_DONE"
