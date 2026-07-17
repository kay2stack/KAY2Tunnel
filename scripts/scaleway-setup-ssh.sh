#!/usr/bin/env bash
# Register SSH key with Scaleway via API + optional instance check
#
# Required in .env or environment:
#   SCW_SECRET_KEY=...          # UUID secret from Scaleway API keys page
#   SCW_PROJECT_ID=...          # KeyStudios project UUID (console → Project settings)
#
# Optional:
#   SCW_ACCESS_KEY=...          # 20-char access key (for scw CLI)
#   STAN_SSH_PUBLIC_KEY_FILE=...  # default: generates new key in ~/.stan-vast/scaleway
#
# Usage:
#   ./scripts/scaleway-setup-ssh.sh
#   ./scripts/scaleway-setup-ssh.sh --print-private   # show private key for Termius import

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="${HOME}/.stan-vast"
PRIV="${KEY_DIR}/scaleway_ed25519"
PUB="${PRIV}.pub"
PRINT_PRIVATE=false

[[ "${1:-}" == "--print-private" ]] && PRINT_PRIVATE=true

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${SCW_SECRET_KEY:?Set SCW_SECRET_KEY in .env}"
: "${SCW_PROJECT_ID:?Set SCW_PROJECT_ID — find in Scaleway console → Project → Settings → ID}"

mkdir -p "$KEY_DIR"
if [[ ! -f "$PUB" ]]; then
  echo "▸ Generating SSH key pair in $KEY_DIR"
  ssh-keygen -t ed25519 -f "$PRIV" -N "" -C "stan-vps-termius"
fi

PUBKEY="$(cat "$PUB")"
NAME="stan-vps-termius-$(date +%Y%m%d)"

echo "▸ Registering SSH key with Scaleway..."
RESP=$(curl -s -X POST \
  -H "X-Auth-Token: $SCW_SECRET_KEY" \
  -H "Content-Type: application/json" \
  "https://api.scaleway.com/iam/v1alpha1/ssh-keys" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'name':sys.argv[1],'public_key':sys.argv[2],'project_id':sys.argv[3]}))" "$NAME" "$PUBKEY" "$SCW_PROJECT_ID")")

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"

if echo "$RESP" | grep -q '"id"'; then
  echo ""
  echo "✓ SSH key registered. Create your instance in console (select this key)."
  echo "  Public key file: $PUB"
  echo "  Private key file: $PRIV  → import to Termius"
fi

echo ""
echo "▸ Checking instances (fr-par-1)..."
curl -s -H "X-Auth-Token: $SCW_SECRET_KEY" \
  "https://api.scaleway.com/instance/v1/zones/fr-par-1/servers" | python3 -m json.tool 2>/dev/null || true

if $PRINT_PRIVATE; then
  echo ""
  echo "── Private key (import to Termius → Keychain → Import) ──"
  cat "$PRIV"
  echo "── end ──"
fi
