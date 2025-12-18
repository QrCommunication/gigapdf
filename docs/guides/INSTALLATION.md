# Installation Guide / Guide d'installation

Complete installation instructions for GigaPDF on all supported platforms.

Instructions d'installation complètes pour GigaPDF sur toutes les plateformes supportées.

---

## Table of Contents / Table des matières

1. [Prerequisites / Prérequis](#prerequisites--prérequis)
2. [Ubuntu/Debian Installation](#ubuntudebian-installation)
3. [macOS Installation](#macos-installation)
4. [Windows Installation (WSL2)](#windows-installation-wsl2)
5. [Docker Installation](#docker-installation)
6. [Environment Variables](#environment-variables)
7. [Database Setup](#database-setup)
8. [First Run](#first-run)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites / Prérequis

### System Requirements / Configuration requise

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 2 cores | 4+ cores |
| **RAM** | 4 GB | 8+ GB |
| **Storage** | 10 GB | 50+ GB SSD |
| **OS** | Ubuntu 22.04+ / macOS 13+ / Windows 11 (WSL2) | Ubuntu 24.04 LTS |

### Required Software / Logiciels requis

| Software | Version | Purpose |
|----------|---------|---------|
| **Python** | 3.12+ | Backend API |
| **Node.js** | 20+ | Frontend applications |
| **PostgreSQL** | 16+ | Primary database |
| **Redis** | 7+ | Caching and message queue |
| **pnpm** | 9+ | Node.js package manager |
| **Git** | 2.30+ | Version control |

### Optional Software / Logiciels optionnels

| Software | Version | Purpose |
|----------|---------|---------|
| **Tesseract OCR** | 5.x | Text extraction from images |
| **Poppler** | 22+ | PDF utilities |
| **MuPDF** | 1.23+ | PDF rendering |

---

## Ubuntu/Debian Installation

### Step 1: Update System / Étape 1 : Mise à jour du système

```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2: Install Python 3.12 / Étape 2 : Installer Python 3.12

```bash
# Add deadsnakes PPA for Python 3.12 (Ubuntu < 24.04)
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update

# Install Python 3.12
sudo apt install -y python3.12 python3.12-venv python3.12-dev

# Verify installation
python3.12 --version
```

### Step 3: Install PostgreSQL 16 / Étape 3 : Installer PostgreSQL 16

```bash
# Add PostgreSQL repository
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update

# Install PostgreSQL 16
sudo apt install -y postgresql-16 postgresql-contrib-16

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify installation
psql --version
```

### Step 4: Install Redis 7 / Étape 4 : Installer Redis 7

```bash
# Install Redis
sudo apt install -y redis-server

# Start and enable Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify installation
redis-cli ping  # Should return PONG
```

### Step 5: Install Node.js 20 / Étape 5 : Installer Node.js 20

```bash
# Install Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version

# Install pnpm globally
npm install -g pnpm

# Verify pnpm
pnpm --version
```

### Step 6: Install Optional Dependencies / Étape 6 : Installer les dépendances optionnelles

```bash
# Tesseract OCR (for text extraction from scanned PDFs)
sudo apt install -y tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng tesseract-ocr-deu tesseract-ocr-spa

# PDF processing libraries
sudo apt install -y libmupdf-dev mupdf-tools poppler-utils

# Image processing
sudo apt install -y libmagickwand-dev
```

### Step 7: Clone and Setup Project / Étape 7 : Cloner et configurer le projet

```bash
# Clone repository
git clone https://github.com/your-org/gigapdf.git
cd gigapdf

# Create Python virtual environment
python3.12 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt  # For development

# Install Node.js dependencies
pnpm install

# Build shared packages
pnpm --filter @giga-pdf/ui build
```

---

## macOS Installation

### Step 1: Install Homebrew / Étape 1 : Installer Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2: Install Dependencies / Étape 2 : Installer les dépendances

```bash
# Install all required software
brew install python@3.12 postgresql@16 redis node@20 git

# Install optional dependencies
brew install tesseract tesseract-lang poppler mupdf

# Link Node.js 20
brew link node@20

# Start services
brew services start postgresql@16
brew services start redis

# Install pnpm
npm install -g pnpm
```

### Step 3: Clone and Setup / Étape 3 : Cloner et configurer

```bash
# Clone repository
git clone https://github.com/your-org/gigapdf.git
cd gigapdf

# Create Python virtual environment
python3.12 -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
pnpm install
pnpm --filter @giga-pdf/ui build
```

---

## Windows Installation (WSL2)

### Step 1: Enable WSL2 / Étape 1 : Activer WSL2

```powershell
# Run in PowerShell as Administrator
wsl --install -d Ubuntu-24.04
```

### Step 2: Configure WSL2 / Étape 2 : Configurer WSL2

Restart your computer, then open Ubuntu from the Start menu.

```bash
# Update system
sudo apt update && sudo apt upgrade -y
```

### Step 3: Follow Ubuntu Instructions / Étape 3 : Suivre les instructions Ubuntu

Follow the [Ubuntu/Debian Installation](#ubuntudebian-installation) steps above.

### Additional Notes for Windows / Notes supplémentaires pour Windows

- Use VS Code with Remote WSL extension for development
- Access files at `\\wsl$\Ubuntu-24.04\home\<username>\gigapdf`
- PostgreSQL and Redis run inside WSL

---

## Docker Installation

### Prerequisites / Prérequis

- Docker 24+
- Docker Compose 2.20+

### Quick Start / Démarrage rapide

```bash
# Clone repository
git clone https://github.com/your-org/gigapdf.git
cd gigapdf

# Copy environment file
cp .env.example .env

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Docker Compose Services

| Service | Port | Description |
|---------|------|-------------|
| `api` | 8000 | FastAPI backend |
| `web` | 3000 | Next.js frontend |
| `admin` | 3001 | Admin dashboard |
| `db` | 5432 | PostgreSQL database |
| `redis` | 6379 | Redis cache |
| `celery` | - | Background worker |

### docker-compose.yml Example

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: gigapdf
      POSTGRES_PASSWORD: gigapdf
      POSTGRES_DB: gigapdf
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      DATABASE_URL: postgresql://gigapdf:gigapdf@db:5432/gigapdf
      REDIS_URL: redis://redis:6379/0
    ports:
      - "8000:8000"
    depends_on:
      - db
      - redis

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    ports:
      - "3000:3000"
    depends_on:
      - api

  celery:
    build:
      context: .
      dockerfile: Dockerfile.api
    command: celery -A app.tasks.celery_app worker --loglevel=info
    environment:
      DATABASE_URL: postgresql://gigapdf:gigapdf@db:5432/gigapdf
      REDIS_URL: redis://redis:6379/0
    depends_on:
      - db
      - redis

volumes:
  postgres_data:
```

---

## Environment Variables

### Backend Configuration (.env)

Create the `.env` file in the project root:

```bash
cp .env.example .env
```

#### Application Settings / Paramètres de l'application

```bash
# Environment: development | staging | production
APP_ENV=development

# Enable debug mode (disable in production)
APP_DEBUG=true

# Secret key for encryption (minimum 32 characters)
# Generate with: openssl rand -hex 32
APP_SECRET_KEY=your-secret-key-change-in-production-min-32-chars

# Server binding
APP_HOST=0.0.0.0
APP_PORT=8000
APP_WORKERS=4
```

#### Database Configuration / Configuration base de données

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://gigapdf:gigapdf@localhost:5432/gigapdf

# Connection pool size
DATABASE_POOL_SIZE=20
```

#### Redis Configuration

```bash
# Redis connection string
REDIS_URL=redis://localhost:6379/0

# WebSocket message queue (separate database)
SOCKETIO_MESSAGE_QUEUE=redis://localhost:6379/2
```

#### Authentication / Authentification

```bash
# JWT public key for token verification
# Can be a PEM public key or JWKS URL
AUTH_JWT_PUBLIC_KEY=your-jwt-public-key-or-jwks-url

# JWT algorithm (RS256 recommended)
AUTH_JWT_ALGORITHM=RS256

# JWT issuer (your auth domain)
AUTH_JWT_ISSUER=https://auth.example.com

# JWT audience
AUTH_JWT_AUDIENCE=giga-pdf
```

#### Storage Configuration / Configuration stockage

```bash
# Local storage path
STORAGE_PATH=/var/lib/gigapdf/documents

# Maximum storage size in GB
STORAGE_MAX_SIZE_GB=100

# S3-compatible storage (Scaleway, AWS, MinIO)
S3_ENDPOINT_URL=https://s3.fr-par.scw.cloud
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=gigapdf-documents
S3_REGION=fr-par
```

#### OCR Configuration / Configuration OCR

```bash
# Tesseract paths
TESSERACT_PATH=/usr/bin/tesseract
TESSERACT_DATA_PATH=/usr/share/tesseract-ocr/5/tessdata

# Default OCR languages
OCR_DEFAULT_LANGUAGES=fra+eng
```

#### Celery Configuration (Async Tasks) / Configuration Celery

```bash
# Message broker
CELERY_BROKER_URL=redis://localhost:6379/1

# Result backend
CELERY_RESULT_BACKEND=db+postgresql://gigapdf:gigapdf@localhost:5432/gigapdf_celery

# Job timeout in seconds
JOB_TIMEOUT_SECONDS=3600

# Threshold for async processing (MB)
ASYNC_THRESHOLD_MB=10
```

#### Limits / Limites

```bash
# Maximum upload size in MB
MAX_UPLOAD_SIZE_MB=500

# Maximum pages per document
MAX_PAGES_PER_DOCUMENT=5000

# Preview image DPI
PREVIEW_MAX_DPI=600

# History states to keep
HISTORY_MAX_STATES=100
```

#### Email Configuration / Configuration email

```bash
# SMTP server settings
MAIL_SERVER=smtp.example.com
MAIL_PORT=587
MAIL_USERNAME=your-email@example.com
MAIL_PASSWORD=your-email-password
MAIL_FROM_EMAIL=noreply@example.com
MAIL_FROM_NAME=GigaPDF

# Security settings
MAIL_USE_TLS=true
MAIL_USE_SSL=false
MAIL_STARTTLS=true
MAIL_TIMEOUT=30

# Frontend URL for email links
FRONTEND_URL=http://localhost:3000
```

#### Stripe Configuration (Billing) / Configuration Stripe

```bash
# API keys from https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_your_secret_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key

# Webhook secret from https://dashboard.stripe.com/webhooks
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

#### CORS Configuration

```bash
# Allowed origins (comma-separated)
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

### Frontend Configuration (apps/web/.env)

```bash
# Application URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

# BetterAuth Configuration
BETTER_AUTH_SECRET=your-long-random-secret-key-for-auth
BETTER_AUTH_URL=http://localhost:3000

# Database (same as backend)
DATABASE_URL=postgresql://gigapdf:gigapdf@localhost:5432/gigapdf

# Stripe (optional, for client-side checkout)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

### Admin Configuration (apps/admin/.env)

```bash
# Application URLs
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

# BetterAuth Configuration (same secret as web)
BETTER_AUTH_SECRET=your-long-random-secret-key-for-auth
BETTER_AUTH_URL=http://localhost:3001

# Database
DATABASE_URL=postgresql://gigapdf:gigapdf@localhost:5432/gigapdf
```

---

## Database Setup

### Create PostgreSQL User and Databases / Créer l'utilisateur et les bases de données

```bash
# Connect to PostgreSQL as superuser
sudo -u postgres psql

# Create user
CREATE USER gigapdf WITH PASSWORD 'your-secure-password';

# Create main database
CREATE DATABASE gigapdf OWNER gigapdf;

# Create Celery results database
CREATE DATABASE gigapdf_celery OWNER gigapdf;

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE gigapdf TO gigapdf;
GRANT ALL PRIVILEGES ON DATABASE gigapdf_celery TO gigapdf;

# Exit
\q
```

### Run Migrations / Exécuter les migrations

```bash
# Activate virtual environment
source venv/bin/activate

# Run Alembic migrations (backend tables)
alembic upgrade head

# Generate Prisma client and sync auth tables
cd apps/web
npx prisma generate
npx prisma db push
cd ../..

# For admin app (if using separate Prisma schema)
cd apps/admin
npx prisma generate
npx prisma db push
cd ../..
```

### Seed Initial Data / Données initiales

```bash
# Create super admin user (admin app)
cd apps/admin
pnpm seed:admin
cd ../..
```

---

## First Run

### Start All Services / Démarrer tous les services

Open multiple terminal windows:

**Terminal 1 - Backend API:**
```bash
cd gigapdf
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Web Frontend:**
```bash
cd gigapdf
pnpm --filter web dev
```

**Terminal 3 - Admin Panel:**
```bash
cd gigapdf
pnpm --filter admin dev
```

**Terminal 4 - Celery Worker (optional):**
```bash
cd gigapdf
source venv/bin/activate
celery -A app.tasks.celery_app worker --loglevel=info
```

### Verify Installation / Vérifier l'installation

| Service | URL | Expected |
|---------|-----|----------|
| Backend API | http://localhost:8000/health | `{"status": "healthy"}` |
| Swagger UI | http://localhost:8000/api/docs | API documentation |
| Web App | http://localhost:3000 | Login page |
| Admin Panel | http://localhost:3001 | Admin login |

### Test API / Tester l'API

```bash
# Health check
curl http://localhost:8000/health

# API version
curl http://localhost:8000/api/v1/

# Test with authentication (development mode)
curl -H "Authorization: Bearer test-user-id" \
  http://localhost:8000/api/v1/storage/documents
```

---

## Troubleshooting

### Common Issues / Problèmes courants

#### PostgreSQL Connection Refused / Connexion PostgreSQL refusée

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Start if not running
sudo systemctl start postgresql

# Check listening ports
sudo netstat -tlnp | grep 5432
```

#### Redis Connection Failed / Connexion Redis échouée

```bash
# Check Redis status
redis-cli ping

# Start Redis if not running
sudo systemctl start redis-server
```

#### Python Package Installation Errors / Erreurs d'installation de packages Python

```bash
# Install build dependencies
sudo apt install -y build-essential python3.12-dev libpq-dev

# Upgrade pip
pip install --upgrade pip setuptools wheel
```

#### Node.js/pnpm Errors / Erreurs Node.js/pnpm

```bash
# Clear pnpm cache
pnpm store prune

# Delete node_modules and reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

#### Permission Denied Errors / Erreurs de permissions

```bash
# Storage directory
sudo mkdir -p /var/lib/gigapdf/documents
sudo chown -R $USER:$USER /var/lib/gigapdf

# Virtual environment
sudo chown -R $USER:$USER venv/
```

#### Alembic Migration Errors / Erreurs de migration Alembic

```bash
# Check current revision
alembic current

# View migration history
alembic history

# Force to specific revision (if needed)
alembic stamp head
```

#### Prisma Client Errors / Erreurs client Prisma

```bash
# Regenerate Prisma client
cd apps/web
npx prisma generate

# Reset database (DELETES ALL DATA)
npx prisma db push --force-reset
```

### Getting Help / Obtenir de l'aide

- **GitHub Issues:** [Report a bug](https://github.com/your-org/gigapdf/issues)
- **Discussions:** [Ask questions](https://github.com/your-org/gigapdf/discussions)
- **Documentation:** [Full docs](https://docs.gigapdf.com)

---

## Next Steps / Prochaines étapes

After successful installation:

1. **[Development Guide](DEVELOPMENT.md)** - Learn the development workflow
2. **[API Reference](../api/README.md)** - Explore the REST API
3. **[WebSocket Guide](../WEBSOCKET_COLLABORATION.md)** - Set up real-time collaboration
4. **[Deployment Guide](DEPLOYMENT.md)** - Deploy to production
