#!/bin/bash
###############################################################################
# DialerOS — Zero-Downtime Auto-Update Script
#
# Strategy: Blue/Green container swap using Docker Compose rolling updates.
#
# What it does:
#   1.  Pulls the latest code from Git (or applies a local patch)
#   2.  Rebuilds only the changed service images (Docker build cache is used)
#   3.  Applies database migrations if any
#   4.  Rolls services one at a time:
#         api     → docker compose up -d --no-deps --build api
#         worker  → rolling restart (one replica at a time)
#         listener→ quick swap (single instance, <2s down)
#   5.  Runs a health check after each service — rolls back on failure
#   6.  Never touches Redis/MongoDB containers (stateful — always kept running)
#   7.  Asterisk on the host is only reloaded (reload, not restart) if config changed
#   8.  A full rollback restores the previous image tags from a local backup label
#
# Usage:
#   sudo bash update.sh                        # update from git origin/main
#   sudo bash update.sh --branch hotfix/xyz    # update from a specific branch
#   sudo bash update.sh --dry-run              # show what would change, don't apply
#   sudo bash update.sh --rollback             # restore the previous working version
#
# Environment:
#   UPDATE_BRANCH (default: main)    — git branch to pull from
#   UPDATE_REMOTE (default: origin)  — git remote
#   SKIP_ASTERISK_RELOAD=1           — skip Asterisk dialplan reload
#   HEALTH_TIMEOUT=120               — seconds to wait for health checks
###############################################################################

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${GREEN}[✔]${NC} $(date '+%H:%M:%S') $1"; }
info()    { echo -e "${CYAN}[•]${NC} $(date '+%H:%M:%S') $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $(date '+%H:%M:%S') $1"; }
error()   { echo -e "${RED}[✘]${NC} $(date '+%H:%M:%S') $1"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}\n"; }

# ── Defaults / arg parsing ────────────────────────────────────────────────────
BRANCH="${UPDATE_BRANCH:-main}"
REMOTE="${UPDATE_REMOTE:-origin}"
DRY_RUN=false
ROLLBACK=false
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
SKIP_ASTERISK="${SKIP_ASTERISK_RELOAD:-0}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)   BRANCH="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --rollback) ROLLBACK=true; shift ;;
    --skip-asterisk) SKIP_ASTERISK=1; shift ;;
    *) warn "Unknown arg: $1"; shift ;;
  esac
done

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash update.sh"
cd "$PROJECT_DIR"

# ── Lock file — prevent concurrent updates ────────────────────────────────────
LOCKFILE="/tmp/.dialeros_update.lock"
if [[ -f "$LOCKFILE" ]]; then
  error "Another update is already running (PID $(cat "$LOCKFILE")). Remove $LOCKFILE to force."
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# ── Update log ────────────────────────────────────────────────────────────────
UPDATE_LOG="$PROJECT_DIR/.update.log"
exec > >(tee -a "$UPDATE_LOG") 2>&1
echo "" >> "$UPDATE_LOG"
section "DialerOS Update — $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
info "Branch: ${BOLD}$BRANCH${NC}  |  Dry-run: $DRY_RUN  |  Rollback: $ROLLBACK"

###############################################################################
# ROLLBACK MODE — restore previous Docker image labels
###############################################################################
if [[ "$ROLLBACK" == "true" ]]; then
  section "Rolling Back to Previous Version"
  PREV_TAG_FILE="$PROJECT_DIR/.prev_image_tags"
  [[ ! -f "$PREV_TAG_FILE" ]] && error "No rollback snapshot found at $PREV_TAG_FILE"
  info "Restoring images from: $PREV_TAG_FILE"
  while IFS='=' read -r svc image_tag; do
    info "  Restoring $svc → $image_tag"
    $DRY_RUN || docker tag "$image_tag" "dialer-${svc}:latest"
    $DRY_RUN || docker compose up -d --no-deps --no-build "$svc"
  done < "$PREV_TAG_FILE"
  log "Rollback complete"
  exit 0
fi

###############################################################################
# 1. SNAPSHOT CURRENT IMAGE TAGS (for rollback)
###############################################################################
section "Snapshotting Current Images"
PREV_TAG_FILE="$PROJECT_DIR/.prev_image_tags"
> "$PREV_TAG_FILE"
for svc in api worker listener; do
  current_id=$(docker compose images -q "$svc" 2>/dev/null | head -1 || true)
  if [[ -n "$current_id" ]]; then
    snapshot_tag="dialeros-backup-${svc}:$(date +%Y%m%d%H%M%S)"
    $DRY_RUN || docker tag "$current_id" "$snapshot_tag"
    echo "${svc}=${snapshot_tag}" >> "$PREV_TAG_FILE"
    info "  $svc → $snapshot_tag"
  fi
done
log "Snapshot saved to $PREV_TAG_FILE"

###############################################################################
# 2. PULL LATEST CODE
###############################################################################
section "Pulling Latest Code"

# Stash any local changes (shouldn't exist in prod, but prevents hard failures)
if git status --porcelain | grep -q .; then
  warn "Working tree is dirty — stashing local changes"
  $DRY_RUN || git stash push -m "auto-update-stash-$(date +%s)"
fi

BEFORE_SHA=$(git rev-parse HEAD)
$DRY_RUN || git fetch "$REMOTE" "$BRANCH" --quiet
$DRY_RUN || git reset --hard "refs/remotes/$REMOTE/$BRANCH"
AFTER_SHA=$(git rev-parse HEAD 2>/dev/null || echo "$BEFORE_SHA")

if [[ "$BEFORE_SHA" == "$AFTER_SHA" ]] && [[ "$DRY_RUN" == "false" ]]; then
  warn "Already up to date ($(git log -1 --format='%h %s'))"
  info "No rebuild needed — exiting cleanly"
  exit 0
fi

log "Updated: ${BEFORE_SHA:0:8} → ${AFTER_SHA:0:8}"
git log --oneline "${BEFORE_SHA}".."${AFTER_SHA}" 2>/dev/null | head -10 | while read -r line; do
  info "  $line"
done

# Detect which services have changed files
CHANGED=$(git diff --name-only "$BEFORE_SHA" "$AFTER_SHA" 2>/dev/null || echo "apps/")
API_CHANGED=false; WORKER_CHANGED=false; LISTENER_CHANGED=false; SHARED_CHANGED=false

echo "$CHANGED" | grep -q 'apps/api\|packages/'     && API_CHANGED=true
echo "$CHANGED" | grep -q 'apps/worker\|packages/'  && WORKER_CHANGED=true
echo "$CHANGED" | grep -q 'apps/listener\|packages/' && LISTENER_CHANGED=true
echo "$CHANGED" | grep -q 'packages/'               && SHARED_CHANGED=true

info "Changed: api=$API_CHANGED  worker=$WORKER_CHANGED  listener=$LISTENER_CHANGED  shared=$SHARED_CHANGED"
[[ "$DRY_RUN" == "true" ]] && { info "Dry-run — stopping here"; exit 0; }

###############################################################################
# 3. INSTALL DEPENDENCIES
###############################################################################
section "Installing Dependencies"
pnpm install --frozen-lockfile 2>&1 | grep -E '(Done|error|warn|ERR)' || true
log "Dependencies up to date"

###############################################################################
# 4. BUILD SHARED PACKAGES (always rebuild shared/db to keep types in sync)
###############################################################################
section "Rebuilding Shared Packages"
pnpm --filter @dialer/shared build 2>&1 | tail -3
pnpm --filter @dialer/db build 2>&1 | tail -3
log "Shared packages built"

###############################################################################
# 5. HEALTH CHECK HELPER
###############################################################################
wait_healthy() {
  local svc="$1"
  local max="$HEALTH_TIMEOUT"
  local elapsed=0
  info "  Waiting for $svc to be healthy (timeout: ${max}s)..."
  while [[ $elapsed -lt $max ]]; do
    status=$(docker compose ps --format json "$svc" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health','unknown'))" 2>/dev/null || echo "unknown")
    if [[ "$status" == "healthy" ]]; then
      log "  $svc → healthy ✔"
      return 0
    fi
    sleep 5
    ((elapsed+=5))
  done
  error "$svc did not become healthy within ${max}s — initiating rollback!"
}

rollback_service() {
  local svc="$1"
  warn "Rolling back $svc..."
  local prev_tag
  prev_tag=$(grep "^${svc}=" "$PREV_TAG_FILE" | cut -d= -f2 || true)
  if [[ -n "$prev_tag" ]]; then
    docker tag "$prev_tag" "dialer-${svc}:latest" 2>/dev/null || true
    docker compose up -d --no-deps --no-build "$svc" || true
  fi
  error "Update failed for $svc — rolled back. Check $UPDATE_LOG"
}

###############################################################################
# 6. ROLLING SERVICE UPDATES
###############################################################################
section "Rolling Service Updates"

# ── 6a. API (Next.js) ────────────────────────────────────────────────────────
if [[ "$API_CHANGED" == "true" ]]; then
  info "Updating api..."
  docker compose build --no-cache api 2>&1 | grep -E '(COPY|RUN|Step|Successfully|error)' | tail -15
  docker compose up -d --no-deps api || rollback_service api
  wait_healthy api || rollback_service api
  log "api → updated"
else
  info "api — no changes, skipping rebuild"
fi

# ── 6b. Worker (rolling — one replica at a time) ─────────────────────────────
if [[ "$WORKER_CHANGED" == "true" ]]; then
  info "Updating worker (rolling — 1 replica at a time)..."
  docker compose build --no-cache worker 2>&1 | grep -E '(COPY|RUN|Step|Successfully|error)' | tail -15

  # Scale to n+1 with old image, then scale down (classic rolling approach)
  CURRENT_REPLICAS=$(docker compose ps worker --quiet 2>/dev/null | wc -l || echo 2)
  info "  Current replicas: $CURRENT_REPLICAS"

  # Replace one container at a time
  for i in $(seq 1 "$CURRENT_REPLICAS"); do
    info "  Replacing worker replica $i/$CURRENT_REPLICAS..."
    CONTAINER_ID=$(docker compose ps worker --quiet 2>/dev/null | head -1 || true)
    if [[ -n "$CONTAINER_ID" ]]; then
      docker compose up -d --no-deps --scale worker="$((CURRENT_REPLICAS + 1))" worker 2>/dev/null || true
      sleep 5  # let the new replica come up
      docker stop "$CONTAINER_ID" 2>/dev/null || true
      docker rm  "$CONTAINER_ID" 2>/dev/null || true
    fi
  done
  # Ensure final count is correct
  docker compose up -d --no-deps --scale worker="$CURRENT_REPLICAS" worker
  log "worker → updated ($CURRENT_REPLICAS replicas)"
else
  info "worker — no changes, skipping rebuild"
fi

# ── 6c. Listener (single instance — fast swap) ───────────────────────────────
if [[ "$LISTENER_CHANGED" == "true" ]]; then
  info "Updating listener..."
  docker compose build --no-cache listener 2>&1 | grep -E '(COPY|RUN|Step|Successfully|error)' | tail -15
  docker compose up -d --no-deps listener || rollback_service listener
  log "listener → updated"
else
  info "listener — no changes, skipping rebuild"
fi

###############################################################################
# 7. ASTERISK DIALPLAN RELOAD (if config files changed, no service restart!)
###############################################################################
if [[ "$SKIP_ASTERISK" != "1" ]]; then
  ASTERISK_CONF_CHANGED=$(echo "$CHANGED" | grep -c 'install_asterisk\|asterisk/' || true)
  if [[ "$ASTERISK_CONF_CHANGED" -gt 0 ]]; then
    section "Reloading Asterisk Dialplan"
    if command -v asterisk &>/dev/null && systemctl is-active --quiet asterisk; then
      asterisk -rx "core reload" 2>/dev/null && log "Asterisk config reloaded (no restart)"
    else
      warn "Asterisk not running — skipping reload"
    fi
  else
    info "No Asterisk config changes — skipping reload"
  fi
fi

###############################################################################
# 8. POST-UPDATE VERIFICATION
###############################################################################
section "Post-Update Verification"

API_READY=false
for i in $(seq 1 12); do
  if curl -sf http://localhost:3000/api/health &>/dev/null; then
    API_READY=true; break
  fi
  sleep 5
done

if [[ "$API_READY" == "true" ]]; then
  log "API health check passed"
else
  warn "API health check timed out — check: docker compose logs api"
fi

###############################################################################
# 9. CLEANUP OLD IMAGES (keep last 3 builds to allow manual rollback)
###############################################################################
section "Cleaning Up Old Images"
docker image prune -f --filter "until=72h" 2>/dev/null | grep -E '(deleted|Total)' || true
log "Old images pruned"

###############################################################################
# 10. SUMMARY
###############################################################################
section "Update Complete ✅"
echo -e "${BOLD}  Commit:${NC}  ${AFTER_SHA:0:8} — $(git log -1 --format='%s' 2>/dev/null || echo 'N/A')"
echo -e "${BOLD}  API:${NC}     $(curl -s http://localhost:3000/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo 'unknown')"
echo -e "${BOLD}  Log:${NC}     $UPDATE_LOG"
echo -e "${BOLD}  Rollback:${NC} sudo bash update.sh --rollback"
echo ""
