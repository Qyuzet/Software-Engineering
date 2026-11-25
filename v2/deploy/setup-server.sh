#!/usr/bin/env bash
# Sets up (or repairs) the crowd worker on etzal. Safe to run again. From the laptop:
#   ssh -p 2222 mydebian 'bash -s' < v2/deploy/setup-server.sh
# Another repo or branch:
#   ssh -p 2222 mydebian 'REPO_URL=https://github.com/<you>/<repo>.git DEPLOY_BRANCH=main bash -s' < v2/deploy/setup-server.sh
#
# Only crowd-* things are touched; other projects' pm2 apps are left alone.
#  1. Postgres role + database "crowd"; worker settings in ~/crowd-intelligent/worker.env (chmod 600)
#  2. a small checkout of the GitHub repo (only v2/worker and v2/deploy) in ~/crowd-intelligent/repo
#  3. pm2: crowd-autodeploy (releases the worker now and after every push), crowd-worker
#     (started by that first release) and crowd-tunnel (quick public URL)
set -euo pipefail

BASE="$HOME/crowd-intelligent"
ENV_FILE="$BASE/worker.env"
CD_FILE="$BASE/autodeploy.env"
REPO="$BASE/repo"
mkdir -p "$BASE"
log() { echo "[setup] $*"; }

# ---------------- 1. database + worker settings ----------------
if [ ! -f "$ENV_FILE" ] && [ -f "$BASE/web/.env" ]; then
  # v2.0 kept them in web/.env: reuse them so the laptop's EDGE_TOKEN stays valid
  (umask 077 && grep -E '^(DATABASE_URL|EDGE_TOKEN|LOG_INTERVAL_S|HOST|PORT)=' "$BASE/web/.env" > "$ENV_FILE")
  echo "CORS_ORIGINS=*" >> "$ENV_FILE"
  log "moved the settings from web/.env to worker.env"
fi
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS=$(openssl rand -hex 24)
  EDGE_TOKEN=$(openssl rand -hex 24)
  if sudo -u postgres psql -Atc "SELECT 1 FROM pg_roles WHERE rolname = 'crowd'" | grep -q 1; then
    log "role 'crowd' exists: resetting its password for the new worker.env"
    sudo -u postgres psql -q -c "ALTER ROLE crowd WITH LOGIN PASSWORD '$DB_PASS'"
  else
    sudo -u postgres psql -q -c "CREATE ROLE crowd WITH LOGIN PASSWORD '$DB_PASS'"
  fi
  if ! sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname = 'crowd'" | grep -q 1; then
    sudo -u postgres createdb -O crowd crowd
  fi
  (umask 077 && cat > "$ENV_FILE" << EOF
DATABASE_URL=postgresql://crowd:${DB_PASS}@127.0.0.1:5432/crowd
EDGE_TOKEN=${EDGE_TOKEN}
LOG_INTERVAL_S=10
CORS_ORIGINS=*
HOST=127.0.0.1
PORT=3020
EOF
  )
  log "database 'crowd' ready, wrote $ENV_FILE"
fi
chmod 600 "$ENV_FILE"
PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)
PORT="${PORT:-3020}"

# ---------------- 2. CD settings + repo checkout ----------------
want_repo="${REPO_URL:-}"
want_branch="${DEPLOY_BRANCH:-}"
if [ -f "$CD_FILE" ]; then
  # shellcheck source=/dev/null
  . "$CD_FILE"
fi
REPO_URL="${want_repo:-${REPO_URL:-https://github.com/Qyuzet/Software-Engineering.git}}"
DEPLOY_BRANCH="${want_branch:-${DEPLOY_BRANCH:-master}}"
printf 'REPO_URL=%s\nDEPLOY_BRANCH=%s\nCHECK_EVERY_S=%s\n' "$REPO_URL" "$DEPLOY_BRANCH" "${CHECK_EVERY_S:-60}" > "$CD_FILE"

if [ ! -d "$REPO/.git" ]; then
  git clone -q --filter=blob:none --depth 1 --no-checkout --branch "$DEPLOY_BRANCH" "$REPO_URL" "$REPO"
  git -C "$REPO" sparse-checkout set --cone v2/worker v2/deploy
fi
git -C "$REPO" remote set-url origin "$REPO_URL"
git -C "$REPO" fetch -q --depth 1 origin "$DEPLOY_BRANCH"
git -C "$REPO" checkout -q --force --detach FETCH_HEAD
COMMIT=$(git -C "$REPO" rev-parse HEAD)
cp "$REPO/v2/deploy/ecosystem.config.cjs" "$BASE/ecosystem.config.cjs"
log "repo: $REPO_URL ($DEPLOY_BRANCH, ${COMMIT:0:7})"

# ---------------- 3. pm2 apps ----------------
# v2.0 ran the dashboard here as crowd-web on the same port. The dashboard is on Vercel now.
# Stopped, not deleted: this server's rule is to never `pm2 delete`.
if pm2 describe crowd-web > /dev/null 2>&1; then
  pm2 stop crowd-web > /dev/null
  log "stopped crowd-web (old dashboard; remove it with 'pm2 delete crowd-web' if you want)"
fi
if ! pm2 describe crowd-tunnel > /dev/null 2>&1; then
  pm2 start "$BASE/ecosystem.config.cjs" --only crowd-tunnel > /dev/null
fi
if pm2 describe crowd-autodeploy > /dev/null 2>&1; then
  pm2 restart crowd-autodeploy --update-env > /dev/null
else
  pm2 start "$BASE/ecosystem.config.cjs" --only crowd-autodeploy > /dev/null
fi
pm2 save > /dev/null

log "waiting for the first release (npm ci + tests, about a minute)"
ok=0
for _ in $(seq 90); do
  sleep 2
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/live/health" 2> /dev/null | grep -q "\"version\":\"$COMMIT\""; then
    ok=1
    break
  fi
done
if [ "$ok" = 0 ]; then
  pm2 logs crowd-autodeploy --lines 40 --nostream
  log "the worker did not come up; see the log above"
  exit 1
fi
log "worker ${COMMIT:0:7} is live on 127.0.0.1:$PORT"

# The old v2.0 dashboard build (~700 MB) is no longer used; its settings were moved above.
if [ -d "$BASE/web" ] && grep -q '^EDGE_TOKEN=.' "$ENV_FILE"; then
  rm -rf "$BASE/web"
  log "removed the old web/ build"
fi
URL=$(pm2 logs crowd-tunnel --lines 400 --nostream 2> /dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -n 1 || true)
log "quick tunnel: ${URL:-see 'pm2 logs crowd-tunnel'}"
log "laptop token: grep EDGE_TOKEN ~/crowd-intelligent/worker.env"
