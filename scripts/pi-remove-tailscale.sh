#!/usr/bin/env bash
# Stop Tailscale on kay2 to isolate VPN-related reboot/network issues.
# Does NOT uninstall the package — re-enable with:
#   sudo systemctl enable --now tailscaled && sudo tailscale up && sudo tailscale serve --bg 7420
#
# Usage: ./scripts/pi-remove-tailscale.sh [--purge]
#   --purge  Full remove (logout + apt purge). Default is stop+disable only.

set -euo pipefail

PURGE=false
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=true
fi

OUT_DIR="${HOME}/pi-diagnostics"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${OUT_DIR}/tailscale-before-remove-${STAMP}.txt"

echo "Saving Tailscale state to ${BACKUP}..."
{
  echo "Captured: $(date -Is)"
  echo ""
  command -v tailscale >/dev/null && tailscale version || echo "tailscale not installed"
  echo ""
  tailscale status 2>&1 || true
  echo ""
  tailscale serve status 2>&1 || true
  echo ""
  tailscale ip -4 2>&1 || true
} > "$BACKUP"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale is not installed. Nothing to do."
  exit 0
fi

echo ""
echo "Step 1/4: Reset tailscale serve (HTTPS proxy to port 7420)..."
if sudo tailscale serve reset 2>/dev/null; then
  echo "  serve reset OK"
else
  echo "  serve reset skipped or failed (may already be clear)"
fi

echo ""
echo "Step 2/4: Log out of tailnet (keeps client installed)..."
if $PURGE; then
  sudo tailscale logout 2>/dev/null || echo "  logout skipped"
else
  echo "  skipped (use --purge to logout)"
fi

echo ""
echo "Step 3/4: Stop tailscaled..."
sudo systemctl stop tailscaled
echo "  stopped"

echo ""
echo "Step 4/4: Disable tailscaled at boot..."
sudo systemctl disable tailscaled
echo "  disabled"

if $PURGE; then
  echo ""
  echo "Purging tailscale package..."
  sudo apt remove --purge tailscale -y
  sudo apt autoremove -y
  echo "  purged"
fi

echo ""
echo "Done. Tailscale is OFF."
echo ""
echo "Verify:"
echo "  systemctl is-active tailscaled    # should print: inactive"
echo "  ip route                            # should use normal LAN gateway"
echo "  ping -c 3 8.8.8.8                   # plain internet"
echo ""
echo "KAY2Tunnel still runs locally:"
echo "  pm2 status"
echo "  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7420/"
echo ""
echo "After the Pi is stable, re-enable:"
echo "  sudo systemctl enable --now tailscaled"
echo "  sudo tailscale up"
echo "  sudo tailscale serve --bg 7420"
echo ""
echo "State backup: ${BACKUP}"
