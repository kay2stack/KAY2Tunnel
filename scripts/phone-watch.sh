#!/usr/bin/env bash
# phone-watch.sh — start this NOW and walk off. Polls adb until the Nokia
# appears (authorised), then auto-runs phone-bringup.sh once and exits.
#   ./scripts/phone-watch.sh            # poll every 3s, give up after 30 min
#   TIMEOUT=0 ./scripts/phone-watch.sh  # poll forever
set -uo pipefail
cd "$(dirname "$0")"

SERIAL="${PHONE_SERIAL:-AQ7505H029P20300035}"
INTERVAL="${INTERVAL:-3}"
TIMEOUT="${TIMEOUT:-1800}"   # seconds; 0 = forever
START=$(date +%s)

echo "Watching for the phone (every ${INTERVAL}s)…  Ctrl-C to stop."
adb start-server >/dev/null 2>&1
while :; do
  if adb devices | grep -qE "^${SERIAL}[[:space:]]+device$" \
     || adb devices | awk 'NR>1 && $2=="device"{f=1} END{exit !f}'; then
    echo "→ device online. Running bring-up…"
    exec ./phone-bringup.sh
  fi
  if [ "$TIMEOUT" -gt 0 ] && [ $(( $(date +%s) - START )) -ge "$TIMEOUT" ]; then
    echo "Gave up after ${TIMEOUT}s — phone never appeared."; exit 1
  fi
  sleep "$INTERVAL"
done
