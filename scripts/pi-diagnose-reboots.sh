#!/usr/bin/env bash
# Read-only diagnostics for kay2 Pi reboot / stability issues.
# Usage: ./scripts/pi-diagnose-reboots.sh [--post-reboot]

set -euo pipefail

POST_REBOOT=false
if [[ "${1:-}" == "--post-reboot" ]]; then
  POST_REBOOT=true
fi

OUT_DIR="${HOME}/pi-diagnostics"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
TAG="pre"
if $POST_REBOOT; then
  TAG="post-reboot"
fi

REPORT="${OUT_DIR}/kay2-diagnostic-${STAMP}-${TAG}.txt"

section() {
  echo "" >> "$REPORT"
  echo "========== $1 ==========" >> "$REPORT"
  echo "" >> "$REPORT"
}

run() {
  echo "\$ $*" >> "$REPORT"
  "$@" >> "$REPORT" 2>&1 || echo "(command failed: $*)" >> "$REPORT"
}

{
  echo "kay2 Pi diagnostic report"
  echo "Generated: $(date -Is)"
  echo "Hostname: $(hostname)"
  echo "Tag: ${TAG}"
  echo "Uptime: $(uptime -p 2>/dev/null || uptime)"
} > "$REPORT"

section "System"
run uname -a
run cat /etc/os-release
run uptime
run who -b
run last reboot
run last -x shutdown reboot

section "Boot timeline (this boot)"
if command -v systemd-analyze >/dev/null 2>&1; then
  run systemd-analyze
  run systemd-analyze blame
  run systemd-analyze critical-chain
fi

section "Previous boot journal (last 80 lines)"
if command -v journalctl >/dev/null 2>&1; then
  echo "\$ journalctl -b -1 -n 80 --no-pager" >> "$REPORT"
  journalctl -b -1 -n 80 --no-pager >> "$REPORT" 2>&1 || echo "(no previous boot journal)" >> "$REPORT"
fi

section "Raspberry Pi — power & thermal"
if command -v vcgencmd >/dev/null 2>&1; then
  run vcgencmd get_throttled
  run vcgencmd measure_temp
  run vcgencmd measure_volts core
else
  echo "vcgencmd not available (not a Pi or missing userland)" >> "$REPORT"
fi

section "Memory & swap"
run free -h
if [[ -f /proc/meminfo ]]; then
  echo "\$ grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo" >> "$REPORT"
  grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo >> "$REPORT" 2>&1 || true
fi

section "OOM / kill events"
if command -v journalctl >/dev/null 2>&1; then
  echo "\$ journalctl -k --no-pager | grep -iE 'oom|killed process|out of memory' | tail -20" >> "$REPORT"
  journalctl -k --no-pager 2>/dev/null | grep -iE 'oom|killed process|out of memory' | tail -20 >> "$REPORT" 2>&1 || echo "(none found)" >> "$REPORT"
fi
if [[ -f /var/log/syslog ]]; then
  echo "\$ grep -i 'out of memory' /var/log/syslog | tail -10" >> "$REPORT"
  grep -i 'out of memory' /var/log/syslog 2>/dev/null | tail -10 >> "$REPORT" 2>&1 || echo "(none in syslog)" >> "$REPORT"
fi

section "Disk & SD health hints"
run df -h
if command -v dmesg >/dev/null 2>&1; then
  echo "\$ dmesg | grep -iE 'mmc|I/O error|ext4|reset' | tail -25" >> "$REPORT"
  dmesg 2>/dev/null | grep -iE 'mmc|I/O error|ext4|reset' | tail -25 >> "$REPORT" 2>&1 || echo "(dmesg unavailable)" >> "$REPORT"
fi

section "Network (no VPN required)"
run ip -br addr
run ip route
run cat /etc/resolv.conf
if ping -c 2 -W 3 8.8.8.8 >/dev/null 2>&1; then
  echo "ping 8.8.8.8: OK" >> "$REPORT"
else
  echo "ping 8.8.8.8: FAILED" >> "$REPORT"
fi

section "Tailscale"
if command -v tailscale >/dev/null 2>&1; then
  run tailscale version
  run tailscale status
  run tailscale ip -4
  run tailscale serve status
  run systemctl is-active tailscaled
  run systemctl is-enabled tailscaled
  echo "\$ journalctl -u tailscaled --since '24 hours ago' -n 40 --no-pager" >> "$REPORT"
  journalctl -u tailscaled --since '24 hours ago' -n 40 --no-pager >> "$REPORT" 2>&1 || true
else
  echo "tailscale CLI not installed" >> "$REPORT"
fi

section "KAY2Tunnel / stan-cli (PM2)"
if command -v pm2 >/dev/null 2>&1; then
  run pm2 status
  echo "\$ pm2 logs stan-cli --lines 20 --nostream" >> "$REPORT"
  pm2 logs stan-cli --lines 20 --nostream >> "$REPORT" 2>&1 || true
else
  echo "pm2 not installed" >> "$REPORT"
fi
run ss -tlnp
if ss -tlnp 2>/dev/null | grep -q ':7420'; then
  echo "Port 7420: listening" >> "$REPORT"
else
  echo "Port 7420: NOT listening" >> "$REPORT"
fi

section "Watchdog & scheduled reboots"
run systemctl is-active watchdog 2>/dev/null || echo "watchdog: n/a" >> "$REPORT"
echo "--- user crontab ---" >> "$REPORT"
crontab -l >> "$REPORT" 2>&1 || echo "(no user crontab)" >> "$REPORT"
echo "--- root crontab ---" >> "$REPORT"
sudo crontab -l >> "$REPORT" 2>&1 || echo "(no root crontab)" >> "$REPORT"
if [[ -f /var/log/unattended-upgrades/unattended-upgrades.log ]]; then
  echo "\$ tail -15 unattended-upgrades.log" >> "$REPORT"
  tail -15 /var/log/unattended-upgrades/unattended-upgrades.log >> "$REPORT" 2>&1 || true
fi

section "Top memory consumers"
if command -v ps >/dev/null 2>&1; then
  echo "\$ ps aux --sort=-%mem | head -15" >> "$REPORT"
  ps aux --sort=-%mem 2>/dev/null | head -15 >> "$REPORT" || true
fi

echo "" >> "$REPORT"
echo "Report saved: ${REPORT}" >> "$REPORT"

# Print summary to terminal
echo "Diagnostic report written to:"
echo "  ${REPORT}"
echo ""

if command -v vcgencmd >/dev/null 2>&1; then
  THROTTLED="$(vcgencmd get_throttled 2>/dev/null || echo 'unknown')"
  TEMP="$(vcgencmd measure_temp 2>/dev/null || echo 'unknown')"
  echo "Quick check:"
  echo "  throttled: ${THROTTLED}"
  echo "  temp:      ${TEMP}"
  if [[ "$THROTTLED" != "throttled=0x0" && "$THROTTLED" != "unknown" ]]; then
    echo ""
    echo "⚠  Undervoltage or thermal throttling detected — check PSU and cooling."
  fi
fi

if command -v tailscale >/dev/null 2>&1; then
  TS_ACTIVE="$(systemctl is-active tailscaled 2>/dev/null || echo unknown)"
  echo "  tailscaled: ${TS_ACTIVE}"
fi
