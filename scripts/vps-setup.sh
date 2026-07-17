#!/usr/bin/env bash
# Bootstrap a VPS as Stan CLI fallback — Claude Code, Codex, OpenClaw when Pi is down.
#
# Run ON THE VPS (or pipe from Pi once Tailscale SSH works):
#   curl -fsSL https://raw.githubusercontent.com/kay2stack/KAY2Tunnel/main/scripts/vps-setup.sh | bash
# Or from a clone:
#   sudo bash scripts/vps-setup.sh
#
# Prerequisites:
#   - Ubuntu 22.04+ / Debian 12+
#   - Root or sudo
#   - Tailscale auth key (recommended) or manual tailscale up after

set -euo pipefail

REPO="${STAN_REPO:-https://github.com/kay2stack/KAY2Tunnel.git}"
INSTALL_DIR="${STAN_INSTALL_DIR:-$HOME/KAY2Tunnel}"
STAN_USER="${SUDO_USER:-$USER}"
PORT="${PORT:-7420}"

echo "═══════════════════════════════════════════"
echo " Stan CLI VPS fallback setup"
echo " Always-on agents when kay2 Pi is offline"
echo "═══════════════════════════════════════════"
echo ""

if [[ $EUID -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash $0"
  exit 1
fi

echo "▸ Base packages…"
apt-get update -qq
apt-get install -y -qq curl git build-essential python3 ca-certificates rsync

echo "▸ Node.js 20…"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  $(node -v)"

echo "▸ PM2…"
npm install -g pm2

echo "▸ Tailscale…"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
  tailscale up --auth-key="$TAILSCALE_AUTHKEY" --hostname="${VPS_HOSTNAME:-stan-vps}"
else
  echo "  Run manually after setup: sudo tailscale up --hostname=stan-vps"
fi

echo "▸ Clone Stan CLI…"
sudo -u "$STAN_USER" mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  sudo -u "$STAN_USER" git clone "$REPO" "$INSTALL_DIR"
else
  sudo -u "$STAN_USER" git -C "$INSTALL_DIR" pull --ff-only || true
fi

cd "$INSTALL_DIR"
sudo -u "$STAN_USER" npm install

echo "▸ Environment…"
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  TOKEN="$(openssl rand -hex 32)"
  sed -i "s/^AUTH_TOKEN=.*/AUTH_TOKEN=$TOKEN/" "$ENV_FILE"
  echo "  Generated AUTH_TOKEN (copy to Pi + iPhone):"
  echo "  $TOKEN"
else
  echo "  .env exists — keeping AUTH_TOKEN"
fi

# VPS identity
grep -q '^HOST_ROLE=' "$ENV_FILE" 2>/dev/null && sed -i 's/^HOST_ROLE=.*/HOST_ROLE=vps/' "$ENV_FILE" || echo 'HOST_ROLE=vps' >> "$ENV_FILE"
grep -q '^HOST_NAME=' "$ENV_FILE" 2>/dev/null && sed -i "s/^HOST_NAME=.*/HOST_NAME=${VPS_HOSTNAME:-stan-vps}/" "$ENV_FILE" || echo "HOST_NAME=${VPS_HOSTNAME:-stan-vps}" >> "$ENV_FILE"
grep -q '^ROOT_DIR=' "$ENV_FILE" 2>/dev/null && sed -i "s|^ROOT_DIR=.*|ROOT_DIR=$STAN_USER/projects|" "$ENV_FILE" || echo "ROOT_DIR=$STAN_USER/projects" >> "$ENV_FILE"
grep -q '^OPENCLAW_ENABLED=' "$ENV_FILE" 2>/dev/null || echo 'OPENCLAW_ENABLED=1' >> "$ENV_FILE"

sudo -u "$STAN_USER" mkdir -p "$STAN_USER/projects"

echo "▸ Build & PM2…"
sudo -u "$STAN_USER" bash -c "cd '$INSTALL_DIR' && npm run build"
sudo -u "$STAN_USER" bash -c "cd '$INSTALL_DIR' && pm2 delete stan-cli 2>/dev/null || true"
sudo -u "$STAN_USER" bash -c "cd '$INSTALL_DIR' && pm2 start ecosystem.config.js"
sudo -u "$STAN_USER" pm2 save
env PATH="$PATH:/usr/bin" sudo -u "$STAN_USER" pm2 startup systemd -u "$STAN_USER" --hp "$(eval echo ~$STAN_USER)" | tail -1 | bash || true

echo "▸ Tailscale serve (HTTPS on tailnet)…"
tailscale serve reset 2>/dev/null || true
tailscale serve --bg "$PORT" || echo "  tailscale serve failed — run: sudo tailscale serve --bg $PORT"

echo ""
echo "▸ Agent CLIs (install as $STAN_USER)…"
AGENT_NOTE="$INSTALL_DIR/docs/vps-agents-install.md"
sudo -u "$STAN_USER" mkdir -p "$(dirname "$AGENT_NOTE")"
cat > "$AGENT_NOTE" <<'AGENTS'
# Install agents on VPS (run as your user, not root)

## Claude Code
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

## Codex CLI
```bash
npm install -g @openai/codex
codex login
```

## OpenClaw / Clive
Follow your OpenClaw install docs, then ensure `openclaw` is on PATH.
Set in .env: OPENCLAW_ENABLED=1

Verify: which claude codex openclaw
AGENTS

echo "  See $AGENT_NOTE"

echo ""
echo "═══════════════════════════════════════════"
echo " VPS setup complete"
echo "═══════════════════════════════════════════"
TS_HOST="$(tailscale status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 || echo 'stan-vps.<tailnet>.ts.net')"
echo ""
echo "1. Copy AUTH_TOKEN from $ENV_FILE to Pi .env (same token = one login)"
echo "2. iPhone: Settings → Fallback host → https://${TS_HOST%%.*}.ts.net (check tailscale status)"
echo "3. Install agents: cat $AGENT_NOTE"
echo "4. From Pi: ./scripts/pi-push-to-vps.sh user@stan-vps"
echo "5. Expose: sudo tailscale serve --bg $PORT"
echo ""
tailscale status 2>/dev/null | head -5 || true
