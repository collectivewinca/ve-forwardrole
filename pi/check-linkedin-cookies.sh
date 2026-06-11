#!/bin/bash
# pi/check-linkedin-cookies.sh — discover pre-flight, run by cron BEFORE `npm run discover`.
#
# History/why: the cron chain is `... && bash pi/check-linkedin-cookies.sh && npm run
# discover && ...`. When this file was missing, bash exited 127 and the `&&` halted the
# WHOLE chain — discover/triage/ship silently never ran. So the mere existence of this
# script (exiting 0) is what unblocks the pipeline.
#
# What it actually gates on: `discover.ts` sources LinkedIn jobs through the Apify actor
# (curious_coder~linkedin-jobs-scraper), which carries its OWN LinkedIn auth — it does
# NOT consume the LINKEDIN_* cookies in .env. So the HARD dependency for discover is a
# present APIFY_TOKEN; LinkedIn cookie freshness is only a SOFT warning (relevant if you
# later wire cookies into the actor input or a CDP-based scraper).
#
# Exit 0 => proceed with discover.  Exit 1 => block (a hard dependency is missing).
set -uo pipefail

fail() { echo "pre-flight: BLOCK — $1" >&2; exit 1; }
warn() { echo "pre-flight: warn — $1" >&2; }

# --- HARD GATE: Apify token (discover's real dependency) -----------------------------
[ -n "${APIFY_TOKEN:-}" ] || fail "APIFY_TOKEN not set in .env — discover cannot source jobs. Set it and re-run."

# --- SOFT CHECK: LinkedIn session cookie freshness -----------------------------------
# Only meaningful if you've wired cookies into the scraper. We probe li_at against the
# logged-in feed: 200 => valid, 302/999/403 => stale or challenged. Never blocks.
if [ -n "${LINKEDIN_LI_AT:-}" ]; then
  code=$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 12 \
    -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' \
    -b "li_at=${LINKEDIN_LI_AT}" \
    'https://www.linkedin.com/feed/' 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "pre-flight: LinkedIn cookie OK (feed 200)."
  else
    warn "LinkedIn li_at looks stale (feed returned HTTP $code). discover still runs via Apify, but refresh the LINKEDIN_* values in .env from a logged-in browser if you rely on them. (Not blocking.)"
  fi
else
  warn "LINKEDIN_LI_AT not set — skipping cookie freshness probe (discover runs via Apify regardless)."
fi

echo "pre-flight: OK — proceeding with discover."
exit 0
