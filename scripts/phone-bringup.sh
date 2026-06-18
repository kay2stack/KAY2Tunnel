#!/usr/bin/env bash
# phone-bringup.sh — run the moment the Nokia is plugged back in.
# Confirms the whole chain is green: USB → adb → device authorised →
# vitals → screenshot → StanCLI /api/android route. Read-only; writes nothing
# to the phone except a wake keyevent so the screen is on for the screenshot.
set -uo pipefail
cd "$(dirname "$0")/.."

SERIAL="${PHONE_SERIAL:-AQ7505H029P20300035}"
SHOT="${1:-/tmp/phone-bringup.png}"
STAN="http://127.0.0.1:7420"
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
no(){ printf '  \033[31m✗\033[0m %s\n' "$*"; }
hd(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

hd "1. USB bus"
if lsusb 2>/dev/null | grep -qiE 'nokia|hmd|google|2e04|18d1'; then
  ok "Android device present on USB"
else
  no "No Android device on the USB bus — check the cable (must be a DATA cable) and port."
  echo "    Re-run this script once it's physically connected."; exit 1
fi

hd "2. adb"
adb start-server >/dev/null 2>&1
STATE=$(adb devices | awk -v s="$SERIAL" '$1==s{print $2} $1!=s && NR>1 && $1!=""{print $2}' | head -1)
case "$STATE" in
  device)        ok "adb authorised ($SERIAL)";;
  unauthorized)  no "Device shows 'unauthorized' — tap ALLOW on the phone's USB-debugging prompt, then re-run."; exit 1;;
  *)             no "Device not in 'device' state (got '${STATE:-none}'). Unlock the phone & reconnect."; exit 1;;
esac

hd "3. Vitals"
MODEL=$(adb shell getprop ro.product.model | tr -d '\r')
REL=$(adb shell getprop ro.build.version.release | tr -d '\r')
SIZE=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1)
BATT=$(adb shell dumpsys battery | grep -oE 'level: [0-9]+' | grep -oE '[0-9]+')
TEMPC=$(adb shell dumpsys battery | grep -oE 'temperature: [0-9]+' | grep -oE '[0-9]+')
ok "$MODEL · Android $REL · $SIZE · battery ${BATT}% · $((TEMPC/10))°C"

hd "4. Screenshot"
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
if adb exec-out screencap -p > "$SHOT" 2>/dev/null && [ -s "$SHOT" ]; then
  ok "Saved $SHOT ($(du -h "$SHOT" | cut -f1))"
else
  no "Screenshot failed"
fi

hd "5. StanCLI /api/android route"
TOK=$(grep -E '^AUTH_TOKEN=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'\'' ')
if [ -z "$TOK" ]; then
  no "No AUTH_TOKEN in .env — skipping API check"
else
  RESP=$(curl -s --max-time 8 -H "Authorization: Bearer $TOK" "$STAN/api/android/status")
  if echo "$RESP" | grep -q '"connected":true'; then
    ok "StanCLI sees the phone — Phone tab is live"
  else
    no "StanCLI route reachable but device not connected yet: $RESP"
  fi
fi

hd "ALL SET"
echo "  Open StanCLI → More → Android Phone → Connect."
echo "  Screenshot: $SHOT"
