#!/usr/bin/env bash
# One-time setup on etzal. Run from the laptop:   ssh -p 2222 mydebian 'bash -s' < v2/deploy/setup-server.sh
# Creates the Postgres role + database "crowd" and ~/crowd-intelligent/web/.env (DATABASE_URL, EDGE_TOKEN).
# Safe to run again: existing role, database and .env are left as they are.
set -euo pipefail

APP_DIR="$HOME/crowd-intelligent"
ENV_FILE="$APP_DIR/web/.env"
mkdir -p "$APP_DIR/web"

if [ -f "$ENV_FILE" ]; then
  echo "[setup] $ENV_FILE already exists, keeping it."
  exit 0
fi

DB_PASS=$(openssl rand -hex 24)
EDGE_TOKEN=$(openssl rand -hex 24)

if sudo -u postgres psql -Atc "SELECT 1 FROM pg_roles WHERE rolname = 'crowd'" | grep -q 1; then
  echo "[setup] role 'crowd' exists: resetting its password for the new .env"
  sudo -u postgres psql -q -c "ALTER ROLE crowd WITH LOGIN PASSWORD '$DB_PASS'"
else
  sudo -u postgres psql -q -c "CREATE ROLE crowd WITH LOGIN PASSWORD '$DB_PASS'"
fi
if ! sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname = 'crowd'" | grep -q 1; then
  sudo -u postgres createdb -O crowd crowd
fi

umask 077
cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgresql://crowd:${DB_PASS}@127.0.0.1:5432/crowd
EDGE_TOKEN=${EDGE_TOKEN}
LOG_INTERVAL_S=10
HOST=127.0.0.1
PORT=3020
EOF
chmod 600 "$ENV_FILE"
echo "[setup] database 'crowd' ready, wrote $ENV_FILE"
echo "[setup] read the token for the laptop with:  ssh -p 2222 mydebian 'grep EDGE_TOKEN ~/crowd-intelligent/web/.env'"
