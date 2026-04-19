#!/bin/bash
###############################################################################
# DialerOS — Cron Auto-Update Installer
#
# Run once after setup.sh to enable scheduled automatic updates.
# This installs a cron job that checks for updates every night at 03:00 AM
# (when call volume is lowest) and applies them with zero downtime.
#
# Usage:
#   sudo bash install_autoupdate.sh
#   sudo bash install_autoupdate.sh --disable    # remove the cron job
#   sudo bash install_autoupdate.sh --status     # show cron status
#   sudo bash install_autoupdate.sh --now        # run update immediately
###############################################################################

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
log()   { echo -e "${GREEN}[✔]${NC} $1"; }
info()  { echo -e "${CYAN}[•]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✘]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install_autoupdate.sh"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_TAG="# DialerOS auto-update"
CRON_JOB="0 3 * * * root bash ${PROJECT_DIR}/update.sh --branch main >> /var/log/dialeros-update.log 2>&1 ${CRON_TAG}"
CRON_FILE="/etc/cron.d/dialeros-autoupdate"

# Parse args
ACTION="${1:-install}"

case "$ACTION" in
  --disable)
    if [[ -f "$CRON_FILE" ]]; then
      rm -f "$CRON_FILE"
      log "Auto-update cron job removed"
    else
      warn "Auto-update cron job was not installed"
    fi
    exit 0
    ;;
  --status)
    if [[ -f "$CRON_FILE" ]]; then
      log "Auto-update cron job is ACTIVE:"
      cat "$CRON_FILE"
    else
      warn "Auto-update cron job is NOT installed"
    fi
    if [[ -f "/var/log/dialeros-update.log" ]]; then
      info "Last 20 lines of update log:"
      tail -20 /var/log/dialeros-update.log
    fi
    exit 0
    ;;
  --now)
    info "Running update now..."
    bash "${PROJECT_DIR}/update.sh" --branch main
    exit 0
    ;;
esac

# ── Install cron job ──────────────────────────────────────────────────────────
info "Installing DialerOS auto-update cron job..."
info "  Project directory: $PROJECT_DIR"
info "  Schedule: daily at 03:00 AM"
info "  Log: /var/log/dialeros-update.log"

# Write the cron file
cat > "$CRON_FILE" <<EOF
# DialerOS automatic zero-downtime updater
# Runs every night at 03:00 AM (server local time)
# Edit schedule: https://crontab.guru
# Disable: sudo bash ${PROJECT_DIR}/install_autoupdate.sh --disable
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

0 3 * * * root UPDATE_BRANCH=main bash ${PROJECT_DIR}/update.sh >> /var/log/dialeros-update.log 2>&1
EOF

chmod 644 "$CRON_FILE"
touch /var/log/dialeros-update.log
chmod 640 /var/log/dialeros-update.log

# Set up log rotation
cat > "/etc/logrotate.d/dialeros-update" <<EOF
/var/log/dialeros-update.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 640 root root
}
EOF

log "Auto-update cron job installed"
log "Schedule: daily at 03:00 AM"
log ""
log "Commands:"
log "  View status:    sudo bash ${PROJECT_DIR}/install_autoupdate.sh --status"
log "  Run now:        sudo bash ${PROJECT_DIR}/install_autoupdate.sh --now"
log "  Disable:        sudo bash ${PROJECT_DIR}/install_autoupdate.sh --disable"
log "  View log:       tail -f /var/log/dialeros-update.log"
log "  Manual update:  sudo bash ${PROJECT_DIR}/update.sh"
log "  Rollback:       sudo bash ${PROJECT_DIR}/update.sh --rollback"
