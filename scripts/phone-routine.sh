#!/usr/bin/env bash
# Phone routine — runs a DroidLoop task ONLY when it is safe to:
#   1. the phone is actually connected over ADB, and
#   2. the thermal watchdog has not raised the overheat flag, and
#   3. a quick battery-temp read is under the abort threshold.
# When any guard fails it no-ops quietly (exit 0) — so a missed run is never an error.
# This is the thermal-safe wrapper; set GOAL to the task you want driven on-device.
set -uo pipefail

ADB=${ADB_BIN:-adb}
DROIDLOOP=${DROIDLOOP_DIR:-$HOME/DroidLoop}
OVERHEAT_FLAG=${OVERHEAT_FLAG:-/tmp/droidloop-overheat.flag}
TEMP_ABORT=${TEMP_ABORT:-42}        # °C — matches DroidLoop max_battery_temp_c
GOAL=${GOAL:-}                       # set this to enable the routine

# 1) connected?
if ! "$ADB" devices 2>/dev/null | grep -qE '\tdevice$'; then
  echo "@@QUIET"; echo "phone-routine: no device connected — skipping"; exit 0
fi

# 2) overheat flag set by the watchdog?
if [ -f "$OVERHEAT_FLAG" ]; then
  echo "@@PUSH: 🔥 Phone routine skipped — overheat flag is set"; exit 0
fi

# 3) live battery temperature gate
raw=$("$ADB" shell dumpsys battery 2>/dev/null | grep -oE 'temperature: [0-9]+' | grep -oE '[0-9]+')
if [ -n "$raw" ]; then
  temp=$((raw / 10))
  if [ "$temp" -ge "$TEMP_ABORT" ]; then
    echo "@@PUSH: 🔥 Phone routine aborted — battery ${temp}°C (abort ${TEMP_ABORT}°C)"; exit 0
  fi
  echo "phone-routine: battery ${temp}°C, OK to run"
fi

# 4) run the routine (scaffold) — only if a GOAL is configured
if [ -z "$GOAL" ]; then
  echo "@@QUIET"
  echo "phone-routine: connected & cool, but no GOAL set — nothing to do."
  echo "   Set GOAL (env on the job) to e.g. 'open YouTube Studio and read latest comments'."
  exit 0
fi

cd "$DROIDLOOP" 2>/dev/null || { echo "@@PUSH: ⚠️ DroidLoop dir not found"; exit 2; }
echo "phone-routine: running DroidLoop goal: $GOAL"
if [ -x ./play.sh ]; then
  GOAL="$GOAL" ./play.sh && echo "@@PUSH: 📱 Phone routine done — $GOAL"
else
  echo "@@PUSH: ⚠️ DroidLoop play.sh not executable"; exit 2
fi
