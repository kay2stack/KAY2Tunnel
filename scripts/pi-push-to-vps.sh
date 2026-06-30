#!/usr/bin/env bash
# Sync Pi git projects to VPS over Tailscale SSH (run ON THE PI).
#
# Usage:
#   ./scripts/pi-push-to-vps.sh [user@host] [projects_root]
#
# Or in Pi .env:  VPS_SYNC_TARGET=kay2@stan-vps

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

REMOTE="${1:-${VPS_SYNC_TARGET:-}}"
SRC="${2:-${ROOT_DIR:-$HOME}}"

if [[ -z "$REMOTE" ]]; then
  echo "Usage: $0 user@stan-vps [source_dir]"
  echo "Or set VPS_SYNC_TARGET in .env"
  exit 1
fi

REMOTE_PATH="${VPS_REMOTE_PATH:-projects}"

echo "▸ Finding git repos under $SRC…"
ssh -o ConnectTimeout=10 "$REMOTE" "mkdir -p ~/$REMOTE_PATH"

count=0
for dir in "$SRC"/*; do
  [[ -d "$dir/.git" ]] || continue
  name="$(basename "$dir")"
  echo "  → $name"
  rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.cache' \
    --exclude 'dist' \
    --exclude 'build' \
    "$dir/" "$REMOTE:~/$REMOTE_PATH/$name/"
  count=$((count + 1))
done

if [[ $count -eq 0 ]]; then
  echo "No git repos found. Syncing whole tree (light exclude)…"
  rsync -avz --exclude 'node_modules' --exclude '.git' "$SRC/" "$REMOTE:~/$REMOTE_PATH/"
fi

echo ""
echo "✓ Synced $count repo(s) to $REMOTE:~/$REMOTE_PATH"
