#!/bin/bash
# =============================================================================
# GigaPDF Server Setup Script
# Run this script once on a fresh Ubuntu/Debian server
# Usage: bash setup-server.sh
# =============================================================================

set -e

echo "=========================================="
echo "  GigaPDF Server Setup"
echo "=========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root"
    exit 1
fi

# =============================================================================
# 1. System Update
# =============================================================================
log_info "Updating system packages..."
apt update && apt upgrade -y

# =============================================================================
# 2. Install Dependencies
# =============================================================================
log_info "Installing system dependencies..."
apt install -y \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    nginx \
    certbot \
    python3-certbot-nginx \
    tesseract-ocr \
    tesseract-ocr-fra \
    tesseract-ocr-eng \
    libtesseract-dev \
    poppler-utils \
    libpoppler-cpp-dev \
    imagemagick \
    ghostscript \
    libmagickwand-dev \
    ufw \
    htop \
    logrotate

# =============================================================================
# 3. Install Node.js 20 LTS
# =============================================================================
log_info "Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# Install pnpm
log_info "Installing pnpm..."
npm install -g pnpm@9

# =============================================================================
# 4. Create gigapdf user
# =============================================================================
log_info "Creating gigapdf user..."
if ! id "gigapdf" &>/dev/null; then
    useradd -r -m -d /opt/gigapdf -s /bin/bash gigapdf
fi

# =============================================================================
# 5. Create directory structure
# =============================================================================
log_info "Creating directory structure..."
mkdir -p /opt/gigapdf
mkdir -p /var/lib/gigapdf/documents
mkdir -p /var/log/gigapdf
mkdir -p /var/www/certbot
mkdir -p /opt/gigapdf-repo.git

chown -R gigapdf:gigapdf /opt/gigapdf
chown -R gigapdf:gigapdf /var/lib/gigapdf
chown -R gigapdf:gigapdf /var/log/gigapdf

# =============================================================================
# 6. Setup Git Bare Repository for Deployment
# =============================================================================
log_info "Setting up Git bare repository..."
cd /opt/gigapdf-repo.git
git init --bare

# Create post-receive hook
cat > /opt/gigapdf-repo.git/hooks/post-receive << 'HOOK'
#!/bin/bash
# =============================================================================
# GigaPDF Post-Receive Deployment Hook
# =============================================================================

set -e

TARGET="/opt/gigapdf"
GIT_DIR="/opt/gigapdf-repo.git"
BRANCH="main"

echo "=========================================="
echo "  Deploying GigaPDF..."
echo "=========================================="

# Checkout code
git --work-tree=$TARGET --git-dir=$GIT_DIR checkout -f $BRANCH

# Change to app directory
cd $TARGET

# Run deployment script
if [ -f "deploy/deploy.sh" ]; then
    bash deploy/deploy.sh
else
    echo "Warning: deploy/deploy.sh not found"
fi

echo "=========================================="
echo "  Deployment complete!"
echo "=========================================="
HOOK

chmod +x /opt/gigapdf-repo.git/hooks/post-receive
chown -R gigapdf:gigapdf /opt/gigapdf-repo.git

# =============================================================================
# 7. Configure Firewall
# =============================================================================
log_info "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# =============================================================================
# 8. Setup Nginx (initial config without SSL)
# =============================================================================
log_info "Setting up Nginx..."
cat > /etc/nginx/sites-available/gigapdf << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name giga-pdf.com www.giga-pdf.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'GigaPDF - Waiting for deployment';
        add_header Content-Type text/plain;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/gigapdf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# =============================================================================
# 9. Setup SSL with Let's Encrypt
# =============================================================================
log_info "Setting up SSL certificate..."
echo ""
echo "Run the following command to obtain SSL certificate:"
echo ""
echo "  certbot --nginx -d giga-pdf.com -d www.giga-pdf.com"
echo ""
echo "After obtaining the certificate, copy the full nginx config:"
echo ""
echo "  cp /opt/gigapdf/deploy/nginx.conf /etc/nginx/sites-available/gigapdf"
echo "  nginx -t && systemctl reload nginx"
echo ""

# =============================================================================
# 10. Install Systemd Services
# =============================================================================
log_info "Systemd services will be installed during first deployment..."

# =============================================================================
# 11. Setup Log Rotation
# =============================================================================
log_info "Setting up log rotation..."
cat > /etc/logrotate.d/gigapdf << 'LOGROTATE'
/var/log/gigapdf/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 gigapdf gigapdf
    sharedscripts
    postrotate
        systemctl reload gigapdf-api gigapdf-celery 2>/dev/null || true
    endscript
}
LOGROTATE

# =============================================================================
# 12. ImageMagick Policy (allow PDF processing)
# =============================================================================
log_info "Configuring ImageMagick policy..."
if [ -f /etc/ImageMagick-6/policy.xml ]; then
    sed -i 's/<policy domain="coder" rights="none" pattern="PDF" \/>/<policy domain="coder" rights="read|write" pattern="PDF" \/>/g' /etc/ImageMagick-6/policy.xml
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Add SSH key to authorized_keys (if not done):"
echo "   echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII6oUibNfZWs3NEPFjFWbbeA9EBNrELHPEiw9FRcTftv gigapdf-deploy' >> ~/.ssh/authorized_keys"
echo ""
echo "2. Get SSL certificate:"
echo "   certbot --nginx -d giga-pdf.com -d www.giga-pdf.com"
echo ""
echo "3. On your local machine, add git remote and push:"
echo "   git remote add production ubuntu@51.159.105.179:/opt/gigapdf-repo.git"
echo "   git push production main"
echo ""
echo "4. First deployment will:"
echo "   - Install Python dependencies"
echo "   - Build Next.js apps"
echo "   - Run database migrations"
echo "   - Start all services"
echo ""
