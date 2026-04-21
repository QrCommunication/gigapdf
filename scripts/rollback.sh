#!/bin/bash
# =============================================================================
# GigaPDF Rollback Script
# Reverts to the last known-good build snapshot stored in /opt/gigapdf-backup
#
# Usage:
#   sudo bash /opt/gigapdf/scripts/rollback.sh
#   sudo bash /opt/gigapdf/scripts/rollback.sh --list      # list available snapshots
#   sudo bash /opt/gigapdf/scripts/rollback.sh <timestamp>  # rollback to specific snapshot
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APP_DIR="/opt/gigapdf"
SNAPSHOT_BASE="/opt/gigapdf-snapshots"
LOG_FILE="/var/log/gigapdf/rollback.log"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()      { echo -e "${GREEN}[ROLLBACK]${NC} $1" | tee -a "$LOG_FILE"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC}     $1" | tee -a "$LOG_FILE"; }
log_error(){ echo -e "${RED}[ERROR]${NC}    $1" | tee -a "$LOG_FILE"; }
log_info() { echo -e "${CYAN}[INFO]${NC}     $1" | tee -a "$LOG_FILE"; }

mkdir -p "$(dirname "$LOG_FILE")"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

list_snapshots() {
    if [ ! -d "$SNAPSHOT_BASE" ] || [ -z "$(ls -A "$SNAPSHOT_BASE" 2>/dev/null)" ]; then
        log_warn "No snapshots found in $SNAPSHOT_BASE"
        exit 0
    fi
    log_info "Available snapshots:"
    ls -1t "$SNAPSHOT_BASE" | while read -r snap; do
        local marker=""
        if [ -L "$SNAPSHOT_BASE/latest" ] && [ "$(readlink "$SNAPSHOT_BASE/latest")" = "$SNAPSHOT_BASE/$snap" ]; then
            marker=" <- latest"
        fi
        echo "  $snap$marker"
    done
}

get_latest_snapshot() {
    if [ -L "$SNAPSHOT_BASE/latest" ] && [ -d "$SNAPSHOT_BASE/latest" ]; then
        readlink "$SNAPSHOT_BASE/latest"
    else
        # Fallback: pick most recent directory by name (sorted)
        ls -1dt "$SNAPSHOT_BASE"/[0-9]* 2>/dev/null | head -1 || true
    fi
}

stop_services() {
    log "Stopping application services..."
    sudo systemctl stop gigapdf-api          || log_warn "gigapdf-api was not running"
    sudo systemctl stop gigapdf-web          || log_warn "gigapdf-web was not running"
    sudo systemctl stop gigapdf-admin        || log_warn "gigapdf-admin was not running"
    sudo systemctl stop gigapdf-celery       || log_warn "gigapdf-celery was not running"
    sudo systemctl stop gigapdf-celery-billing || log_warn "gigapdf-celery-billing was not running"
}

start_services() {
    log "Starting application services..."
    sudo systemctl start gigapdf-api
    sudo systemctl start gigapdf-web
    sudo systemctl start gigapdf-admin
    sudo systemctl start gigapdf-celery
    sudo systemctl start gigapdf-celery-billing
}

restore_snapshot() {
    local snapshot_dir="$1"

    log "Restoring snapshot: $snapshot_dir"
    log_info "Source : $snapshot_dir"
    log_info "Target : $APP_DIR"

    # Safety: archive the broken current state for forensics (non-blocking)
    local broken_dir="/tmp/gigapdf-broken-$(date +%s)"
    log_info "Archiving broken state to $broken_dir ..."
    cp -a "$APP_DIR/." "$broken_dir" 2>/dev/null || log_warn "Could not archive broken state (non-fatal)"

    # Restore build artefacts only (not .env, not .venv which stay in place)
    # We restore: apps/web/.next, apps/admin/.next, packages/*/dist
    log "Restoring Next.js build artefacts..."
    rsync -a --delete \
        "$snapshot_dir/apps/web/.next/"  "$APP_DIR/apps/web/.next/" \
        2>/dev/null || { log_error "Failed to restore apps/web/.next"; return 1; }

    rsync -a --delete \
        "$snapshot_dir/apps/admin/.next/" "$APP_DIR/apps/admin/.next/" \
        2>/dev/null || { log_error "Failed to restore apps/admin/.next"; return 1; }

    if [ -d "$snapshot_dir/packages" ]; then
        log "Restoring package build artefacts..."
        rsync -a \
            "$snapshot_dir/packages/" "$APP_DIR/packages/" \
            2>/dev/null || log_warn "Package restore had warnings (non-fatal)"
    fi

    log "Snapshot restored successfully."
}

health_check_api() {
    local retries=12
    local delay=5
    log_info "Waiting for API to become healthy (max $((retries * delay))s)..."
    for i in $(seq 1 "$retries"); do
        if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
            log "API health check passed."
            return 0
        fi
        echo -n "."
        sleep "$delay"
    done
    echo ""
    log_error "API failed to become healthy after rollback."
    return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

TS="$(date '+%Y-%m-%d %H:%M:%S')"
echo ""
log "============================================"
log "  GigaPDF Rollback — $TS"
log "============================================"

# Parse arguments
NON_INTERACTIVE=false
POSITIONAL_ARG=""

for arg in "$@"; do
    case "$arg" in
        --list|-l)
            list_snapshots
            exit 0
            ;;
        --non-interactive|-y)
            NON_INTERACTIVE=true
            ;;
        -*)
            log_warn "Unknown flag: $arg (ignored)"
            ;;
        *)
            POSITIONAL_ARG="$arg"
            ;;
    esac
done

if [ -n "$POSITIONAL_ARG" ]; then
    TARGET_SNAPSHOT="$SNAPSHOT_BASE/$POSITIONAL_ARG"
    if [ ! -d "$TARGET_SNAPSHOT" ]; then
        log_error "Snapshot not found: $TARGET_SNAPSHOT"
        list_snapshots
        exit 1
    fi
else
    TARGET_SNAPSHOT="$(get_latest_snapshot)"
    if [ -z "$TARGET_SNAPSHOT" ] || [ ! -d "$TARGET_SNAPSHOT" ]; then
        log_error "No snapshot found. Cannot rollback."
        log_info "Deploy at least once with the new deploy.sh to create snapshots."
        exit 1
    fi
fi

log_info "Rolling back to: $TARGET_SNAPSHOT"

# Confirm (non-interactive mode skips this)
if [ "$NON_INTERACTIVE" = false ] && [ -t 0 ]; then
    echo -e "${YELLOW}This will restart all services. Continue? [y/N]${NC} " && read -r answer
    [[ "$answer" =~ ^[Yy]$ ]] || { log "Rollback cancelled."; exit 0; }
fi

stop_services
restore_snapshot "$TARGET_SNAPSHOT"
start_services

# Give services time to boot
sleep 5
if health_check_api; then
    log "============================================"
    log "  Rollback COMPLETE — services are live"
    log "============================================"
    echo ""
else
    log_error "============================================"
    log_error "  Rollback FAILED — API not responding"
    log_error "  Check: journalctl -u gigapdf-api -n 50"
    log_error "============================================"
    exit 1
fi
