#!/bin/bash
# =============================================================================
# GigaPDF Deployment Script
# This script is executed by the post-receive hook on each deployment
# =============================================================================

set -e

echo "=========================================="
echo "  GigaPDF Deployment"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

APP_DIR="/opt/gigapdf"
ENV_FILE="$APP_DIR/.env"

cd "$APP_DIR"

# =============================================================================
# 1. Copy Production Environment if not exists
# =============================================================================
if [ ! -f "$ENV_FILE" ]; then
    log_info "Creating .env from template..."
    cp deploy/.env.production "$ENV_FILE"
    log_warn "Please edit /opt/gigapdf/.env with production values!"
fi

# =============================================================================
# 2. Python Virtual Environment & Dependencies
# =============================================================================
log_info "Setting up Python environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# =============================================================================
# 3. Node.js Dependencies
# =============================================================================
log_info "Installing Node.js dependencies..."
pnpm install --frozen-lockfile

# =============================================================================
# 4. Build Packages
# =============================================================================
log_info "Building shared packages..."
pnpm build:packages

# =============================================================================
# 5. Build Next.js Applications
# =============================================================================
log_info "Building Next.js Web application..."
cd apps/web
pnpm build
cd ../..

log_info "Building Next.js Admin application..."
cd apps/admin
pnpm build
cd ../..

# =============================================================================
# 6. Database Migrations
# =============================================================================
log_info "Running database migrations..."
source .venv/bin/activate
cd "$APP_DIR"
alembic upgrade head || log_warn "Alembic migrations skipped or failed"

# Prisma migrations for Next.js apps
log_info "Running Prisma migrations..."
cd apps/web
pnpm db:generate
pnpm db:push || log_warn "Web Prisma push skipped"
cd ../..

cd apps/admin
pnpm db:generate
pnpm db:push || log_warn "Admin Prisma push skipped"
cd ../..

# =============================================================================
# 7. Install/Update Systemd Services
# =============================================================================
log_info "Installing systemd services..."
cp deploy/systemd/*.service /etc/systemd/system/
systemctl daemon-reload

# Enable services on boot
systemctl enable gigapdf-api
systemctl enable gigapdf-web
systemctl enable gigapdf-admin
systemctl enable gigapdf-celery
systemctl enable gigapdf-celery-billing

# =============================================================================
# 8. Update Nginx Configuration
# =============================================================================
log_info "Updating Nginx configuration..."
if [ -f /etc/letsencrypt/live/giga-pdf.com/fullchain.pem ]; then
    cp deploy/nginx.conf /etc/nginx/sites-available/gigapdf
    nginx -t && systemctl reload nginx
else
    log_warn "SSL certificate not found, skipping Nginx update"
    log_warn "Run: certbot --nginx -d giga-pdf.com -d www.giga-pdf.com"
fi

# =============================================================================
# 9. Restart Services
# =============================================================================
log_info "Restarting services..."

# Stop all services first
systemctl stop gigapdf-api || true
systemctl stop gigapdf-web || true
systemctl stop gigapdf-admin || true
systemctl stop gigapdf-celery || true
systemctl stop gigapdf-celery-billing || true

# Start services
systemctl start gigapdf-api
systemctl start gigapdf-web
systemctl start gigapdf-admin
systemctl start gigapdf-celery
systemctl start gigapdf-celery-billing

# =============================================================================
# 10. Health Check
# =============================================================================
log_info "Performing health checks..."
sleep 5

check_service() {
    if systemctl is-active --quiet $1; then
        echo -e "  ${GREEN}✓${NC} $1 is running"
    else
        echo -e "  ${RED}✗${NC} $1 failed to start"
        systemctl status $1 --no-pager -l || true
    fi
}

check_service gigapdf-api
check_service gigapdf-web
check_service gigapdf-admin
check_service gigapdf-celery
check_service gigapdf-celery-billing

# Check HTTP endpoints
sleep 2
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health | grep -q "200"; then
    echo -e "  ${GREEN}✓${NC} API health check passed"
else
    echo -e "  ${YELLOW}!${NC} API health check pending..."
fi

if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200"; then
    echo -e "  ${GREEN}✓${NC} Web health check passed"
else
    echo -e "  ${YELLOW}!${NC} Web health check pending..."
fi

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""
echo "Services:"
echo "  - API:    http://localhost:8000"
echo "  - Web:    http://localhost:3000"
echo "  - Admin:  http://localhost:3001"
echo ""
echo "Logs:"
echo "  - API:    /var/log/gigapdf/api.log"
echo "  - Web:    /var/log/gigapdf/web.log"
echo "  - Celery: /var/log/gigapdf/celery.log"
echo ""
