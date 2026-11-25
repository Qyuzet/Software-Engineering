#!/usr/bin/env bash
# Continuous deployment of the worker. Runs on etzal as pm2 app "crowd-autodeploy".
#
# Every CHECK_EVERY_S seconds it fetches DEPLOY_BRANCH of REPO_URL (both set in
# ~/crowd-intelligent/autodeploy.env). When v2/worker or the pm2 config changed, worker-release.sh
# installs it: npm ci, tests, swap, health check, automatic rollback.
# The repo is public, so this needs no GitHub key on the server and no server key on GitHub.
#
#   deploy now:      pm2 restart crowd-autodeploy
#   watch:           pm2 logs crowd-autodeploy
#   other branch:    edit ~/crowd-intelligent/autodeploy.env, then pm2 restart crowd-autodeploy
#
# Everything runs inside functions, so bash has read the whole file before a checkout replaces it.

log() { echo "[autodeploy $(date -u '+%F %T')] $*"; }

# A new release is needed when either of these changes (other commits are ignored)
release_id() {
  git -C "$REPO" rev-parse "$1:v2/worker" "$1:v2/deploy/ecosystem.config.cjs" | tr '\n' ' '
}

check() {
  if ! git -C "$REPO" fetch -q --depth 1 origin "$DEPLOY_BRANCH" 2> "$BASE/.fetch.err"; then
    log "git fetch failed: $(tail -n 1 "$BASE/.fetch.err")"
    return 1
  fi
  local commit id
  commit=$(git -C "$REPO" rev-parse FETCH_HEAD)
  if [ "$commit" != "$(git -C "$REPO" rev-parse HEAD)" ]; then
    git -C "$REPO" checkout -q --force --detach FETCH_HEAD
  fi
  id=$(release_id "$commit")
  if [ "$id" = "$(sed -n 2p "$BASE/worker/REVISION" 2> /dev/null)" ]; then return 0; fi
  if [ "$id" = "$(cat "$BASE/autodeploy.failed" 2> /dev/null)" ]; then return 0; fi  # waits for a fix

  log "new worker version ${commit:0:7} on $DEPLOY_BRANCH"
  cp "$REPO/v2/deploy/ecosystem.config.cjs" "$BASE/ecosystem.config.cjs"
  if RELEASE_ID="$id" bash "$REPO/v2/deploy/worker-release.sh" "$REPO/v2/worker" "$commit"; then
    rm -f "$BASE/autodeploy.failed"
  else
    echo "$id" > "$BASE/autodeploy.failed"
    log "release failed; the previous version keeps running. Push a fix to try again."
  fi
}

main() {
  BASE="${CROWD_BASE:-$HOME/crowd-intelligent}"
  REPO="$BASE/repo"
  # shellcheck source=/dev/null
  . "$BASE/autodeploy.env"
  REPO_URL="${REPO_URL:?REPO_URL is missing in autodeploy.env}"
  DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"
  CHECK_EVERY_S="${CHECK_EVERY_S:-60}"
  git -C "$REPO" remote set-url origin "$REPO_URL"

  local self sum
  self=$(readlink -f "$0")
  sum=$(sha1sum < "$self")
  log "watching $DEPLOY_BRANCH of $REPO_URL every ${CHECK_EVERY_S}s"
  while true; do
    check || true
    if [ "$(sha1sum < "$self")" != "$sum" ]; then
      log "autodeploy.sh itself was updated: restarting"
      exit 0                                   # pm2 starts the new version
    fi
    sleep "$CHECK_EVERY_S"
  done
}

main "$@"
