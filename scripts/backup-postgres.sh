#!/bin/bash
# =============================================================================
# GigaPDF — PostgreSQL Backup Script
#
# Performs pg_dump backups, compresses with gzip, and uploads to S3-compatible
# storage (Scaleway Object Storage).  Applies retention:
#   - 7 daily backups
#   - 4 weekly backups (Sunday runs kept for 4 weeks)
#
# Setup (run as root or via sudo crontab for ubuntu user):
#
#   # Edit ubuntu crontab:
#   sudo -u ubuntu crontab -e
#
#   # Add this line (daily at 03:00 UTC):
#   0 3 * * * /opt/gigapdf/scripts/backup-postgres.sh >> /var/log/gigapdf/backup.log 2>&1
#
# Required environment variables (loaded from /opt/gigapdf/.env):
#   BACKUP_S3_BUCKET        e.g. s3://gigapdf-backups
#   BACKUP_S3_ENDPOINT_URL  e.g. https://s3.fr-par.scw.cloud
#   BACKUP_S3_ACCESS_KEY    Scaleway access key (or AWS_ACCESS_KEY_ID)
#   BACKUP_S3_SECRET_KEY    Scaleway secret key (or AWS_SECRET_ACCESS_KEY)
#   BACKUP_S3_REGION        e.g. fr-par
#   DATABASE_URL            postgresql://user:pass@host:port/dbname
#   BACKUP_NOTIFY_EMAIL     (optional) email for failure notifications
#   BACKUP_NOTIFY_WEBHOOK   (optional) Slack/Discord webhook URL
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
# 1. Configuration
# ---------------------------------------------------------------------------
TIMESTAMP=$(date -u '+%Y%m%d_%H%M%S')
DAY_OF_WEEK=$(date -u '+%u')   # 1=Monday … 7=Sunday
BACKUP_DIR="${BACKUP_TEMP_DIR:-/tmp/gigapdf-backups}"
LOG_TAG="gigapdf-backup"

# Retention
DAILY_KEEP="${BACKUP_DAILY_KEEP:-7}"
WEEKLY_KEEP="${BACKUP_WEEKLY_KEEP:-4}"

# Derived from DATABASE_URL: postgresql://user:pass@host:port/dbname
# Parse using parameter expansion — no external tool required
if [ -z "${DATABASE_URL:-}" ]; then
    logger -t "$LOG_TAG" -p user.err "DATABASE_URL is not set — aborting"
    echo "[ERROR] DATABASE_URL is not set" >&2
    exit 1
fi

# Strip protocol
_url="${DATABASE_URL#postgresql://}"
_url="${_url#postgres://}"
# user:pass@host:port/dbname
PGUSER="${_url%%:*}"
_rest="${_url#*:}"
PGPASSWORD="${_rest%%@*}"
_rest="${_rest#*@}"
PGHOST="${_rest%%:*}"
_rest="${_rest#*:}"
PGPORT="${_rest%%/*}"
PGDATABASE="${_rest#*/}"
# Strip query string if present
PGDATABASE="${PGDATABASE%%\?*}"

export PGPASSWORD PGHOST PGPORT PGUSER PGDATABASE

# Validate required S3 vars
for var in BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT_URL BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY BACKUP_S3_REGION; do
    if [ -z "${!var:-}" ]; then
        logger -t "$LOG_TAG" -p user.err "Required variable $var is not set — aborting"
        echo "[ERROR] Required variable $var is not set" >&2
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# 2. Helpers
# ---------------------------------------------------------------------------
log_info()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [INFO]  $*"; logger -t "$LOG_TAG" -p user.info "$*"; }
log_error() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; logger -t "$LOG_TAG" -p user.err "$*"; }

notify_failure() {
    local msg="$1"
    log_error "$msg"

    # Email notification
    if [ -n "${BACKUP_NOTIFY_EMAIL:-}" ] && command -v mail &>/dev/null; then
        echo "$msg" | mail -s "[GigaPDF] BACKUP FAILED — $(date -u '+%Y-%m-%d')" "$BACKUP_NOTIFY_EMAIL" || true
    fi

    # Webhook notification (Slack / Discord)
    if [ -n "${BACKUP_NOTIFY_WEBHOOK:-}" ]; then
        curl -s -X POST "$BACKUP_NOTIFY_WEBHOOK" \
            -H 'Content-Type: application/json' \
            -d "{\"text\":\"GIGAPDF BACKUP FAILED: ${msg}\"}" || true
    fi
}

cleanup() {
    rm -f "${BACKUP_FILE:-}" "${BACKUP_FILE:-}.gz" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 3. Check dependencies
# ---------------------------------------------------------------------------
for cmd in pg_dump gzip aws; do
    if ! command -v "$cmd" &>/dev/null; then
        notify_failure "Required command '$cmd' not found — install it before scheduling backups"
        exit 1
    fi
done

mkdir -p "$BACKUP_DIR"

# ---------------------------------------------------------------------------
# 4. Determine backup type (daily vs weekly)
# ---------------------------------------------------------------------------
if [ "$DAY_OF_WEEK" -eq 7 ]; then
    BACKUP_TYPE="weekly"
else
    BACKUP_TYPE="daily"
fi

BACKUP_FILENAME="gigapdf_${BACKUP_TYPE}_${TIMESTAMP}.sql.gz"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILENAME"
S3_PREFIX="${BACKUP_S3_BUCKET}/postgres/${BACKUP_TYPE}"

log_info "Starting $BACKUP_TYPE backup — db=$PGDATABASE host=$PGHOST"

# ---------------------------------------------------------------------------
# 5. pg_dump and compress in a single pipeline
# ---------------------------------------------------------------------------
if ! pg_dump \
        --no-password \
        --format=plain \
        --no-owner \
        --no-acl \
        --verbose \
        "$PGDATABASE" 2>>"${BACKUP_DIR}/pg_dump_stderr.log" \
    | gzip -9 > "$BACKUP_FILE"; then
    notify_failure "pg_dump failed for database $PGDATABASE — check ${BACKUP_DIR}/pg_dump_stderr.log"
    exit 1
fi

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log_info "Dump complete — size=$BACKUP_SIZE file=$BACKUP_FILENAME"

# ---------------------------------------------------------------------------
# 6. Upload to S3-compatible storage
# ---------------------------------------------------------------------------
log_info "Uploading to $S3_PREFIX/$BACKUP_FILENAME"

if ! AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
   AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
   AWS_DEFAULT_REGION="$BACKUP_S3_REGION" \
   aws s3 cp \
        --endpoint-url "$BACKUP_S3_ENDPOINT_URL" \
        --storage-class STANDARD \
        "$BACKUP_FILE" \
        "${S3_PREFIX}/${BACKUP_FILENAME}"; then
    notify_failure "S3 upload failed for $BACKUP_FILENAME — bucket=$BACKUP_S3_BUCKET"
    exit 1
fi

log_info "Upload successful — ${S3_PREFIX}/${BACKUP_FILENAME}"

# ---------------------------------------------------------------------------
# 7. Retention — delete old backups from S3
# ---------------------------------------------------------------------------
apply_retention() {
    local prefix="$1"
    local keep="$2"
    local type_label="$3"

    log_info "Applying $type_label retention (keep=$keep) on $prefix"

    # List all backup files for this type, sorted by key name (chronological because of YYYYMMDD prefix)
    local files
    files=$(
        AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
        AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
        AWS_DEFAULT_REGION="$BACKUP_S3_REGION" \
        aws s3 ls \
            --endpoint-url "$BACKUP_S3_ENDPOINT_URL" \
            "${prefix}/" \
        | awk '{print $4}' \
        | grep "^gigapdf_${type_label}_.*\.sql\.gz$" \
        | sort \
        || true
    )

    local count
    count=$(echo "$files" | grep -c . || true)

    if [ "$count" -le "$keep" ]; then
        log_info "Retention: $count file(s) found, nothing to prune (keep=$keep)"
        return 0
    fi

    local to_delete
    to_delete=$(echo "$files" | head -n $(( count - keep )))

    while IFS= read -r f; do
        [ -z "$f" ] && continue
        log_info "Retention: deleting old backup ${prefix}/${f}"
        AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
        AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
        AWS_DEFAULT_REGION="$BACKUP_S3_REGION" \
        aws s3 rm \
            --endpoint-url "$BACKUP_S3_ENDPOINT_URL" \
            "${prefix}/${f}" || log_error "Failed to delete ${prefix}/${f}"
    done <<< "$to_delete"
}

apply_retention "${BACKUP_S3_BUCKET}/postgres/daily"  "$DAILY_KEEP"  "daily"
apply_retention "${BACKUP_S3_BUCKET}/postgres/weekly" "$WEEKLY_KEEP" "weekly"

# ---------------------------------------------------------------------------
# 8. Done
# ---------------------------------------------------------------------------
log_info "Backup finished successfully — type=$BACKUP_TYPE size=$BACKUP_SIZE"
