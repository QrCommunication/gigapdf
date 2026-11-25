#!/bin/bash
# =============================================================================
# GigaPDF — PostgreSQL Restore Script
#
# Downloads a backup from S3 and restores it to PostgreSQL.
# Supports dry-run mode and produces a verification report.
#
# Usage:
#   # List available backups
#   ./scripts/restore-postgres.sh --list
#
#   # Restore the latest daily backup (DRY RUN — no data is modified)
#   ./scripts/restore-postgres.sh --dry-run
#
#   # Restore a specific backup file
#   ./scripts/restore-postgres.sh --file gigapdf_daily_20260421_030000.sql.gz
#
#   # Restore the latest daily backup to a DIFFERENT database (safe test)
#   ./scripts/restore-postgres.sh --target-db gigapdf_restore_test
#
#   # Full restore to production (DESTRUCTIVE — use with extreme caution)
#   ./scripts/restore-postgres.sh --confirm-production
#
# Required environment variables: same as backup-postgres.sh
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Load environment
# ---------------------------------------------------------------------------
ENV_FILE="${ENV_FILE:-/opt/gigapdf/.env}"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
fi

# ---------------------------------------------------------------------------
# 1. Argument parsing
# ---------------------------------------------------------------------------
MODE="dry-run"
BACKUP_FILE_KEY=""
TARGET_DB_OVERRIDE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --list)             MODE="list"; shift ;;
        --dry-run)          MODE="dry-run"; shift ;;
        --confirm-production) MODE="production"; shift ;;
        --file)             BACKUP_FILE_KEY="$2"; shift 2 ;;
        --target-db)        TARGET_DB_OVERRIDE="$2"; shift 2 ;;
        -h|--help)
            sed -n '4,28p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# 2. Configuration
# ---------------------------------------------------------------------------
RESTORE_DIR="${RESTORE_TEMP_DIR:-/tmp/gigapdf-restore}"
LOG_TAG="gigapdf-restore"

# Parse DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
    echo "[ERROR] DATABASE_URL is not set" >&2; exit 1
fi

_url="${DATABASE_URL#postgresql://}"
_url="${_url#postgres://}"
PGUSER="${_url%%:*}"
_rest="${_url#*:}"
PGPASSWORD="${_rest%%@*}"
_rest="${_rest#*@}"
PGHOST="${_rest%%:*}"
_rest="${_rest#*:}"
PGPORT="${_rest%%/*}"
PGDATABASE="${_rest#*/}"
PGDATABASE="${PGDATABASE%%\?*}"

export PGPASSWORD PGHOST PGPORT PGUSER

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-${S3_BUCKET_NAME:+s3://${S3_BUCKET_NAME}/backups}}"
BACKUP_S3_ENDPOINT_URL="${BACKUP_S3_ENDPOINT_URL:-${S3_ENDPOINT:-}}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-${S3_ACCESS_KEY_ID:-}}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-${S3_SECRET_ACCESS_KEY:-}}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-${S3_REGION:-}}"

# Validate S3 vars
for var in BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT_URL BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY BACKUP_S3_REGION; do
    if [ -z "${!var:-}" ]; then
        echo "[ERROR] Required variable $var is not set" >&2; exit 1
    fi
done

S3_DAILY="${BACKUP_S3_BUCKET}/postgres/daily"
S3_WEEKLY="${BACKUP_S3_BUCKET}/postgres/weekly"

# ---------------------------------------------------------------------------
# 3. Helpers
# ---------------------------------------------------------------------------
log_info()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [INFO]  $*"; logger -t "$LOG_TAG" -p user.info "$*"; }
log_warn()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [WARN]  $*"; logger -t "$LOG_TAG" -p user.warning "$*"; }
log_error() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; logger -t "$LOG_TAG" -p user.err "$*"; }

s3_aws() {
    AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
    AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
    AWS_DEFAULT_REGION="$BACKUP_S3_REGION" \
    aws "$@" --endpoint-url "$BACKUP_S3_ENDPOINT_URL"
}

admin_psql() {
    local database="$1"
    shift
    if [[ "$PGHOST" =~ ^(localhost|127\.0\.0\.1|::1)$ ]] \
        && command -v sudo >/dev/null \
        && sudo -n -u postgres true 2>/dev/null; then
        sudo -n -u postgres psql -p "$PGPORT" -d "$database" "$@"
    else
        psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$database" "$@"
    fi
}

list_backups() {
    local prefix="$1"
    s3_aws s3 ls "${prefix}/" 2>/dev/null \
        | awk '{print $4}' \
        | grep "\.sql\.gz$" \
        | sort \
        || true
}

record_restore_finish() {
    local status="$1"
    local details="$2"
    [ -z "${RESTORE_RUN_ID:-}" ] && return 0
    local filename_escaped destination_escaped details_escaped
    filename_escaped=$(printf '%s' "${BACKUP_FILE_KEY:-}" | sed "s/'/''/g")
    destination_escaped=$(printf '%s' "${S3_KEY:-}" | sed "s/'/''/g")
    details_escaped=$(printf '%s' "$details" | sed "s/'/''/g")
    psql -c "UPDATE backup_runs SET finished_at=CURRENT_TIMESTAMP,status='${status}',filename='${filename_escaped}',size_bytes=${RESTORE_SIZE_BYTES:-NULL},destination='${destination_escaped}',details='${details_escaped}' WHERE id=${RESTORE_RUN_ID};" || true
}

restore_cleanup() {
    local exit_status=$?
    if [ "$exit_status" -ne 0 ]; then
        record_restore_finish "failed" "Restore test failed with exit code ${exit_status}"
    fi
}

# ---------------------------------------------------------------------------
# 4. List mode — show available backups
# ---------------------------------------------------------------------------
if [ "$MODE" = "list" ]; then
    echo ""
    echo "=== Daily backups ==="
    list_backups "$S3_DAILY" | nl -ba
    echo ""
    echo "=== Weekly backups ==="
    list_backups "$S3_WEEKLY" | nl -ba
    echo ""
    exit 0
fi

# ---------------------------------------------------------------------------
# 5. Resolve backup file to restore
# ---------------------------------------------------------------------------
if [ -z "$BACKUP_FILE_KEY" ]; then
    # Default: latest daily backup
    BACKUP_FILE_KEY=$(list_backups "$S3_DAILY" | tail -1)
    if [ -z "$BACKUP_FILE_KEY" ]; then
        log_error "No daily backups found in $S3_DAILY"
        exit 1
    fi
    log_info "Auto-selected latest daily backup: $BACKUP_FILE_KEY"
fi

# Determine which prefix hosts this file
if list_backups "$S3_DAILY" | grep -q "^${BACKUP_FILE_KEY}$"; then
    S3_KEY="${S3_DAILY}/${BACKUP_FILE_KEY}"
elif list_backups "$S3_WEEKLY" | grep -q "^${BACKUP_FILE_KEY}$"; then
    S3_KEY="${S3_WEEKLY}/${BACKUP_FILE_KEY}"
else
    log_error "File '$BACKUP_FILE_KEY' not found in daily or weekly buckets"
    exit 1
fi

# ---------------------------------------------------------------------------
# 6. Determine target database
# ---------------------------------------------------------------------------
if [ -n "$TARGET_DB_OVERRIDE" ]; then
    RESTORE_DB="$TARGET_DB_OVERRIDE"
elif [ "$MODE" = "production" ]; then
    RESTORE_DB="$PGDATABASE"
else
    # Dry-run: restore into an isolated test database
    RESTORE_DB="${PGDATABASE}_restore_test"
fi

# ---------------------------------------------------------------------------
# 7. Dry-run guard
# ---------------------------------------------------------------------------
if [ "$MODE" = "production" ]; then
    echo ""
    echo "  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "  !!! PRODUCTION RESTORE — THIS WILL DROP AND        !!!"
    echo "  !!! RECREATE THE DATABASE: $RESTORE_DB"
    echo "  !!! ALL EXISTING DATA WILL BE LOST.                !!!"
    echo "  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo ""
    read -r -p "Type the database name to confirm: " confirm
    if [ "$confirm" != "$RESTORE_DB" ]; then
        echo "Confirmation failed. Aborting." >&2
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# 8. Download backup from S3
# ---------------------------------------------------------------------------
mkdir -p "$RESTORE_DIR"
LOCAL_FILE="$RESTORE_DIR/$BACKUP_FILE_KEY"

log_info "Downloading $S3_KEY …"
s3_aws s3 cp "$S3_KEY" "$LOCAL_FILE"
BACKUP_SIZE=$(du -sh "$LOCAL_FILE" | cut -f1)
RESTORE_SIZE_BYTES=$(stat -c '%s' "$LOCAL_FILE")
log_info "Downloaded $LOCAL_FILE ($BACKUP_SIZE)"

# ---------------------------------------------------------------------------
# 9. Dry-run: restore to isolated test DB
# ---------------------------------------------------------------------------
if [ "$MODE" != "production" ]; then
    RESTORE_RUN_ID=$(psql -tAXq "INSERT INTO backup_runs(run_type,status) VALUES ('restore_test','running') RETURNING id" || true)
    trap restore_cleanup EXIT
    log_info "DRY-RUN: restoring into isolated database '$RESTORE_DB'"

    # Drop and recreate the test database
    admin_psql postgres \
        -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\";" \
        -c "CREATE DATABASE \"${RESTORE_DB}\" OWNER \"${PGUSER}\";"
    admin_psql "$RESTORE_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"

    # Restore
    gunzip -c "$LOCAL_FILE" \
        | sed '/^COMMENT ON EXTENSION vector IS /d' \
        | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" \
              --set ON_ERROR_STOP=1 \
              -q

    # Verification
    log_info "Verifying restore …"
    TABLE_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -tAc \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
    log_info "Tables found in $RESTORE_DB: $TABLE_COUNT"

    # Cleanup test database (comment out to keep for inspection)
    admin_psql postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\";" || true

    record_restore_finish "success" "Restore test healthy (tables=$TABLE_COUNT)"
    rm -f "$LOCAL_FILE"
    log_info "Dry-run complete — backup is healthy (tables=$TABLE_COUNT)"
    exit 0
fi

# ---------------------------------------------------------------------------
# 10. Production restore
# ---------------------------------------------------------------------------
log_warn "Stopping GigaPDF services before restore …"
sudo systemctl stop gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing || true

log_info "Dropping existing database '$RESTORE_DB' …"
admin_psql postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${RESTORE_DB}';"
admin_psql postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\";"
admin_psql postgres -c "CREATE DATABASE \"${RESTORE_DB}\" OWNER \"${PGUSER}\";"
admin_psql "$RESTORE_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"

log_info "Restoring from $LOCAL_FILE …"
gunzip -c "$LOCAL_FILE" \
    | sed '/^COMMENT ON EXTENSION vector IS /d' \
    | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" \
          --set ON_ERROR_STOP=1

# Verification
TABLE_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
log_info "Restored $TABLE_COUNT tables in $RESTORE_DB"

log_warn "Restarting GigaPDF services …"
sudo systemctl start gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing

rm -f "$LOCAL_FILE"
log_info "Production restore complete — tables=$TABLE_COUNT"
