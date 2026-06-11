#!/bin/bash
# pi/backup-queue.sh — rotating backups of jobs/queue.md.
# Runs automatically before any pipeline step that mutates the queue (npm pre-hooks)
# and at the start of ship.sh. Guards against accidental truncation: a wiped/empty
# queue.md is NEVER copied over a good backup, so recovery is always possible.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=jobs/.queue-backups
mkdir -p "$DIR"
if [ -s jobs/queue.md ]; then
  cp jobs/queue.md "$DIR/queue-$(date -u +%Y%m%dT%H%M%SZ).md"
  # keep the 20 most recent
  ls -1t "$DIR"/queue-*.md 2>/dev/null | tail -n +21 | xargs -r rm -f
else
  echo "backup-queue: jobs/queue.md is empty/missing — NOT backing up (preserving prior backups)" >&2
fi
