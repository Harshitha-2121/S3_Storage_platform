#!/usr/bin/env bash
# Deploy the Convex schema/functions to the self-hosted backend on this VM,
# and set deployment env vars referenced by auth.config.ts / env.ts.
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"
cd /opt/myos/packages/backend

echo "=== set deployment env vars ==="
# CONVEX_SITE_URL is a built-in self-hosted var (= CONVEX_SITE_ORIGIN), don't override it.
bunx convex env set SITE_URL "http://10.1.30.14:3000" || echo "(SITE_URL not set; continuing)"

echo "=== deploy functions to self-hosted backend ==="
bunx convex deploy -y

echo "=== deployment env vars ==="
bunx convex env list || true
echo "BACKEND_DEPLOY_DONE"
