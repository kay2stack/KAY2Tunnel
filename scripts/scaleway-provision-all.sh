#!/usr/bin/env bash
# One-shot Scaleway VPS — no iPhone SSH needed.
# Run from Pi, laptop, or cloud agent when you have API access.
#
# Required env (.env):
#   SCW_SECRET_KEY=...           # Scaleway secret (UUID)
#   SCW_PROJECT_ID=...           # KeyStudios project UUID
#   TAILSCALE_AUTHKEY=...         # Reusable key from tailscale.com/admin/settings/keys
#   AUTH_TOKEN=...                # Stan CLI token (same as Pi when synced)
#
# Optional:
#   SCW_ZONE=fr-par-1
#   SCW_COMMERCIAL_TYPE=BASIC1-X2C-8G
#   SCW_INSTANCE_NAME=stan-vps
#
# Usage: ./scripts/scaleway-provision-all.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="${HOME}/.stan-vast"
PRIV="${KEY_DIR}/scaleway_ed25519"
PUB="${PRIV}.pub"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${SCW_SECRET_KEY:?SCW_SECRET_KEY required}"
: "${SCW_PROJECT_ID:?SCW_PROJECT_ID required — copy from Scaleway → Project settings}"
: "${TAILSCALE_AUTHKEY:?TAILSCALE_AUTHKEY required — create at tailscale.com/admin/settings/keys}"
: "${AUTH_TOKEN:?AUTH_TOKEN required for Stan CLI}"

ZONE="${SCW_ZONE:-fr-par-1}"
TYPE="${SCW_COMMERCIAL_TYPE:-BASIC1-X2C-8G}"
NAME="${SCW_INSTANCE_NAME:-stan-vps}"

api() {
  local method=$1 path=$2
  shift 2
  curl -s -X "$method" \
    -H "X-Auth-Token: $SCW_SECRET_KEY" \
    -H "Content-Type: application/json" \
    "$@" \
    "https://api.scaleway.com${path}"
}

mkdir -p "$KEY_DIR"
if [[ ! -f "$PUB" ]]; then
  echo "▸ Generating SSH key..."
  ssh-keygen -t ed25519 -f "$PRIV" -N "" -C "stan-vps-auto"
fi
PUBKEY="$(cat "$PUB")"

echo "▸ Registering SSH key..."
KEY_RESP=$(api POST /iam/v1alpha1/ssh-keys -d "$(python3 <<PY
import json, os
print(json.dumps({
  "name": "stan-vps-auto",
  "public_key": open("$PUB").read().strip(),
  "project_id": os.environ["SCW_PROJECT_ID"],
}))
PY
)")

SSH_KEY_ID=$(echo "$KEY_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)
if [[ -z "$SSH_KEY_ID" ]]; then
  echo "SSH key response: $KEY_RESP"
  echo "If key already exists, continuing..."
fi

echo "▸ Creating instance $NAME ($TYPE in $ZONE)..."
CREATE_RESP=$(api POST "/instance/v1/zones/${ZONE}/servers" -d "$(python3 <<PY
import json, os
print(json.dumps({
  "name": os.environ["NAME"],
  "project": os.environ["SCW_PROJECT_ID"],
  "commercial_type": os.environ["TYPE"],
  "dynamic_ip_required": True,
  "image": "ubuntu_noble",
  "enable_ipv6": True,
  "tags": ["stan-cli"],
}))
PY
)")

SERVER_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('server',{}).get('id',''))" 2>/dev/null || true)
if [[ -z "$SERVER_ID" ]]; then
  echo "Create failed: $CREATE_RESP"
  exit 1
fi
echo "  Server ID: $SERVER_ID"

CLOUD_INIT="#cloud-config
package_update: true
packages:
  - curl
  - git
  - build-essential
write_files:
  - path: /root/stan.env
    permissions: '0600'
    content: |
      AUTH_TOKEN=${AUTH_TOKEN}
      HOST_ROLE=vps
      HOST_NAME=stan-vps
      PORT=7420
      ROOT_DIR=/root/projects
      TAILSCALE_AUTHKEY=${TAILSCALE_AUTHKEY}
runcmd:
  - curl -fsSL https://tailscale.com/install.sh | sh
  - tailscale up --auth-key=${TAILSCALE_AUTHKEY} --hostname=stan-vps --ssh
  - curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  - apt-get install -y nodejs
  - npm install -g pm2
  - git clone https://github.com/kay2stack/KAY2Tunnel.git /root/KAY2Tunnel || (cd /root/KAY2Tunnel && git pull)
  - cp /root/stan.env /root/KAY2Tunnel/.env
  - cd /root/KAY2Tunnel && npm install && npm run build
  - cd /root/KAY2Tunnel && pm2 start ecosystem.config.js && pm2 save
  - tailscale serve --bg 7420
  - echo done > /root/stan-ready.txt
"

echo "▸ Uploading cloud-init..."
# cloud-init user data is raw body, not JSON
curl -s -X POST \
  -H "X-Auth-Token: $SCW_SECRET_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "$CLOUD_INIT" \
  "https://api.scaleway.com/instance/v1/zones/${ZONE}/servers/${SERVER_ID}/user_data/cloud-init" >/dev/null || \
curl -s -X PUT \
  -H "X-Auth-Token: $SCW_SECRET_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "$CLOUD_INIT" \
  "https://api.scaleway.com/instance/v1/zones/${ZONE}/servers/${SERVER_ID}/user_data/cloud-init" >/dev/null

echo "▸ Waiting for boot (2–4 min)..."
for i in $(seq 1 24); do
  IP=$(api GET "/instance/v1/zones/${ZONE}/servers/${SERVER_ID}" | python3 -c "
import sys,json
s=json.load(sys.stdin).get('server',{})
print(s.get('public_ip',{}).get('address','') or '')
" 2>/dev/null || true)
  STATE=$(api GET "/instance/v1/zones/${ZONE}/servers/${SERVER_ID}" | python3 -c "
import sys,json
print(json.load(sys.stdin).get('server',{}).get('state',''))
" 2>/dev/null || true)
  echo "  [$i] state=$STATE ip=${IP:-pending}"
  [[ "$STATE" == "running" && -n "$IP" ]] && break
  sleep 10
done

echo ""
echo "══════════════════════════════════════════"
echo " VPS provisioning started"
echo "══════════════════════════════════════════"
echo "  Instance: $NAME ($SERVER_ID)"
echo "  Zone:     $ZONE"
echo "  Public IP: ${IP:-check Scaleway console}"
echo ""
echo "Wait ~5 min for cloud-init, then on iPhone:"
echo "  1. Open Tailscale — look for stan-vps"
echo "  2. Safari → https://stan-vps.<your-tailnet>.ts.net"
echo "  3. Enter AUTH_TOKEN from .env"
echo "  4. Settings → Fallback host → same URL"
echo ""
echo "No SSH from iPhone required."
