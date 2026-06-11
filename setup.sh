#!/bin/bash
# setup.sh — first-run setup + capability checklist for ve-forwardrole.
# Safe to re-run any time; it never overwrites an existing .env.
set -uo pipefail
cd "$(dirname "$0")"

echo "── ve-forwardrole setup ──────────────────────────────────────────"

# Node
if command -v node >/dev/null 2>&1; then
  NODE_V=$(node -v)
  echo "✓ node $NODE_V"
  case "$NODE_V" in
    v1[0-7].*|v[0-9].*) echo "  ⚠ Node 18+ required for the pipeline (20.9+ to BUILD the dashboard)";;
  esac
else
  echo "✗ node not found — install Node 18+ (https://nodejs.org)"; exit 1
fi

# Deps
[ -d node_modules ] || { echo "… installing npm dependencies"; npm install --silent; }
echo "✓ npm dependencies"

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ created .env from .env.example — fill in keys as you get them"
else
  echo "✓ .env exists"
fi

# PocketBase (only needed for the web dashboard)
if [ ! -x pocketbase/pocketbase ]; then
  echo "… PocketBase not found. Download it? Only needed for the web dashboard. [y/N]"
  read -r yn
  if [ "${yn:-n}" = "y" ]; then
    PB_VERSION="0.30.0"
    OS=$(uname -s | tr '[:upper:]' '[:lower:]'); ARCH=$(uname -m)
    case "$ARCH" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; esac
    mkdir -p pocketbase
    curl -sL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${OS}_${ARCH}.zip" -o /tmp/pb.zip \
      && unzip -oq /tmp/pb.zip -d pocketbase && rm /tmp/pb.zip \
      && cp -r pb_migrations pocketbase/ 2>/dev/null
    [ -x pocketbase/pocketbase ] && echo "✓ PocketBase ${PB_VERSION} → ./pocketbase/ (run: ./pocketbase/pocketbase serve)" \
      || echo "✗ PocketBase download failed — grab it manually from pocketbase.io"
  fi
else
  echo "✓ PocketBase"
fi

# Capability checklist from .env
echo ""
echo "── capabilities (set keys in .env to unlock) ─────────────────────"
set -a; . ./.env 2>/dev/null; set +a
ck() { [ -n "${!1:-}" ] && echo "✓ $2" || echo "○ $2 — set $1"; }
echo "✓ ATS board discovery (no key needed — add companies to profiles/<you>/companies.yaml)"
ck ANTHROPIC_API_KEY "auto-triage + PDF parsing + outreach drafts"
ck EXA_API_KEY      "warm paths (alumni/ex-colleagues) + fit scores + neural search"
ck APIFY_TOKEN      "LinkedIn job discovery"
ck TELEGRAM_BOT_TOKEN "Telegram morning digest"
echo ""
echo "Next: bash pi/onboard.sh --name=<you> --pdf=<linkedin.pdf> --keywords=... --locations=..."
echo "Or Tier 1: open this repo in Claude Code and say: Run linkedin-parser on profiles/<you>/linkedin.pdf"
