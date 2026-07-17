#!/usr/bin/env bash
# Stan CLI build — install deps, validate, smoke-test server
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "▸ Installing dependencies…"
npm install

echo "▸ Validating shell scripts…"
for f in scripts/*.sh scripts/pi-recovery; do
  [[ -f "$f" ]] || continue
  bash -n "$f"
done

echo "▸ Syntax-checking server…"
for f in server/*.js; do
  node --check "$f"
done

echo "▸ Checking client assets…"
required=(
  public/index.html
  public/app.js
  public/health.js
  public/gpu.js
  public/term.js
  public/styles.css
  public/sw.js
  public/manifest.webmanifest
)
for f in "${required[@]}"; do
  [[ -f "$f" ]] || { echo "Missing: $f"; exit 1; }
done

echo "▸ Smoke-testing server…"
export AUTH_TOKEN="${AUTH_TOKEN:-build-test-token-$(date +%s)}"
export PORT="${PORT:-7420}"
export ROOT_DIR="${ROOT_DIR:-$ROOT}"

node server/index.js &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health/summary" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" >/dev/null 2>&1; then
    echo "  Health API: OK"
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "  Server exited early"
    exit 1
  fi
  sleep 0.2
done

curl -sf "http://127.0.0.1:${PORT}/api/health/summary" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | head -c 120
echo ""
curl -sf -o /dev/null -w "  Static shell: HTTP %{http_code}\n" "http://127.0.0.1:${PORT}/"

echo ""
echo "✓ Build complete"
