#!/bin/bash
# =============================================================================
# GigaPDF Deployment Script — Ploi Server (giga-pdf.com)
#
# Executed by Ploi post-deploy hook or manually via SSH.
# Target: ~/giga-pdf.com/ (flat clone, git pull in-place)
# Services: systemd (gigapdf-{api,web,admin,celery,celery-billing,ocr})
# User: ploi (owner of the checkout and runtime services)
#
# Sequence:
#   1. Bootstrap dirs + fix permissions
#   2. Python venv + deps
#   3. Node deps (pnpm install)
#   4. Build packages (sequential, OOM-safe)
#   5. Prisma generate
#   6. Build Next.js apps (web + admin)
#   7. Copy static → standalone
#   8. Snapshot build artefacts (rollback support)
#   9. Alembic migrations
#  10. Install/update systemd units
#  11. Fetch OCR engine (idempotent)
#  12. Nginx config + maintenance page
#  13. Zero-downtime service restart with health gates
#  14. Final health checks
#
# Usage:
#   bash deploy/deploy.sh              # full deploy
#   bash deploy/deploy.sh --web-only   # skip celery/ocr restart
#   bash deploy/deploy.sh --skip-build # assume build artefacts are current
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APP_DIR="${GIGAPDF_APP_DIR:-$HOME/giga-pdf.com}"
ENV_FILE="$APP_DIR/.env"
LOG_DIR="/var/log/gigapdf"
SNAPSHOT_BASE="$APP_DIR/.deploy-snapshots"
DEPLOY_TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT_DIR="$SNAPSHOT_BASE/$DEPLOY_TIMESTAMP"
DEPLOY_USER="$(whoami)"

WEB_ONLY=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --web-only)   WEB_ONLY=true ;;
    --skip-build) SKIP_BUILD=true ;;
    -h|--help)
      sed -n '2,/^# ==/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "[warn] unknown flag: $arg" >&2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { printf "${GREEN}[INFO]${NC} %s\n" "$*"; }
log_warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
log_error() { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; }
log_step()  { printf "${BLUE}[STEP]${NC} %s\n" "$*"; }

die() { log_error "$*"; exit 1; }

# Wait for an HTTP endpoint to return 2xx/3xx (max N attempts × delay seconds)
wait_healthy() {
  local name="$1" url="$2" max="${3:-12}" delay="${4:-5}"
  log_info "Waiting for $name at $url ..."
  for i in $(seq 1 "$max"); do
    if curl -sf "$url" > /dev/null 2>&1; then
      log_info "$name healthy (attempt $i/$max)."
      return 0
    fi
    sleep "$delay"
  done
  log_error "$name NOT healthy after $((max * delay))s."
  return 1
}

echo "=========================================="
echo "  GigaPDF Deployment (Ploi)"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  APP_DIR=$APP_DIR"
echo "  USER=$DEPLOY_USER"
echo "=========================================="

cd "$APP_DIR" || die "Cannot cd to $APP_DIR"

# ===========================================================================
# STEP 1 — Bootstrap directories + fix permissions
# ===========================================================================
log_step "1/14 Bootstrapping directories..."
mkdir -p "$LOG_DIR" "$SNAPSHOT_BASE"

# Reclaim caches that may have been written by a different user (e.g. root
# during a previous sudo-based deploy). Without this, rm/cp fails with EPERM
# and set -e kills the deploy mid-way.
for cache_dir in .turbo packages/*/.turbo apps/*/.turbo apps/*/.next; do
  [ -e "$cache_dir" ] && sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$cache_dir" 2>/dev/null || true
done

# ===========================================================================
# STEP 2 — Python virtual environment + dependencies
# ===========================================================================
log_step "2/14 Setting up Python environment..."
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q

# ===========================================================================
# STEP 3 — Node.js dependencies
# ===========================================================================
log_step "3/14 Installing Node.js dependencies..."
pnpm install --no-frozen-lockfile 2>&1 | tail -5

# ===========================================================================
# STEP 4 — Build shared packages (sequential, OOM-safe)
# ===========================================================================
if ! $SKIP_BUILD; then
  log_step "4/14 Building shared packages (sequential)..."
  export NODE_OPTIONS="--max-old-space-size=1024"
  pnpm exec turbo build --filter='./packages/*' --concurrency=1 2>&1 | tail -10
else
  log_step "4/14 Skipping package build (--skip-build)"
fi

# ===========================================================================
# STEP 5 — Generate Prisma clients
# ===========================================================================
log_step "5/14 Generating Prisma clients..."
(cd apps/web  && pnpm db:generate 2>&1 | tail -3) || log_warn "Web Prisma generate skipped"
(cd apps/admin && pnpm db:generate 2>&1 | tail -3) || log_warn "Admin Prisma generate skipped"

# ===========================================================================
# STEP 6 — Build Next.js applications
# ===========================================================================
if ! $SKIP_BUILD; then
  log_step "6/14 Building Next.js Web..."
  (cd apps/web && NODE_OPTIONS="--max-old-space-size=1536" pnpm build 2>&1 | tail -10)

  log_step "6/14 Building Next.js Admin..."
  (cd apps/admin && NODE_OPTIONS="--max-old-space-size=1536" pnpm build 2>&1 | tail -10)
else
  log_step "6/14 Skipping Next.js build (--skip-build)"
fi

# ===========================================================================
# STEP 7 — Copy static files to standalone directories
# ===========================================================================
log_step "7/14 Syncing static assets to standalone..."

sync_standalone() {
  local app="$1" port="$2"
  local standalone="$APP_DIR/apps/$app/.next/standalone/apps/$app"
  mkdir -p "$standalone/.next"
  cp -r "$APP_DIR/apps/$app/.next/static" "$standalone/.next/" 2>/dev/null || true
  cp -r "$APP_DIR/apps/$app/public" "$standalone/" 2>/dev/null || true
  log_info "  $app standalone synced."
}
sync_standalone web 3000
sync_standalone admin 3001

# ===========================================================================
# STEP 8 — Snapshot build artefacts (rollback support)
# ===========================================================================
log_step "8/14 Snapshotting build artefacts..."
mkdir -p "$SNAPSHOT_DIR/apps/web" "$SNAPSHOT_DIR/apps/admin"
cp -a "$APP_DIR/apps/web/.next"   "$SNAPSHOT_DIR/apps/web/.next"
cp -a "$APP_DIR/apps/admin/.next" "$SNAPSHOT_DIR/apps/admin/.next"

# Package dist artefacts
if [ -d "$APP_DIR/packages" ]; then
  mkdir -p "$SNAPSHOT_DIR/packages"
  find "$APP_DIR/packages" -maxdepth 2 -name "dist" -type d | while read -r d; do
    rel="${d#"$APP_DIR/"}"
    mkdir -p "$SNAPSHOT_DIR/$rel"
    cp -a "$d/." "$SNAPSHOT_DIR/$rel/"
  done
fi

ln -sfn "$SNAPSHOT_DIR" "$SNAPSHOT_BASE/latest"
log_info "Snapshot created. Total: $(ls -1d "$SNAPSHOT_BASE"/[0-9]* 2>/dev/null | wc -l)"

# Prune old snapshots (keep last 5)
ls -1dt "$SNAPSHOT_BASE"/[0-9]* 2>/dev/null | tail -n +6 | xargs -r rm -rf

# ===========================================================================
# STEP 9 — Database migrations (Alembic only — NEVER prisma db push)
# ===========================================================================
log_step "9/14 Running Alembic migrations..."
source .venv/bin/activate
if [ -f "$ENV_FILE" ]; then
  set -a; source "$ENV_FILE"; set +a
fi
alembic upgrade head || log_warn "Alembic migrations skipped or failed"

# ===========================================================================
# STEP 10 — Install/update systemd service units
# ===========================================================================
log_step "10/14 Installing systemd service units..."
sudo cp "$APP_DIR/deploy/systemd/"*.service /etc/systemd/system/
sudo systemctl daemon-reload

for svc in gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing gigapdf-ocr; do
  sudo systemctl enable "$svc" 2>/dev/null || true
done

# ===========================================================================
# STEP 11 — Fetch host-side OCR engine (idempotent)
# ===========================================================================
log_step "11/14 Checking OCR engine..."
OCR_REL="https://github.com/QrCommunication/gigapdf-lib/releases/download/ocr-rten-v1"
OCR_BIN="$APP_DIR/bin/ocr_serve"
OCR_MODELS_ROOT="/var/lib/gigapdf/rten-models"
sudo mkdir -p "$APP_DIR/bin" "$OCR_MODELS_ROOT"

OCR_TMP="$(mktemp -d)"
if curl -fsSL -o "$OCR_TMP/gigapdf-ocr.sha256" "$OCR_REL/gigapdf-ocr.sha256" 2>/dev/null; then
  OCR_NEWSHA="$(grep "gigapdf-ocr-models.tar.gz" "$OCR_TMP/gigapdf-ocr.sha256" | awk '{print $1}')"
  OCR_MARKER="$OCR_MODELS_ROOT/.asset-sha"
  if [ ! -x "$OCR_BIN" ] || [ ! -d "$OCR_MODELS_ROOT/models" ] || [ "$(cat "$OCR_MARKER" 2>/dev/null)" != "$OCR_NEWSHA" ]; then
    log_info "  Downloading OCR binary + models (~250MB)..."
    curl -fsSL -o "$OCR_TMP/ocr_serve" "$OCR_REL/ocr_serve"
    curl -fsSL -o "$OCR_TMP/gigapdf-ocr-models.tar.gz" "$OCR_REL/gigapdf-ocr-models.tar.gz"
    (cd "$OCR_TMP" && sha256sum -c gigapdf-ocr.sha256)
    sudo install -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$OCR_TMP/ocr_serve" "$OCR_BIN"
    sudo rm -rf "$OCR_MODELS_ROOT/models"
    sudo tar xzf "$OCR_TMP/gigapdf-ocr-models.tar.gz" -C "$OCR_MODELS_ROOT"
    sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$OCR_MODELS_ROOT"
    echo "$OCR_NEWSHA" | sudo tee "$OCR_MARKER" >/dev/null
    log_info "  OCR engine updated."
  else
    log_info "  OCR engine up-to-date."
  fi
else
  log_warn "  Could not reach OCR release asset — keeping existing engine."
fi
rm -rf "$OCR_TMP"

# Upsert OCR env keys into .env (idempotent)
for kv in "OCR_MODELS_DIR=/var/lib/gigapdf/rten-models/models" "OCR_BIND=127.0.0.1:8077" "OCR_SERVICE_URL=http://127.0.0.1:8077"; do
  k="${kv%%=*}"
  grep -q "^$k=" "$ENV_FILE" 2>/dev/null || echo "$kv" >> "$ENV_FILE"
done

# ===========================================================================
# STEP 12 — Nginx configuration + maintenance page
# ===========================================================================
log_step "12/14 Updating Nginx configuration..."
sudo mkdir -p /var/www/gigapdf-maintenance
[ -f "$APP_DIR/deploy/nginx/maintenance.html" ] && \
  sudo cp "$APP_DIR/deploy/nginx/maintenance.html" /var/www/gigapdf-maintenance/maintenance.html

if [ -f /etc/letsencrypt/live/giga-pdf.com/fullchain.pem ]; then
  sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/gigapdf
  sudo nginx -t && sudo systemctl reload nginx
  log_info "Nginx reloaded."
else
  log_warn "SSL certificate not found — skipping Nginx update."
fi

# ===========================================================================
# STEP 13 — Zero-downtime service restart with health gates
# ===========================================================================
log_step "13/14 Restarting services..."

# --- 13a. FastAPI (uvicorn --workers: MUST restart, SIGHUP doesn't reload code) ---
if sudo systemctl is-active --quiet gigapdf-api; then
  sudo systemctl restart gigapdf-api
  log_info "gigapdf-api restarted (new code loaded)."
else
  sudo systemctl start gigapdf-api
  log_info "gigapdf-api cold-started."
fi
wait_healthy "gigapdf-api" "http://localhost:8000/health" 12 5 || \
  die "API unhealthy — aborting deploy. Previous services unchanged."

# --- 13b. Celery workers (tasks survive via Redis broker) ---
if ! $WEB_ONLY; then
  sudo systemctl restart gigapdf-celery
  sudo systemctl restart gigapdf-celery-billing
  log_info "Celery workers restarted."
fi

# --- 13b-bis. OCR engine ---
if ! $WEB_ONLY; then
  sudo systemctl restart gigapdf-ocr
  log_info "gigapdf-ocr restarted."
fi

# --- 13c. Next.js Web ---
sudo systemctl restart gigapdf-web
sleep 4  # grace period before admin restart

# --- 13d. Next.js Admin ---
sudo systemctl restart gigapdf-admin

# ===========================================================================
# STEP 14 — Final health checks
# ===========================================================================
log_step "14/14 Final health checks..."
sleep 5

DEPLOY_OK=true

check_service() {
  if sudo systemctl is-active --quiet "$1"; then
    printf "  ${GREEN}✓${NC} %s running\n" "$1"
  else
    printf "  ${RED}✗${NC} %s FAILED\n" "$1"
    sudo systemctl status "$1" --no-pager -l 2>/dev/null | tail -10 || true
    DEPLOY_OK=false
  fi
}

check_http() {
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "$2" 2>/dev/null || echo "000")"
  if echo "$code" | grep -qE "^[23]"; then
    printf "  ${GREEN}✓${NC} %s → HTTP %s\n" "$1" "$code"
  else
    printf "  ${YELLOW}!${NC} %s → HTTP %s (warming up?)\n" "$1" "$code"
  fi
}

echo ""
echo "Systemd services:"
check_service gigapdf-api
check_service gigapdf-web
check_service gigapdf-admin
check_service gigapdf-celery
check_service gigapdf-celery-billing
check_service gigapdf-ocr

echo ""
echo "HTTP endpoints:"
check_http "API /health"       "http://localhost:8000/health"
check_http "Web (port 3000)"   "http://localhost:3000"
check_http "Admin (port 3001)" "http://localhost:3001"
check_http "OCR /health"       "http://localhost:8077/health"

if [ "$DEPLOY_OK" = false ]; then
  log_error "One or more services failed!"
  exit 1
fi

echo ""
echo "=========================================="
echo "  ✅ Deployment Complete!"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  HEAD: $(git rev-parse --short HEAD)"
echo "=========================================="