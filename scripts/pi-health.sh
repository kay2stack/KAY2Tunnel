#!/usr/bin/env bash
# Pi health check — disk / memory / CPU temp / load. Exits 0 and stays quiet when
# healthy; prints @@PUSH alerts and exits non-zero when a threshold is crossed.
# Thresholds are env-overridable.
set -uo pipefail

DISK_MAX=${DISK_MAX:-90}        # % used on /
MEM_MIN_MB=${MEM_MIN_MB:-200}   # MB available
TEMP_MAX=${TEMP_MAX:-75}        # °C
LOAD_MAX=${LOAD_MAX:-8.0}       # 1-min load average

problems=0

disk=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
if [ -n "$disk" ] && [ "$disk" -ge "$DISK_MAX" ]; then
  echo "@@PUSH: 💾 Disk ${disk}% full on / (limit ${DISK_MAX}%)"; problems=$((problems+1))
fi

mem=$(free -m | awk 'NR==2{print $7}')
if [ -n "$mem" ] && [ "$mem" -lt "$MEM_MIN_MB" ]; then
  echo "@@PUSH: 🧠 Low memory — ${mem} MB available (floor ${MEM_MIN_MB} MB)"; problems=$((problems+1))
fi

temp=""
if command -v vcgencmd >/dev/null 2>&1; then
  temp=$(vcgencmd measure_temp 2>/dev/null | grep -oE '[0-9]+\.[0-9]+')
fi
if [ -z "$temp" ] && [ -r /sys/class/thermal/thermal_zone0/temp ]; then
  temp=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp)
fi
if [ -n "$temp" ] && awk -v t="$temp" -v m="$TEMP_MAX" 'BEGIN{exit !(t>=m)}'; then
  echo "@@PUSH: 🌡️ CPU ${temp}°C (limit ${TEMP_MAX}°C)"; problems=$((problems+1))
fi

load=$(awk '{print $1}' /proc/loadavg)
if awk -v l="$load" -v m="$LOAD_MAX" 'BEGIN{exit !(l>=m)}'; then
  echo "@@PUSH: 📈 Load ${load} (limit ${LOAD_MAX})"; problems=$((problems+1))
fi

echo "health: disk=${disk}% mem=${mem}MB temp=${temp:-?}°C load=${load} problems=${problems}"
[ "$problems" -eq 0 ] || exit 2
