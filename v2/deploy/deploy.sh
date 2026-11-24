#!/usr/bin/env bash
# Deploy the v2 hub (web/) to etzal. Run from the project root in Git Bash:
#   bash v2/deploy/deploy.sh
# First time only, before this:  ssh -p 2222 mydebian 'bash -s' < v2/deploy/setup-server.sh
set -euo pipefail

SSH_HOST="${SSH_HOST:-mydebian}"
SSH_PORT="${SSH_PORT:-2222}"
HERE="$(cd "$(dirname "$0")" && pwd)"
V2="$(dirname "$HERE")"

echo "[deploy] packing web/"
# Old files are removed first (except node_modules, .next and the server's .env), so files
# deleted locally disappear on the server too.
tar -C "$V2/web" --exclude=node_modules --exclude=.next --exclude='.env*' -czf - . \
  | ssh -p "$SSH_PORT" "$SSH_HOST" 'set -e; D=~/crowd-intelligent/web; mkdir -p "$D";
      find "$D" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .next ! -name .env -exec rm -rf {} +;
      tar -C "$D" -xzf -'
scp -q -P "$SSH_PORT" "$HERE/ecosystem.config.cjs" "$SSH_HOST:crowd-intelligent/ecosystem.config.cjs"

ssh -p "$SSH_PORT" "$SSH_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd ~/crowd-intelligent/web
[ -f .env ] || { echo "[deploy] ~/crowd-intelligent/web/.env missing: run setup-server.sh first"; exit 1; }
echo "[deploy] npm ci"
npm ci --no-audit --no-fund --loglevel=error
echo "[deploy] next build"
NEXT_TELEMETRY_DISABLED=1 npx next build > /tmp/crowd-build.log 2>&1 || { tail -40 /tmp/crowd-build.log; exit 1; }
tail -5 /tmp/crowd-build.log
cd ~/crowd-intelligent
pm2 startOrReload ecosystem.config.cjs --only crowd-web
pm2 describe crowd-tunnel > /dev/null 2>&1 || pm2 start ecosystem.config.cjs --only crowd-tunnel
pm2 save > /dev/null
sleep 3
curl -fsS http://127.0.0.1:3020/live/health && echo
URL=$(pm2 logs crowd-tunnel --lines 400 --nostream 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
echo "[deploy] done. Public URL: ${URL:-see 'pm2 logs crowd-tunnel'}"
REMOTE
