#!/bin/bash
# pi/ship.sh — Commit, push, open PR, render shortlists, ping Telegram.
# Called by cron after `npm run discover && npm run triage`.
# Safe if there's nothing to commit (exits 0 silently for the commit/PR step;
# render still runs so the live page reflects the current queue + enrichment).

set -euo pipefail
cd "$(dirname "$0")/.."

# Snapshot the queue before any commit/render work (rotating, empty-safe).
bash pi/backup-queue.sh || echo "ship: backup-queue had errors (continuing)"

PR_URL=""
if git diff --quiet jobs/queue.md; then
  echo "ship: queue.md unchanged — skipping commit/PR"
else
  STAMP=$(date -u +%F-%H%M)
  BRANCH="auto/cron-${STAMP}"
  ADDED=$(git diff --numstat jobs/queue.md | awk '{print $1}')
  REMOVED=$(git diff --numstat jobs/queue.md | awk '{print $2}')

  # Preserve the LIVE queue (what the dashboard reads from the working tree) across
  # the branch dance below. `git checkout main` reverts queue.md to the committed
  # state — which on this VM is behind origin — so without this the new roles would
  # be discarded from the live dashboard (only surviving in the unmerged PR branch).
  cp jobs/queue.md /tmp/ship-queue-live.md

  git checkout -b "$BRANCH"
  git -c user.name=forwardrole-cron -c user.email=cron@localhost add jobs/queue.md
  git -c user.name=forwardrole-cron -c user.email=cron@localhost commit -m "cron: discover + triage $(date -u +%F)"
  git push -u origin "$BRANCH" || echo "ship: push failed (continuing)"

  # PR target from GITHUB_REPO or the origin remote — template copies PR their own repo.
  REPO="${GITHUB_REPO:-$(git remote get-url origin 2>/dev/null | /usr/bin/sed -E 's#.*github.com[:/]##; s#\.git$##' || true)}"
  PR_URL=$(gh pr create --repo "$REPO" \
    --title "cron: discover + triage $(date -u +%F)" \
    --body "Auto-pass on $(date -u +'%F %H:%M UTC'). Queue changed: +${ADDED} -${REMOVED} lines. Review and merge." \
    2>&1 | tail -1) || true
  echo "ship: opened $PR_URL"

  # Stash any remaining working-tree changes before switching branches, so
  # `git checkout main` can never revert/clobber an uncommitted file (this is the
  # belt to the cp-snapshot's suspenders — it was a bare checkout here that wiped
  # queue.md previously). Pop is best-effort; the cp restore below is authoritative.
  # TRACKED files only (no -u): checkout can't clobber untracked files, and
  # stashing them moves the live pi/cron.log out from under this script's own
  # stdout redirect — everything after writes to a deleted inode, invisibly.
  git stash push -m "ship-preserve" >/dev/null 2>&1 || true
  git checkout main >/dev/null 2>&1 || true
  git stash pop >/dev/null 2>&1 || true
  # Restore the live queue so the working tree (and dashboard) keep the new roles.
  # This is the final word regardless of how the stash/checkout above resolved.
  cp /tmp/ship-queue-live.md jobs/queue.md
fi

# Per-profile enrichment + render + here.now publish.
# enrich is no-op for profiles where enrichment.enabled is false in search.yaml.
# render is no-op for profiles without publish.slug.
echo "ship: enrichment pass..."
/bin/npm run enrich --silent || echo "ship: enrich step had errors (continuing)"
echo "ship: exa enrichment pass (external roles + alumni recs)..."
/bin/npm run enrich-exa --silent || echo "ship: enrich-exa step had errors (continuing)"
echo "ship: company dossiers pass..."
/bin/npm run company-dossier --silent || echo "ship: company-dossier step had errors (continuing)"
echo "ship: jd deep-read + fit scoring pass..."
/bin/npm run jd-fit --silent || echo "ship: jd-fit step had errors (continuing)"
echo "ship: render + publish pass..."
/bin/npm run render --silent || echo "ship: render step had errors (continuing)"

# Per-profile Telegram ping (best-effort). Each profile's search.yaml can
# declare its own telegram.chat_id; missing/empty falls back to global.
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  for yaml in profiles/*/search.yaml; do
    [ -f "$yaml" ] || continue
    profile=$(basename "$(dirname "$yaml")")
    # `|| true` is load-bearing: under set -euo pipefail, a profile with no
    # telegram:/publish: block makes grep exit 1 and the bare assignment would
    # kill the whole script — silently skipping every later profile AND the
    # .last-success write (this is what kept the watchdog alerting 2026-06-11).
    chat=$(/usr/bin/grep -A1 "^telegram:" "$yaml" 2>/dev/null | /usr/bin/grep "chat_id:" | /usr/bin/awk -F'"' '{print $2}' || true)
    [ -z "$chat" ] && chat="${TELEGRAM_CHAT_ID:-}"
    [ -z "$chat" ] && continue
    slug=$(/usr/bin/grep -A1 "^publish:" "$yaml" 2>/dev/null | /usr/bin/grep "slug:" | /usr/bin/awk -F'"' '{print $2}' || true)
    MSG="*ve-work* — fresh shortlist for $profile on $(date -u +%F)."
    [ -n "$slug" ] && MSG="$MSG https://$slug.here.now/"
    # render.ts writes a one-line digest (top roles by fit, literal \n separators,
    # quotes pre-stripped) — safe to splice straight into the JSON payload.
    DIGEST_FILE="/tmp/render-$profile/digest.txt"
    [ -f "$DIGEST_FILE" ] && MSG="$MSG\n$(cat "$DIGEST_FILE")"
    # The PR link goes only to the operator (set OPERATOR_PROFILE in .env).
    [ -n "$PR_URL" ] && [ "$profile" = "${OPERATOR_PROFILE:-}" ] && MSG="$MSG\nPR: $PR_URL"
    curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" \
      -d "{\"chat_id\":\"${chat}\",\"text\":\"${MSG}\",\"parse_mode\":\"Markdown\",\"disable_web_page_preview\":true}" \
      >/dev/null || true
  done
fi
