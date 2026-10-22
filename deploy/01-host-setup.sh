#!/usr/bin/env bash
# Provision a fresh Ubuntu 24.04 VM to host the v1 stack:
# Docker + Compose plugin (for self-hosted Convex), Bun (build/run Next apps), git, unzip.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== apt prerequisites ==="
apt-get update -qq
apt-get install -y -qq ca-certificates curl unzip git >/dev/null
echo "ok"

echo "=== docker ==="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker --version
docker compose version

echo "=== bun ==="
if [ ! -x "$HOME/.bun/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"
echo "bun $(bun --version)"

echo "=== git ==="
git --version

echo "=== firewall (ufw) status ==="
ufw status 2>/dev/null || echo "ufw not installed (ports governed by external rules only)"

echo "HOST_SETUP_DONE"
