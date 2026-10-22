#!/usr/bin/env bash
# Clone the get-convex/v1 template into /opt/myos on the VM and install deps.
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"

APP_DIR=/opt/myos
mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  echo "=== degit get-convex/v1 ==="
  bunx degit get-convex/v1 .
else
  echo "=== /opt/myos not empty, skipping clone ==="
fi

echo "=== bun install ==="
bun install

echo "=== top level ==="
ls -A
echo "CLONE_INSTALL_DONE"
