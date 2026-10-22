#!/usr/bin/env bash
# On the VM: ensure real Node (Bun's websocket client is broken vs self-hosted Convex,
# convex-backend issue #390), then exercise the prod Convex DB end-to-end:
# list tables, create a test user, read it back.
set -uo pipefail

NODE=/usr/bin/node
if [ ! -x "$NODE" ]; then
  echo "=== installing Node 22 LTS ==="
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs >/dev/null 2>&1
fi
echo "node: $($NODE --version) at $NODE"

cd /opt/myos/packages/backend
CVX=/opt/myos/node_modules/convex/bin/main.js

echo "=== tables (before) ==="
"$NODE" "$CVX" data || true
echo "=== users (before) ==="
"$NODE" "$CVX" data users || true

echo "=== create test user ==="
printf '%s\n' '{"name":"Test User","email":"test@example.com","username":"testuser"}' > /tmp/testuser.jsonl
"$NODE" "$CVX" import --table users --append /tmp/testuser.jsonl -y

echo "=== users (after) ==="
"$NODE" "$CVX" data users
echo "VM_DB_CHECK_DONE"
