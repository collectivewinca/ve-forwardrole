#!/bin/bash
# pi/deploy-app.sh — build the Next.js standalone bundle and rsync it to the box
# that serves the dashboard.
#
# IMPORTANT: run this FROM a Node >= 20.9 host (e.g. your laptop). The server only
# needs Node 18 to RUN the bundle; Next 16 needs >= 20.9 to BUILD it, so the build
# happens here and we rsync the result over SSH.
#
# Monorepo gotcha handled: with `output: "standalone"` AND multiple package-lock.json in
# the tree, Next roots the bundle at the repo, so server.js nests under
# .next/standalone/app/ rather than .next/standalone/. We detect either layout.
#
# node_modules is intentionally NOT synced — the VM keeps its own linux-native deps. If
# you CHANGE dependencies in app/package.json, run `npm install` in the app dir
# on the server (or sync node_modules) before/after this deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_SRC="$(pwd)/app"
VM="${VE_WORK_VM:?set VE_WORK_VM to user@host of the box running the dashboard}"
RUNTIME="${VE_WORK_RUNTIME:-ve-work-app}"

cd "$APP_SRC"
[ -d node_modules ] || npm install
echo "deploy: building with node $(node -v)..."
npm run build

# The standalone root depends on where Next thinks the workspace root is (it
# follows the outermost lockfile), so locate server.js instead of guessing.
SERVER_JS=$(find .next/standalone -maxdepth 4 -name server.js | head -1)
if [ -n "$SERVER_JS" ]; then SRC=$(dirname "$SERVER_JS")
else echo "deploy: ERROR — server.js not found under .next/standalone (build failed?)" >&2; exit 1; fi
echo "deploy: standalone root = $SRC"

echo "deploy: backing up VM runtime..."
ssh "$VM" "tar czf /tmp/ve-work-app.bak.tar.gz -C '$RUNTIME' . 2>/dev/null || true"

echo "deploy: syncing bundle (excluding node_modules)..."
rsync -az --exclude node_modules "$SRC/" "$VM:$RUNTIME/"
rsync -az .next/static/ "$VM:$RUNTIME/.next/static/"
[ -d public ] && rsync -az public/ "$VM:$RUNTIME/public/" || true

echo "deploy: restarting service + health check..."
ssh "$VM" "sudo systemctl restart ve-work-app.service && sleep 4 && curl -s -o /dev/null -w 'deploy: /work/login HTTP %{http_code}\n' http://127.0.0.1:3000/work/login"
