#!/usr/bin/env bash
# Clive digest — reads the tail of the Clive/TrenchesAI cron logs and emits a single
# @@PUSH summary line. Read-only: it never touches Clive's processes or trades. Safe
# to run on a schedule or on demand. Logs that don't exist are simply skipped.
set -uo pipefail

declare -A LOGS=(
  [income]="/tmp/openclaw/cron.log"
  [scan]="/tmp/clive-scan.log"
  [positions]="$HOME/clive/pompfon/logs/positions.log"
  [vanity]="$HOME/clive/vanity-cron.log"
)

parts=()
for key in income scan positions vanity; do
  f="${LOGS[$key]}"
  [ -r "$f" ] || continue
  lines=$(wc -l < "$f" 2>/dev/null | tr -d ' ')
  # most recent non-empty line, trimmed to something push-sized
  last=$(grep -v '^[[:space:]]*$' "$f" 2>/dev/null | tail -n 1 | cut -c1-80)
  parts+=("${key}:${lines}ln")
  echo "--- $key ($f, $lines lines)"
  echo "    last: $last"
done

if [ ${#parts[@]} -eq 0 ]; then
  echo "@@QUIET"
  echo "clive-digest: no Clive logs found yet"
  exit 0
fi

echo "@@PUSH: 🦞 Clive digest — $(IFS=' '; echo "${parts[*]}")"
