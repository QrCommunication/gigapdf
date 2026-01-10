# GigaPDF - Open Source WYSIWYG PDF Editor

<p align="center">
  <img src="docs/assets/logo.png" alt="GigaPDF Logo" width="200"/>
</p>

<p align="center">
  <strong>A powerful, open-source PDF editing platform with visual canvas editor, REST API, and real-time collaboration.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Features

### PDF Editing
- **Visual WYSIWYG Editor** - Canvas-based editing with drag-and-drop interface
- **Text Manipulation** - Add, edit, and format text with full font support
- **Image Handling** - Insert, resize, and position images
- **Annotations** - Highlights, comments, stamps, and drawings
- **Form Builder** - Create and fill interactive PDF forms
- **Layers & Bookmarks** - Organize document structure

### Document Operations
- **Page Management** - Add, remove, reorder, rotate, and resize pages
- **Merge & Split** - Combine multiple PDFs or extract pages
- **OCR Integration** - Extract text from scanned documents (Tesseract)
- **Format Conversion** - Export to PNG, JPEG, DOCX, HTML, and more
- **Security** - Password protection, encryption, and permission management

### Collaboration & API
- **Real-time Collaboration** - Multi-user editing via WebSocket
- **Cursor Tracking** - See other users' positions and selections
- **Element Locking** - Prevent concurrent edits to the same element
- **REST API** - Full programmatic access to all features
- **Webhooks** - Event notifications for integrations

### Enterprise Features
- **Multi-tenant Support** - Organizations with shared quotas
- **Billing Integration** - Stripe-powered subscription management
- **Usage Tracking** - Monitor document processing and storage
- **Admin Dashboard** - Manage users, plans, and settings

---

## Quick Start

### Prerequisites

| Component | Version | Purpose |
|-----------|---------|---------|
| Python | 3.12+ | Backend API |
| Node.js | 20+ | Frontend apps |
| PostgreSQL | 16+ | Database |
| Redis | 7+ | Caching & queues |
| pnpm | 9+ | Package management |
| Tesseract | 5+ | OCR (optional) |
| S3-Compatible | - | Document storage |

### Installation (5 minutes)

```bash
# 1. Clone the repository
git clone https://github.com/your-org/gigapdf.git
cd gigapdf

# 2. Install dependencies
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your database credentials and S3 settings

# 4. Setup database (schema + migrations)
./database/setup.sh
alembic upgrade head

# 5. Generate Prisma clients
pnpm --filter web prisma db pull && pnpm --filter web prisma generate
pnpm --filter admin prisma db pull && pnpm --filter admin prisma generate

# 6. Build shared packages
pnpm build:packages

# 7. Start development servers (in separate terminals)
uvicorn app.main:app --reload --port 8000      # Backend API
pnpm --filter web dev                           # Web app (port 3000)
pnpm --filter admin dev                         # Admin panel (port 3001)
```

> **Detailed instructions:** See [Installation Guide](docs/guides/INSTALLATION.md)

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Installation Guide](docs/guides/INSTALLATION.md) | Complete setup instructions for all platforms |
| [Development Guide](docs/guides/DEVELOPMENT.md) | Local development workflow and best practices |
| [Deployment Guide](docs/guides/DEPLOYMENT.md) | Production deployment with Docker, PM2, Nginx |
| [Architecture Overview](docs/ARCHITECTURE.md) | System design and component documentation |
| [API Reference](docs/api/README.md) | REST API endpoints and examples |
| [WebSocket Guide](docs/WEBSOCKET_COLLABORATION.md) | Real-time collaboration setup |
| [Billing Integration](docs/api/billing.md) | Stripe subscription management |

---

## Architecture

```
gigapdf/
├── app/                        # FastAPI Backend (Python)
│   ├── api/v1/                 # REST API endpoints
│   ├── models/                 # SQLAlchemy models
│   ├── services/               # Business logic
│   ├── schemas/                # Pydantic schemas
│   └── tasks/                  # Celery async tasks
│
├── apps/
│   ├── web/                    # Next.js 15 Frontend
│   │   ├── src/app/            # App Router pages
│   │   ├── src/components/     # React components
│   │   └── prisma/             # Auth database schema
│   │
│   ├── admin/                  # Admin Dashboard
│   │   ├── src/app/            # Admin pages
│   │   └── prisma/             # Admin database schema
│   │
│   └── mobile/                 # Expo mobile app
│
├── packages/
│   ├── ui/                     # Shared UI components (shadcn/ui)
│   ├── api/                    # API client library
│   ├── types/                  # TypeScript definitions
│   ├── canvas/                 # PDF canvas renderer
│   ├── editor/                 # WYSIWYG editor core
│   ├── billing/                # Stripe integration
│   ├── s3/                     # Object storage client
│   └── logger/                 # Logging utilities
│
├── database/                   # SQL bootstrap + setup scripts
├── migrations/                 # Alembic database migrations
├── tests/                      # Unit and integration tests
└── docs/                       # Documentation
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend API** | FastAPI, SQLAlchemy 2.x, Celery, Socket.IO |
| **Frontend** | Next.js 15, React 19, Tailwind CSS, Radix UI |
| **Database** | PostgreSQL 16, Redis 7 |
| **Authentication** | BetterAuth (JWT/RS256) |
| **Storage** | S3-compatible (Scaleway, AWS, MinIO) |
| **PDF Processing** | PyMuPDF, pdf-lib, Tesseract OCR |
| **Billing** | Stripe |

---

## API Overview

### Interactive Documentation
  
Once the backend is running, access the API documentation:

| URL | Description |
|-----|-------------|
| http://localhost:8000/api/docs | Swagger UI (interactive) |
| http://localhost:8000/api/redoc | ReDoc (reference) |
| http://localhost:8000/api/v1/openapi.json | OpenAPI specification |

### Core Endpoints

#### Documents
```bash
POST   /api/v1/documents/upload          # Upload PDF
GET    /api/v1/documents/{id}            # Get document info
GET    /api/v1/documents/{id}/download   # Download PDF
DELETE /api/v1/documents/{id}            # Delete document
```

#### Pages
```bash
GET    /api/v1/documents/{id}/pages/{num}         # Get page
GET    /api/v1/documents/{id}/pages/{num}/preview # Page preview image
POST   /api/v1/documents/{id}/pages               # Add page
DELETE /api/v1/documents/{id}/pages/{num}         # Delete page
PUT    /api/v1/documents/{id}/pages/reorder       # Reorder pages
PUT    /api/v1/documents/{id}/pages/{num}/rotate  # Rotate page
```

#### Elements
```bash
GET    /api/v1/documents/{id}/pages/{num}/elements  # List elements
POST   /api/v1/documents/{id}/pages/{num}/elements  # Create element
PATCH  /api/v1/documents/{id}/elements/{eid}        # Update element
DELETE /api/v1/documents/{id}/elements/{eid}        # Delete element
```

#### Operations
```bash
POST   /api/v1/documents/merge           # Merge multiple PDFs
POST   /api/v1/documents/{id}/split      # Split PDF
POST   /api/v1/documents/{id}/ocr        # Run OCR
POST   /api/v1/documents/{id}/export     # Export to format
```

> **Complete API reference:** See [API Documentation](docs/api/README.md)

---

## Environment Variables

### Backend (.env)

```bash
# Application
APP_ENV=development              # development | production
APP_SECRET_KEY=your-secret-key   # Min 32 characters
APP_HOST=0.0.0.0
APP_PORT=8000

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
AUTH_JWT_ISSUER=https://your-domain.com

# Celery (async tasks)
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=db+postgresql://user:pass@localhost:5432/gigapdf_celery

# Stripe (billing)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### Frontend (apps/web/.env)

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

BETTER_AUTH_SECRET=your-auth-secret
BETTER_AUTH_URL=http://localhost:3000

DATABASE_URL=postgresql://user:pass@localhost:5432/gigapdf
```

> **Complete configuration:** See [Installation Guide](docs/guides/INSTALLATION.md#environment-variables)

---

## Testing

```bash
# Backend tests
pytest                              # Run all tests
pytest --cov=app --cov-report=html  # With coverage report
pytest tests/unit/                  # Unit tests only
pytest tests/integration/           # Integration tests only

# Frontend tests
pnpm test                           # All apps
pnpm --filter web test              # Web app only

# Code quality
black app tests                     # Format Python code
ruff check app tests                # Lint Python code
mypy app                            # Type checking
pnpm lint                           # Lint TypeScript
```

---

## Development

### Running Services

```bash
# Terminal 1: Backend API
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2: Web Frontend
pnpm --filter web dev

# Terminal 3: Admin Panel
pnpm --filter admin dev

# Terminal 4: Celery Worker (for async tasks)
source venv/bin/activate
celery -A app.tasks.celery_app worker --loglevel=info

# Terminal 5: Celery Beat (for scheduled tasks)
celery -A app.tasks.celery_app beat --loglevel=info
```

### Hot Reload

- Backend: Automatic with `--reload` flag
- Frontend: Built-in Next.js fast refresh
- Packages: Run `pnpm --filter @giga-pdf/ui build` after changes

> **Detailed workflow:** See [Development Guide](docs/guides/DEVELOPMENT.md)

---

## Deployment

### Ploi (SSH + Deploy)

```bash
# Login (first time)
ploi login

# SSH into the server (read-only unless you explicitly confirm changes)
ploi ssh ploi@giga-pdf.com

# Deploy the latest code (adjust app name and server if needed)
ploi deploy gigapdf production

# Run migrations on the server
ploi run gigapdf production "cd /home/ploi/gigapdf && alembic upgrade head"
```

### Docker (Recommended)

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Manual Deployment

```bash
# Build frontend
pnpm build

# Start with PM2
pm2 start ecosystem.config.js
```

### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}

server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> **Complete deployment instructions:** See [Deployment Guide](docs/guides/DEPLOYMENT.md)

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `pytest && pnpm test`
5. Submit a pull request

### Code Style

- Python: Black + Ruff + MyPy
- TypeScript: ESLint + Prettier
- Commits: Conventional Commits

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Support

- **Issues:** [GitHub Issues](https://github.com/your-org/gigapdf/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-org/gigapdf/discussions)
- **Documentation:** [docs.gigapdf.com](https://docs.gigapdf.com)

---

<p align="center">
  Made with ❤️ by the GigaPDF Team
</p>
