#!/usr/bin/env bash
# Installs one worker version on etzal, safely:
#   copy -> npm ci -> npm test -> swap folders -> pm2 reload -> health check (must report this version)
#   -> if it is not healthy: put the previous folder back and reload that.
# Usage: worker-release.sh <worker source folder> <revision>      (autodeploy.sh calls it)
set -euo pipefail

SRC=$(cd "$1" && pwd)
REV="$2"
BASE="${CROWD_BASE:-$HOME/crowd-intelligent}"
LIVE="$BASE/worker"
STAGE="$BASE/worker.stage"
PREV="$BASE/worker.prev"
PORT=$(sed -n 's/^PORT=//p' "$BASE/worker.env" | tail -1)
PORT="${PORT:-3020}"
log() { echo "[release $(date -u +%T)] $*"; }

exec 9> "$BASE/.release.lock"
flock -n 9 || { log "another release is running"; exit 1; }

fail() {
  log "$1: keeping the running version"
  rm -rf "$STAGE"
  exit 1
}

log "preparing ${REV:0:7}"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -C "$SRC" --exclude=node_modules --exclude=.env -cf - . | tar -C "$STAGE" -xf -
(cd "$STAGE" && npm ci --omit=dev --no-audit --no-fund --loglevel=error) || fail "npm ci failed"
log "running tests"
if ! (cd "$STAGE" && npm test > "$BASE/release-test.log" 2>&1); then
  tail -n 40 "$BASE/release-test.log"
  fail "tests failed"
fi
printf '%s\n%s\n' "$REV" "${RELEASE_ID:-}" > "$STAGE/REVISION"

had_app=0
if pm2 describe crowd-worker > /dev/null 2>&1; then had_app=1; fi

rm -rf "$PREV"
if [ -d "$LIVE" ]; then mv "$LIVE" "$PREV"; fi
mv "$STAGE" "$LIVE"
pm2 startOrReload "$BASE/ecosystem.config.cjs" --only crowd-worker --update-env > /dev/null

healthy() {
  curl -fsS --max-time 2 "http://127.0.0.1:$PORT/live/health" 2> /dev/null | grep -q "\"version\":\"$REV\""
}
for _ in $(seq 30); do
  sleep 1
  if healthy; then break; fi
done

if healthy; then
  if [ "$had_app" = 0 ]; then pm2 save > /dev/null; fi   # first start: bring it back after a reboot
  log "live: ${REV:0:7} on 127.0.0.1:$PORT"
  exit 0
fi

log "health check failed"
pm2 logs crowd-worker --lines 30 --nostream 2>&1 | tail -n 30 || true
if [ -d "$PREV" ]; then
  rm -rf "$LIVE"
  mv "$PREV" "$LIVE"
  pm2 startOrReload "$BASE/ecosystem.config.cjs" --only crowd-worker --update-env > /dev/null
  log "rolled back to $(head -n 1 "$LIVE/REVISION" 2> /dev/null || echo 'the previous version')"
fi
exit 1
