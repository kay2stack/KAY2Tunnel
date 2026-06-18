#!/usr/bin/env bash
# phone-shot.sh — grab a screenshot off the phone right now.
#   ./scripts/phone-shot.sh [output.png]   (default: /tmp/phone-<timestamp>.png)
set -uo pipefail
OUT="${1:-/tmp/phone-$(date +%H%M%S).png}"
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
if adb exec-out screencap -p > "$OUT" 2>/dev/null && [ -s "$OUT" ]; then
  echo "saved $OUT ($(du -h "$OUT" | cut -f1))"
else
  echo "screenshot failed — is the phone connected & authorised? (adb devices)"; exit 1
fi
