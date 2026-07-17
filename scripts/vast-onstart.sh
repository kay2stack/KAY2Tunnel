#!/bin/bash
# Stan CLI — vast.ai onstart (runs inside GPU container, <4KB)
set -e
export OLLAMA_MODEL="${OLLAMA_MODEL:-__OLLAMA_MODEL__}"
LOG=/workspace/stan-onstart.log
exec > >(tee -a "$LOG") 2>&1
echo "=== stan vast-onstart $(date -Is) ==="
apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null 2>&1 || true
# Tailscale (userspace — no TUN in Docker)
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
pkill tailscaled 2>/dev/null || true
/usr/sbin/tailscaled --tun=userspace-networking --state=/workspace/tailscale.state --socket=/workspace/tailscaled.sock &
sleep 4
if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
  tailscale --socket=/workspace/tailscaled.sock up --auth-key="$TAILSCALE_AUTHKEY" --hostname=stan-gpu --ssh --accept-routes
else
  tailscale --socket=/workspace/tailscaled.sock up --hostname=stan-gpu --ssh 2>&1 | tee /workspace/tailscale-auth-url.txt || true
fi
# Ollama + model
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
pkill ollama 2>/dev/null || true
nohup ollama serve >/workspace/ollama.log 2>&1 &
sleep 3
ollama pull "$OLLAMA_MODEL" || true
echo "=== done: tailscale + ollama ($OLLAMA_MODEL) ==="
