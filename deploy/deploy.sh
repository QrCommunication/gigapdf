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
# 0. Fix permissions
# =============================================================================
log_info "Fixing permissions..."
sudo chown -R ubuntu:ubuntu /var/lib/gigapdf 2>/dev/null || true
sudo chown -R ubuntu:ubuntu /var/log/gigapdf 2>/dev/null || true

# =============================================================================
# 1. Copy Production Environment if not exists
# =============================================================================
if [ ! -f "$ENV_FILE" ]; then
    log_info "Creating .env from template..."
    cp deploy/.env.production "$ENV_FILE"
    log_warn "Please edit /opt/gigapdf/.env with production values!"
fi

# =============================================================================
# 1.5 Clean turbo cache to avoid build issues
# =============================================================================
log_info "Cleaning turbo cache..."
rm -rf .turbo packages/*/.turbo apps/*/.turbo

# =============================================================================
# 1.6 Create .env symlinks for apps
# =============================================================================
log_info "Creating .env symlinks..."
ln -sf /opt/gigapdf/.env /opt/gigapdf/apps/web/.env
ln -sf /opt/gigapdf/.env /opt/gigapdf/apps/admin/.env

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
# 2.5 Scaleway CLI (for infrastructure monitoring)
# =============================================================================
log_info "Setting up Scaleway CLI..."

# Install scw CLI if not present
if ! command -v scw &> /dev/null; then
    log_info "Installing Scaleway CLI..."
    curl -s https://raw.githubusercontent.com/scaleway/scaleway-cli/master/scripts/get.sh | sh
fi

# Note: scw CLI uses environment variables (SCW_ACCESS_KEY, SCW_SECRET_KEY, etc.)
# These are loaded from /opt/gigapdf/.env via systemd EnvironmentFile
# No config file needed - variables take priority over config files
if [ -n "$SCW_ACCESS_KEY" ]; then
    log_info "Scaleway CLI installed (credentials configured via environment)"
else
    log_warn "SCW_ACCESS_KEY not set - infrastructure costs API will not work"
    log_warn "Add to .env: SCW_ACCESS_KEY, SCW_SECRET_KEY, SCW_DEFAULT_ORGANIZATION_ID, SCW_DEFAULT_PROJECT_ID"
fi

# =============================================================================
# 3. Node.js Dependencies
# =============================================================================
log_info "Installing Node.js dependencies..."
pnpm install --frozen-lockfile

# =============================================================================
# 4. Build Packages (sequential to avoid OOM on small VPS)
# =============================================================================
log_info "Building shared packages (sequential mode)..."
export NODE_OPTIONS="--max-old-space-size=1024"
pnpm exec turbo build --filter='./packages/*' --concurrency=1

# =============================================================================
# 5. Generate Prisma clients
# =============================================================================
log_info "Generating Prisma clients..."
cd apps/web
pnpm db:generate || log_warn "Web Prisma generate skipped"
cd ../..

cd apps/admin
pnpm db:generate || log_warn "Admin Prisma generate skipped"
cd ../..

# =============================================================================
# 6. Build Next.js Applications
# =============================================================================
log_info "Building Next.js Web application..."
cd apps/web
NODE_OPTIONS="--max-old-space-size=1536" pnpm build
cd ../..

log_info "Building Next.js Admin application..."
cd apps/admin
NODE_OPTIONS="--max-old-space-size=1536" pnpm build
cd ../..

# =============================================================================
# 7. Copy static files to standalone directories
# =============================================================================
log_info "Copying static files to standalone directories..."

# Web app
mkdir -p /opt/gigapdf/apps/web/.next/standalone/apps/web/.next
cp -r /opt/gigapdf/apps/web/.next/static /opt/gigapdf/apps/web/.next/standalone/apps/web/.next/
cp -r /opt/gigapdf/apps/web/public /opt/gigapdf/apps/web/.next/standalone/apps/web/ 2>/dev/null || true

# Admin app
mkdir -p /opt/gigapdf/apps/admin/.next/standalone/apps/admin/.next
cp -r /opt/gigapdf/apps/admin/.next/static /opt/gigapdf/apps/admin/.next/standalone/apps/admin/.next/
cp -r /opt/gigapdf/apps/admin/public /opt/gigapdf/apps/admin/.next/standalone/apps/admin/ 2>/dev/null || true

# =============================================================================
# 8. Database Migrations
# =============================================================================
# IMPORTANT: Migration order matters!
# 1. Alembic manages FastAPI tables (stored_documents, user_quotas, plans, etc.)
# 2. Prisma manages Better Auth tables (users, sessions, accounts, verification, jwks)
# Both share the same database but manage different tables.
# NEVER run prisma db push with --accept-data-loss as it will delete Alembic tables!
# =============================================================================

log_info "Running Alembic migrations (FastAPI tables)..."
source .venv/bin/activate
cd "$APP_DIR"
alembic upgrade head || log_warn "Alembic migrations skipped or failed"

# Better Auth tables (created via SQL script, NOT Prisma push)
# Prisma push would delete Alembic tables, so we use a safe SQL script instead
log_info "Creating Better Auth tables (SQL script)..."
python3 -c "
from sqlalchemy import create_engine, text
import os

# Get database URL from environment
db_url = os.environ.get('DATABASE_URL', '')
if not db_url:
    print('DATABASE_URL not set, skipping Better Auth tables')
    exit(0)

# Ensure sync driver
db_url = db_url.replace('postgresql+asyncpg', 'postgresql')

engine = create_engine(db_url)
with open('deploy/init-betterauth-tables.sql', 'r') as f:
    sql = f.read()

with engine.connect() as conn:
    # Execute each statement separately
    for statement in sql.split(';'):
        statement = statement.strip()
        if statement and not statement.startswith('--'):
            try:
                conn.execute(text(statement))
            except Exception as e:
                pass  # Table already exists, ignore
    conn.commit()
    print('Better Auth tables created/verified successfully')
" || log_warn "Better Auth tables creation skipped"

# =============================================================================
# 7. Install/Update Systemd Services
# =============================================================================
log_info "Installing systemd services..."
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable services on boot
sudo systemctl enable gigapdf-api
sudo systemctl enable gigapdf-web
sudo systemctl enable gigapdf-admin
sudo systemctl enable gigapdf-celery
sudo systemctl enable gigapdf-celery-billing

# =============================================================================
# 8. Update Nginx Configuration
# =============================================================================
log_info "Updating Nginx configuration..."
if [ -f /etc/letsencrypt/live/giga-pdf.com/fullchain.pem ]; then
    sudo cp deploy/nginx.conf /etc/nginx/sites-available/gigapdf
    sudo nginx -t && sudo systemctl reload nginx
else
    log_warn "SSL certificate not found, skipping Nginx update"
    log_warn "Run: sudo certbot --nginx -d giga-pdf.com -d www.giga-pdf.com"
fi

# =============================================================================
# 9. Restart Services
# =============================================================================
log_info "Restarting services..."

# Stop all services first
sudo systemctl stop gigapdf-api || true
sudo systemctl stop gigapdf-web || true
sudo systemctl stop gigapdf-admin || true
sudo systemctl stop gigapdf-celery || true
sudo systemctl stop gigapdf-celery-billing || true

# Start services
sudo systemctl start gigapdf-api
sudo systemctl start gigapdf-web
sudo systemctl start gigapdf-admin
sudo systemctl start gigapdf-celery
sudo systemctl start gigapdf-celery-billing

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
