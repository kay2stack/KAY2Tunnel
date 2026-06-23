#!/usr/bin/env bash
# Nightly backup — snapshots the things that are painful to lose and easy to forget:
# Claude memory, Hermes config + cron, the user crontab, and StanCLI's .env. Writes a
# timestamped tarball to ~/backups and prunes anything older than RETAIN_DAYS.
# Quiet on success (it's nightly); pushes only if the backup fails.
set -uo pipefail

DEST=${BACKUP_DIR:-$HOME/backups}
RETAIN_DAYS=${RETAIN_DAYS:-14}
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# Claude memory (the self-improving knowledge base)
MEM="$HOME/.claude/projects/-home-kay2-KAY2Tunnel/memory"
[ -d "$MEM" ] && cp -r "$MEM" "$STAGE/claude-memory" 2>/dev/null

# Hermes config + cron jobs
if [ -d "$HOME/.hermes" ]; then
  mkdir -p "$STAGE/hermes"
  cp "$HOME/.hermes/config.yaml" "$STAGE/hermes/" 2>/dev/null
  cp -r "$HOME/.hermes/cron" "$STAGE/hermes/" 2>/dev/null
fi

# user crontab + StanCLI env
crontab -l > "$STAGE/crontab.txt" 2>/dev/null
[ -f "$HOME/KAY2Tunnel/.env" ] && cp "$HOME/KAY2Tunnel/.env" "$STAGE/stancli.env" 2>/dev/null

OUT="$DEST/kay2-backup-$STAMP.tar.gz"
if ! tar czf "$OUT" -C "$STAGE" . 2>/dev/null; then
  echo "@@PUSH: 💾 Nightly backup FAILED to write $OUT"
  exit 2
fi

# prune old backups
find "$DEST" -name 'kay2-backup-*.tar.gz' -type f -mtime +"$RETAIN_DAYS" -delete 2>/dev/null

size=$(du -h "$OUT" | awk '{print $1}')
count=$(find "$DEST" -name 'kay2-backup-*.tar.gz' | wc -l | tr -d ' ')
echo "@@QUIET"
echo "backup: wrote $OUT ($size); $count kept"
