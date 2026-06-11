#!/bin/bash
# pi/cron-watchdog.sh — alerts (Telegram) when the ve-work discover/triage/ship
# pipeline hasn't completed a SUCCESSFUL run recently. Run hourly by cron.
#
# Wiring (deployed alongside this file): the main 07:00/19:00 UTC chain will end with
#   && date -u +%s > pi/.last-success
# so a fresh value in that marker means the whole chain (discover→triage→ship) finished.
# This script reads the marker; if it's too stale (or missing) it sends ONE alert and
# records it in pi/.last-alert so the hourly cron does not spam you 14× during an outage.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0          # -> ve-work root

# Load TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from .env (best-effort; same vars ship.sh uses).
[ -f .env ] && { set -a; . ./.env; set +a; }

MARKER="pi/.last-success"
ALERT_MARKER="pi/.last-alert"
NOW=$(date -u +%s)

send_alert() {
  local text="$1"
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || { echo "watchdog: no TELEGRAM_BOT_TOKEN, cannot alert" >&2; return; }
  local chat="${TELEGRAM_CHAT_ID:-}"
  [ -n "$chat" ] || { echo "watchdog: no TELEGRAM_CHAT_ID, cannot alert" >&2; return; }
  /usr/bin/curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":\"${chat}\",\"text\":\"${text}\",\"parse_mode\":\"Markdown\",\"disable_web_page_preview\":true}" \
    >/dev/null || true
}

# Seconds since the last successful pipeline run. Missing marker => treat as "never".
if [ -f "$MARKER" ]; then
  last=$(cat "$MARKER" 2>/dev/null || echo 0)
else
  last=0
fi
age=$(( NOW - last ))

# Seconds since we last alerted (for throttling). Missing => "long ago".
if [ -f "$ALERT_MARKER" ]; then
  last_alert=$(cat "$ALERT_MARKER" 2>/dev/null || echo 0)
else
  last_alert=0
fi
since_alert=$(( NOW - last_alert ))

# ───────────────────────────────────────────────────────────────────────────────
# TODO(human): decide the alert policy.
#
#   Context: the pipeline runs at 07:00 and 19:00 UTC (every 12h). A genuinely
#   missed run is only detectable a bit AFTER the next one should have landed.
#   This cron fires hourly, so without throttling a real outage = many duplicate pings.
#
#   You have:
#     $age          — seconds since the last SUCCESSFUL run (huge if never)
#     $since_alert   — seconds since you last alerted ($ALERT_MARKER)
#     send_alert "…" — sends a Telegram message (Markdown ok)
#
#   Decide and set the two variables below:
#     1) STALE_AFTER   — how many seconds of no-success counts as "broken"?
#                        (Hint: a bit more than the 12h cadence, e.g. ~13–14h, so a
#                         single missed run trips it but a normal gap does not.)
#     2) REALERT_AFTER — once alerted, how long to stay quiet before re-alerting?
#
#   Then set should_alert (0/1) and alert_msg accordingly.
# ───────────────────────────────────────────────────────────────────────────────
STALE_AFTER=$(( 13 * 3600 ))    # 13h: one missed 12h run + a 1h grace, so a normal gap never trips it
REALERT_AFTER=$(( 6 * 3600 ))   # during a sustained outage, re-ping every 6h instead of going silent
should_alert=0
alert_msg=""

if [ "$age" -ge "$STALE_AFTER" ] && [ "$since_alert" -ge "$REALERT_AFTER" ]; then
  should_alert=1
  if [ "$last" = "0" ]; then
    alert_msg="⚠️ *ve-work*: no successful pipeline run on record. discover/triage/ship may never have completed — check pi/cron.log."
  else
    alert_msg="⚠️ *ve-work*: no successful pipeline run in $(( age / 3600 ))h (expected every 12h). discover/triage/ship may be failing — check pi/cron.log."
  fi
fi

if [ "$should_alert" = "1" ]; then
  send_alert "$alert_msg"
  date -u +%s > "$ALERT_MARKER"
fi
exit 0
