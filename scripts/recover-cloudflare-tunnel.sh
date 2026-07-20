#!/usr/bin/env bash
# Recover / diagnose Cloudflare Tunnel on kay2 Pi.
# Run ON THE PI: bash ~/KAY2Tunnel/scripts/recover-cloudflare-tunnel.sh
set -euo pipefail

APP_PORT="${APP_PORT:-7420}"
APP_URL="http://127.0.0.1:${APP_PORT}/"

echo "=== KAY2Tunnel / Stan CLI — Cloudflare tunnel recovery ==="
echo "Time: $(date -Is)"
echo

echo "--- Local app (${APP_URL}) ---"
if curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 3 "${APP_URL}"; then
  :
else
  echo "WARN: nothing listening on ${APP_URL} — start PM2 first:"
  echo "  cd ~/KAY2Tunnel && pm2 start ecosystem.config.js"
fi
echo

echo "--- PM2 ---"
if command -v pm2 >/dev/null 2>&1; then
  pm2 status 2>/dev/null || true
else
  echo "pm2 not found"
fi
echo

echo "--- cloudflared binary ---"
if command -v cloudflared >/dev/null 2>&1; then
  cloudflared --version
else
  echo "cloudflared not in PATH"
fi
echo

echo "--- systemd cloudflared ---"
if command -v systemctl >/dev/null 2>&1; then
  systemctl status cloudflared --no-pager 2>&1 || true
  echo
  systemctl --failed --no-pager 2>&1 || true
else
  echo "systemctl not available"
fi
echo

echo "--- Processes ---"
ps aux | grep -E '[c]loudflared' || echo "no cloudflared process"
echo

echo "--- tmux sessions ---"
if command -v tmux >/dev/null 2>&1; then
  tmux ls 2>&1 || echo "no tmux sessions"
else
  echo "tmux not installed"
fi
echo

echo "--- cloudflared config files ---"
for f in "$HOME/.cloudflared/config.yml" /etc/cloudflared/config.yml; do
  if [[ -f "$f" ]]; then
    echo "==> $f"
    sed -e 's/tunnel: .*/tunnel: [REDACTED]/' -e 's/credentials-file: .*/credentials-file: [REDACTED]/' "$f" 2>/dev/null || cat "$f"
    echo
  fi
done

echo "--- Recent journal (cloudflared) ---"
if command -v journalctl >/dev/null 2>&1; then
  journalctl -u cloudflared -n 50 --no-pager 2>&1 || echo "no cloudflared unit logs"
fi
echo

echo "--- URLs found in logs (last 5) ---"
{
  journalctl -u cloudflared -n 300 --no-pager 2>/dev/null || true
  [[ -f "$HOME/cloudflared-quick.log" ]] && cat "$HOME/cloudflared-quick.log" || true
} | grep -oE 'https://[a-zA-Z0-9._-]+\.(trycloudflare\.com|kay2tunnel\.dev)[^ "'\''\)]*' | tail -5 || echo "(none found)"
echo

echo "--- Tailscale serve (if used) ---"
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve status 2>&1 || true
else
  echo "tailscale not in PATH"
fi
echo

echo "=== Suggested actions ==="
if systemctl is-active --quiet cloudflared 2>/dev/null; then
  echo "Named tunnel service is active. Public URL should be your Zero Trust hostname (*.kay2tunnel.dev)."
  echo "  sudo systemctl restart cloudflared"
  echo "  sudo systemctl status cloudflared"
elif pgrep -f cloudflared >/dev/null 2>&1; then
  echo "cloudflared running outside systemd — check tmux/screen and logs above for URL."
else
  echo "cloudflared not running. Pick one:"
  echo "  A) Named tunnel:  sudo systemctl start cloudflared"
  echo "  B) Quick tunnel:  cloudflared tunnel --url ${APP_URL}"
  echo "     (prints new https://....trycloudflare.com — save it)"
fi
echo
echo "See docs/server-commands.md for full workflow."
