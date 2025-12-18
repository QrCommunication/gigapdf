# Deployment Guide / Guide de déploiement

Complete guide for deploying GigaPDF to production environments.

Guide complet pour déployer GigaPDF en environnement de production.

---

## Table of Contents / Table des matières

1. [Prerequisites](#prerequisites)
2. [Server Preparation](#server-preparation)
3. [Docker Deployment](#docker-deployment)
4. [Manual Deployment](#manual-deployment)
5. [Nginx Configuration](#nginx-configuration)
6. [SSL/TLS Setup](#ssltls-setup)
7. [Process Management (PM2)](#process-management-pm2)
8. [Environment Variables](#environment-variables)
9. [Database Setup](#database-setup)
10. [Storage Configuration](#storage-configuration)
11. [Monitoring & Logging](#monitoring--logging)
12. [Backup & Recovery](#backup--recovery)
13. [Security Hardening](#security-hardening)
14. [Scaling](#scaling)

---

## Prerequisites

### Server Requirements / Configuration serveur requise

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 2 vCPU | 4+ vCPU |
| **RAM** | 4 GB | 8+ GB |
| **Storage** | 50 GB SSD | 200+ GB SSD |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| **Bandwidth** | 100 Mbps | 1 Gbps |

### Required Services / Services requis

| Service | Version | Hosting Options |
|---------|---------|-----------------|
| PostgreSQL | 16+ | Self-hosted, Supabase, AWS RDS, Scaleway |
| Redis | 7+ | Self-hosted, Redis Cloud, AWS ElastiCache |
| S3 Storage | - | Scaleway, AWS S3, MinIO, Cloudflare R2 |

---

## Server Preparation

### Initial Server Setup / Configuration initiale du serveur

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y \
  curl \
  git \
  build-essential \
  nginx \
  certbot \
  python3-certbot-nginx \
  ufw

# Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Create application user
sudo useradd -m -s /bin/bash gigapdf
sudo usermod -aG sudo gigapdf
```

### Install Dependencies / Installer les dépendances

```bash
# Install Python 3.12
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3.12-dev

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PM2
npm install -g pm2

# Install PostgreSQL 16
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install -y postgresql-16 postgresql-contrib-16

# Install Redis 7
sudo apt install -y redis-server

# Install optional: Tesseract OCR
sudo apt install -y tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng
```

---

## Docker Deployment

### Docker Compose Production / Docker Compose Production

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: gigapdf
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - gigapdf-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - gigapdf-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: deploy/Dockerfile.api
    restart: always
    environment:
      - APP_ENV=production
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/gigapdf
      - REDIS_URL=redis://redis:6379/0
      - S3_ENDPOINT_URL=${S3_ENDPOINT_URL}
      - S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
      - S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}
      - S3_BUCKET_NAME=${S3_BUCKET_NAME}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - gigapdf-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.${DOMAIN}`)"
      - "traefik.http.services.api.loadbalancer.server.port=8000"

  web:
    build:
      context: .
      dockerfile: deploy/Dockerfile.web
    restart: always
    environment:
      - NEXT_PUBLIC_API_URL=https://api.${DOMAIN}
      - NEXT_PUBLIC_WS_URL=wss://api.${DOMAIN}
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/gigapdf
    depends_on:
      - api
    networks:
      - gigapdf-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.web.rule=Host(`${DOMAIN}`)"
      - "traefik.http.services.web.loadbalancer.server.port=3000"

  admin:
    build:
      context: .
      dockerfile: deploy/Dockerfile.admin
    restart: always
    environment:
      - NEXT_PUBLIC_API_URL=https://api.${DOMAIN}
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/gigapdf
    depends_on:
      - api
    networks:
      - gigapdf-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.admin.rule=Host(`admin.${DOMAIN}`)"
      - "traefik.http.services.admin.loadbalancer.server.port=3001"

  celery:
    build:
      context: .
      dockerfile: deploy/Dockerfile.api
    restart: always
    command: celery -A app.tasks.celery_app worker --loglevel=info --concurrency=4
    environment:
      - APP_ENV=production
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/gigapdf
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=redis://redis:6379/1
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - gigapdf-network

  celery-beat:
    build:
      context: .
      dockerfile: deploy/Dockerfile.api
    restart: always
    command: celery -A app.tasks.celery_app beat --loglevel=info
    environment:
      - APP_ENV=production
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/gigapdf
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=redis://redis:6379/1
    depends_on:
      - celery
    networks:
      - gigapdf-network

  traefik:
    image: traefik:v3.0
    restart: always
    command:
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_certs:/letsencrypt
    networks:
      - gigapdf-network

networks:
  gigapdf-network:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  traefik_certs:
```

### Deployment Commands / Commandes de déploiement

```bash
# Create environment file
cp .env.example .env.production
# Edit .env.production with production values

# Build and start
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Run migrations
docker-compose -f docker-compose.prod.yml exec api alembic upgrade head

# Restart services
docker-compose -f docker-compose.prod.yml restart

# Stop all services
docker-compose -f docker-compose.prod.yml down
```

---

## Manual Deployment

### Deploy Application / Déployer l'application

```bash
# Switch to gigapdf user
sudo su - gigapdf

# Clone repository
git clone https://github.com/your-org/gigapdf.git
cd gigapdf

# Setup Python environment
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Setup Node.js dependencies
pnpm install

# Build packages
pnpm build:packages

# Build frontend applications
pnpm --filter web build
pnpm --filter admin build

# Configure environment
cp .env.example .env
# Edit .env with production values
nano .env

# Run database migrations
alembic upgrade head

# Setup Prisma
cd apps/web && npx prisma generate && npx prisma db push && cd ../..
cd apps/admin && npx prisma generate && npx prisma db push && cd ../..
```

---

## Nginx Configuration

### Main Configuration / Configuration principale

Create `/etc/nginx/sites-available/gigapdf`:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com api.your-domain.com admin.your-domain.com;
    return 301 https://$server_name$request_uri;
}

# Web Application
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';" always;

    # Proxy to Next.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}

# API Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Upload size limit
    client_max_body_size 500M;

    # Proxy to FastAPI
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}

# Admin Dashboard
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name admin.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Proxy to Admin Next.js
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Enable Configuration / Activer la configuration

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/gigapdf /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

## SSL/TLS Setup

### Let's Encrypt / Certificats Let's Encrypt

```bash
# Obtain certificates
sudo certbot --nginx -d your-domain.com -d api.your-domain.com -d admin.your-domain.com

# Test renewal
sudo certbot renew --dry-run

# Auto-renewal is configured automatically by certbot
```

---

## Process Management (PM2)

### PM2 Configuration / Configuration PM2

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'gigapdf-api',
      cwd: '/home/gigapdf/gigapdf',
      script: '.venv/bin/uvicorn',
      args: 'app.main:app --host 0.0.0.0 --port 8000 --workers 4',
      interpreter: 'none',
      env: {
        APP_ENV: 'production',
      },
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/gigapdf/api-error.log',
      out_file: '/var/log/gigapdf/api-out.log',
    },
    {
      name: 'gigapdf-web',
      cwd: '/home/gigapdf/gigapdf/apps/web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/gigapdf/web-error.log',
      out_file: '/var/log/gigapdf/web-out.log',
    },
    {
      name: 'gigapdf-admin',
      cwd: '/home/gigapdf/gigapdf/apps/admin',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/gigapdf/admin-error.log',
      out_file: '/var/log/gigapdf/admin-out.log',
    },
    {
      name: 'gigapdf-celery',
      cwd: '/home/gigapdf/gigapdf',
      script: '.venv/bin/celery',
      args: '-A app.tasks.celery_app worker --loglevel=info --concurrency=4',
      interpreter: 'none',
      env: {
        APP_ENV: 'production',
      },
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/gigapdf/celery-error.log',
      out_file: '/var/log/gigapdf/celery-out.log',
    },
    {
      name: 'gigapdf-celery-beat',
      cwd: '/home/gigapdf/gigapdf',
      script: '.venv/bin/celery',
      args: '-A app.tasks.celery_app beat --loglevel=info',
      interpreter: 'none',
      env: {
        APP_ENV: 'production',
      },
      max_memory_restart: '200M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/gigapdf/celery-beat-error.log',
      out_file: '/var/log/gigapdf/celery-beat-out.log',
    },
  ],
};
```

### PM2 Commands / Commandes PM2

```bash
# Create log directory
sudo mkdir -p /var/log/gigapdf
sudo chown gigapdf:gigapdf /var/log/gigapdf

# Start all services
pm2 start ecosystem.config.js

# View status
pm2 status

# View logs
pm2 logs

# Restart all
pm2 restart all

# Restart specific service
pm2 restart gigapdf-api

# Save process list
pm2 save

# Configure startup script
pm2 startup

# Monitor resources
pm2 monit
```

---

## Environment Variables

### Production Environment / Environnement de production

```bash
# Application
APP_ENV=production
APP_DEBUG=false
APP_SECRET_KEY=generate-with-openssl-rand-hex-64
APP_HOST=0.0.0.0
APP_PORT=8000
APP_WORKERS=4

# Database
DATABASE_URL=postgresql://gigapdf:secure-password@localhost:5432/gigapdf
DATABASE_POOL_SIZE=50

# Redis
REDIS_URL=redis://localhost:6379/0
SOCKETIO_MESSAGE_QUEUE=redis://localhost:6379/2

# Authentication
AUTH_JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
AUTH_JWT_ALGORITHM=RS256
AUTH_JWT_ISSUER=https://your-domain.com
AUTH_JWT_AUDIENCE=giga-pdf

# S3 Storage
S3_ENDPOINT_URL=https://s3.fr-par.scw.cloud
S3_ACCESS_KEY_ID=your-production-key
S3_SECRET_ACCESS_KEY=your-production-secret
S3_BUCKET_NAME=gigapdf-production
S3_REGION=fr-par

# Celery
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=db+postgresql://gigapdf:secure-password@localhost:5432/gigapdf_celery
JOB_TIMEOUT_SECONDS=3600
ASYNC_THRESHOLD_MB=10

# Email
MAIL_SERVER=smtp.sendgrid.net
MAIL_PORT=587
MAIL_USERNAME=apikey
MAIL_PASSWORD=your-sendgrid-api-key
MAIL_FROM_EMAIL=noreply@your-domain.com
MAIL_FROM_NAME=GigaPDF
MAIL_USE_TLS=true

# Stripe
STRIPE_SECRET_KEY=sk_live_your-live-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# CORS
CORS_ALLOWED_ORIGINS=https://your-domain.com,https://admin.your-domain.com

# Limits
MAX_UPLOAD_SIZE_MB=500
MAX_PAGES_PER_DOCUMENT=5000
```

---

## Database Setup

### Production PostgreSQL / PostgreSQL de production

```bash
# Connect as postgres user
sudo -u postgres psql

# Create production user with strong password
CREATE USER gigapdf WITH PASSWORD 'your-very-secure-password-here';

# Create databases
CREATE DATABASE gigapdf OWNER gigapdf;
CREATE DATABASE gigapdf_celery OWNER gigapdf;

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE gigapdf TO gigapdf;
GRANT ALL PRIVILEGES ON DATABASE gigapdf_celery TO gigapdf;

# Enable extensions
\c gigapdf
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

\q
```

### PostgreSQL Optimization / Optimisation PostgreSQL

Edit `/etc/postgresql/16/main/postgresql.conf`:

```ini
# Memory
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 64MB
maintenance_work_mem = 512MB

# Checkpoints
checkpoint_completion_target = 0.9
wal_buffers = 64MB
min_wal_size = 1GB
max_wal_size = 4GB

# Connections
max_connections = 200

# Query planning
random_page_cost = 1.1
effective_io_concurrency = 200
```

---

## Storage Configuration

### S3 Storage Setup / Configuration stockage S3

#### Scaleway Object Storage

1. Create bucket in Scaleway Console
2. Generate API credentials
3. Configure CORS policy:

```json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedOrigins": ["https://your-domain.com"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

---

## Monitoring & Logging

### Log Management / Gestion des logs

```bash
# Configure logrotate
sudo nano /etc/logrotate.d/gigapdf
```

```
/var/log/gigapdf/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 gigapdf gigapdf
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Health Checks / Vérifications de santé

```bash
# Backend health
curl https://api.your-domain.com/health

# Web app
curl -I https://your-domain.com

# Redis
redis-cli ping

# PostgreSQL
pg_isready -h localhost -p 5432 -U gigapdf
```

---

## Backup & Recovery

### Database Backup / Sauvegarde base de données

```bash
# Manual backup
pg_dump -U gigapdf -h localhost gigapdf > backup_$(date +%Y%m%d_%H%M%S).sql

# Automated backup script
cat << 'EOF' > /home/gigapdf/backup.sh
#!/bin/bash
BACKUP_DIR="/home/gigapdf/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Database backup
pg_dump -U gigapdf -h localhost gigapdf | gzip > "$BACKUP_DIR/db_$TIMESTAMP.sql.gz"

# Keep only last 7 days
find $BACKUP_DIR -type f -mtime +7 -delete

# Upload to S3
aws s3 cp "$BACKUP_DIR/db_$TIMESTAMP.sql.gz" s3://gigapdf-backups/
EOF

chmod +x /home/gigapdf/backup.sh

# Add to crontab
crontab -e
# Add: 0 2 * * * /home/gigapdf/backup.sh
```

### Recovery / Récupération

```bash
# Restore from backup
gunzip -c backup_20250101_020000.sql.gz | psql -U gigapdf -h localhost gigapdf
```

---

## Security Hardening

### Firewall Rules / Règles pare-feu

```bash
# Allow only necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Fail2Ban Configuration / Configuration Fail2Ban

```bash
sudo apt install fail2ban

# Configure jail
sudo nano /etc/fail2ban/jail.local
```

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
```

---

## Scaling

### Horizontal Scaling / Mise à l'échelle horizontale

For high traffic, consider:

1. **Load Balancer**: Use Nginx or HAProxy
2. **Multiple API Instances**: Run multiple uvicorn workers
3. **Database Read Replicas**: PostgreSQL streaming replication
4. **Redis Cluster**: For session management
5. **CDN**: Cloudflare or AWS CloudFront for static assets

### Vertical Scaling Recommendations / Recommandations mise à l'échelle verticale

| Traffic Level | CPU | RAM | Storage |
|--------------|-----|-----|---------|
| < 1K users | 2 vCPU | 4 GB | 50 GB |
| 1K-10K users | 4 vCPU | 8 GB | 200 GB |
| 10K-50K users | 8 vCPU | 16 GB | 500 GB |
| > 50K users | 16+ vCPU | 32+ GB | 1+ TB |

---

## Deployment Checklist / Liste de vérification du déploiement

- [ ] Server provisioned and secured
- [ ] PostgreSQL installed and configured
- [ ] Redis installed and running
- [ ] S3 bucket created and configured
- [ ] SSL certificates obtained
- [ ] Nginx configured and tested
- [ ] Application deployed and running
- [ ] Database migrations applied
- [ ] PM2 processes running
- [ ] Logging configured
- [ ] Backups scheduled
- [ ] Monitoring setup
- [ ] DNS records configured
- [ ] Firewall rules applied
- [ ] Health checks passing

---

## Next Steps / Prochaines étapes

- **[API Reference](../api/README.md)** - API documentation
- **[WebSocket Guide](../WEBSOCKET_COLLABORATION.md)** - Real-time features
- **[Architecture Overview](../ARCHITECTURE.md)** - System design
