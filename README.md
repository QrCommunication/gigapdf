<p align="center">
  <img src="apps/web/public/logo.svg" alt="GigaPDF Logo" width="80" height="80" />
</p>

<h1 align="center">GigaPDF</h1>

<p align="center">
  <strong>Open Source WYSIWYG PDF Editor</strong>
</p>

<p align="center">
  A powerful, self-hostable PDF editing platform with visual canvas editor, REST API, and real-time collaboration.
</p>

<p align="center">
  <a href="https://github.com/ronylicha/gigapdf/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  </a>
  <a href="https://github.com/ronylicha/gigapdf/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/ronylicha/gigapdf/ci.yml?branch=main" alt="CI Status" />
  </a>
  <a href="https://github.com/ronylicha/gigapdf/stargazers">
    <img src="https://img.shields.io/github/stars/ronylicha/gigapdf" alt="GitHub Stars" />
  </a>
  <a href="https://giga-pdf.com">
    <img src="https://img.shields.io/badge/demo-giga--pdf.com-green" alt="Demo" />
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="#api">API</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Features

### PDF Editing
- **Visual WYSIWYG Editor** — Canvas-based editing with drag-and-drop
- **Text Manipulation** — Add, edit, and format text with full font support
- **Images & Shapes** — Insert, resize, and position visual elements
- **Annotations** — Highlights, comments, stamps, and freehand drawings
- **Form Builder** — Create and fill interactive PDF forms

### Document Operations
- **Page Management** — Add, remove, reorder, rotate pages
- **Merge & Split** — Combine multiple PDFs or extract pages
- **OCR Integration** — Extract text from scanned documents (Tesseract)
- **Format Conversion** — Export to PNG, JPEG, DOCX, HTML

### Collaboration
- **Real-time Editing** — Multi-user collaboration via WebSocket
- **Cursor Tracking** — See other users' positions
- **Element Locking** — Prevent concurrent edits

### Enterprise Ready
- **REST API** — Full programmatic access
- **Multi-tenant** — Organizations with shared quotas
- **Stripe Billing** — Subscription management
- **Self-hostable** — Deploy on your own infrastructure

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | FastAPI, SQLAlchemy 2.x, Celery, Socket.IO |
| **Frontend** | Next.js 15, React 19, Tailwind CSS |
| **Database** | PostgreSQL 16, Redis 7 |
| **Auth** | BetterAuth (JWT/RS256) |
| **Storage** | S3-compatible (Scaleway, AWS, MinIO) |
| **PDF** | PyMuPDF, pdf-lib, Tesseract OCR |
| **Billing** | Stripe |

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- pnpm 9+

### Installation

```bash
# Clone the repository
git clone https://github.com/ronylicha/gigapdf.git
cd gigapdf

# Install dependencies
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Setup database
./database/setup.sh
alembic upgrade head

# Generate Prisma clients
pnpm --filter web prisma db pull && pnpm --filter web prisma generate
pnpm --filter admin prisma db pull && pnpm --filter admin prisma generate

# Build shared packages
pnpm build:packages

# Start all services
pnpm dev:all
```

### Access

| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| Admin Panel | http://localhost:3001 |
| API Docs | http://localhost:8000/api/docs |

---

## Self-Hosting

GigaPDF is designed to be self-hosted. You have complete control over your data and infrastructure.

### Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/ronylicha/gigapdf.git
cd gigapdf

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start with Docker Compose
docker-compose up -d
```

### Manual Deployment

#### 1. Server Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Storage | 20 GB | 100+ GB SSD |
| OS | Ubuntu 22.04 | Ubuntu 24.04 |

#### 2. Install Dependencies

```bash
# System packages
sudo apt update
sudo apt install -y python3.12 python3.12-venv nodejs npm postgresql redis-server tesseract-ocr nginx

# Install pnpm
npm install -g pnpm

# Install Certbot for SSL
sudo apt install -y certbot python3-certbot-nginx
```

#### 3. Clone and Configure

```bash
# Clone to /opt
sudo mkdir -p /opt/gigapdf
sudo chown $USER:$USER /opt/gigapdf
git clone https://github.com/ronylicha/gigapdf.git /opt/gigapdf
cd /opt/gigapdf

# Configure environment
cp .env.example .env
nano .env  # Add your credentials
```

#### 4. Deploy

```bash
# Run the deployment script
bash deploy/deploy.sh
```

The script will:
- Install Python and Node dependencies
- Build all packages and apps
- Run database migrations
- Configure systemd services
- Setup Nginx reverse proxy

#### 5. SSL Certificate

```bash
sudo certbot --nginx -d yourdomain.com
```

#### 6. Verify

```bash
# Check services
systemctl status gigapdf-api gigapdf-web gigapdf-admin

# Check health
curl -I https://yourdomain.com
curl https://yourdomain.com/api/v1/health
```

### Environment Variables

```bash
# Application
APP_ENV=production
APP_SECRET_KEY=your-secret-key-min-32-chars

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/gigapdf

# Redis
REDIS_URL=redis://localhost:6379/0

# Storage (S3-compatible)
S3_ENDPOINT_URL=https://s3.fr-par.scw.cloud
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_BUCKET_NAME=gigapdf-documents
S3_REGION=fr-par

# Authentication
AUTH_JWT_PUBLIC_KEY=your-public-key
AUTH_JWT_ALGORITHM=RS256

# Stripe (optional)
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### Updating

```bash
cd /opt/gigapdf
git pull origin main
bash deploy/deploy.sh
```

---

## API

### Documentation

Once running, access the interactive API docs:

| URL | Format |
|-----|--------|
| `/api/docs` | Swagger UI |
| `/api/redoc` | ReDoc |
| `/api/v1/openapi.json` | OpenAPI spec |

### Core Endpoints

```bash
# Documents
POST   /api/v1/documents/upload           # Upload PDF
GET    /api/v1/documents/{id}             # Get document
GET    /api/v1/documents/{id}/download    # Download PDF
DELETE /api/v1/documents/{id}             # Delete document

# Pages
GET    /api/v1/documents/{id}/pages/{num}          # Get page
POST   /api/v1/documents/{id}/pages                # Add page
DELETE /api/v1/documents/{id}/pages/{num}          # Delete page
PUT    /api/v1/documents/{id}/pages/reorder        # Reorder pages

# Operations
POST   /api/v1/documents/merge            # Merge PDFs
POST   /api/v1/documents/{id}/split       # Split PDF
POST   /api/v1/documents/{id}/ocr         # Run OCR
POST   /api/v1/documents/{id}/export      # Export to format
```

---

## Project Structure

```
gigapdf/
├── app/                    # FastAPI Backend (Python)
│   ├── api/v1/             # REST API endpoints
│   ├── models/             # SQLAlchemy models
│   ├── services/           # Business logic
│   └── tasks/              # Celery async tasks
│
├── apps/
│   ├── web/                # Next.js Frontend (port 3000)
│   ├── admin/              # Admin Dashboard (port 3001)
│   └── mobile/             # Expo mobile app
│
├── packages/               # Shared packages (@giga-pdf/*)
│   ├── ui/                 # UI components (shadcn/ui)
│   ├── api/                # API client
│   ├── canvas/             # PDF canvas renderer
│   └── editor/             # WYSIWYG editor core
│
├── database/               # SQL setup scripts
├── migrations/             # Alembic migrations
├── deploy/                 # Deployment configs
└── docs/                   # Documentation
```

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/gigapdf.git
cd gigapdf

# Create branch
git checkout -b feature/my-feature

# Make changes and test
pytest && pnpm test

# Submit PR
```

### Code Style

| Language | Tools |
|----------|-------|
| Python | Black, Ruff, MyPy |
| TypeScript | ESLint, Prettier |
| Commits | Conventional Commits |

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Support

- **Issues:** [GitHub Issues](https://github.com/ronylicha/gigapdf/issues)
- **Discussions:** [GitHub Discussions](https://github.com/ronylicha/gigapdf/discussions)
- **Website:** [giga-pdf.com](https://giga-pdf.com)

---

<p align="center">
  Made with ❤️ by <a href="https://ronylicha.net">Rony Licha</a> and the open source community
</p>
