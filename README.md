# GigaPDF - Open Source WYSIWYG PDF Editor

An open-source PDF editing platform with a visual canvas editor, REST API, and real-time collaboration features.

## Features

- **Visual PDF Editor**: WYSIWYG canvas-based editor for intuitive PDF editing
- **Document Management**: Upload, parse, download, and manage PDF documents
- **Page Operations**: Add, remove, reorder, rotate, and resize pages
- **Element Editing**: Manipulate text, images, shapes, and annotations
- **Form Handling**: Fill, create, and flatten PDF forms
- **OCR Integration**: Extract text from scanned documents using Tesseract
- **Real-time Collaboration**: Multi-user editing via WebSocket
- **Export Options**: Convert PDFs to various formats (PNG, JPEG, DOCX, etc.)
- **Security**: Encrypt/decrypt PDFs, manage permissions

## Architecture

```
gigapdf/
├── app/                    # FastAPI Backend (Python)
├── apps/
│   ├── web/               # Next.js Frontend (React)
│   └── admin/             # Admin Dashboard (Next.js)
├── packages/
│   ├── ui/                # Shared UI Components
│   ├── api/               # API Client
│   ├── types/             # TypeScript Types
│   └── billing/           # Stripe Integration
├── migrations/            # Alembic Database Migrations
└── docs/                  # Documentation
```

## Requirements

### Backend
- Python 3.12+
- PostgreSQL 16+
- Redis 7+
- Tesseract OCR 5.x (optional, for OCR features)

### Frontend
- Node.js 20+
- pnpm 9+

---

## Development Setup

### 1. System Dependencies

#### Ubuntu/Debian
```bash
# Update package list
sudo apt update

# Install Python 3.12
sudo apt install python3.12 python3.12-venv python3.12-dev

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Install Redis
sudo apt install redis-server

# Install Tesseract OCR (optional)
sudo apt install tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng

# Install system libraries for PDF processing
sudo apt install libmupdf-dev mupdf-tools poppler-utils

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm
```

#### macOS
```bash
# Using Homebrew
brew install python@3.12 postgresql@16 redis tesseract poppler node@20
npm install -g pnpm
```

### 2. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/your-org/gigapdf.git
cd gigapdf

# Create Python virtual environment
python3.12 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt  # For development

# Install Node.js dependencies
pnpm install
```

### 3. Database Setup

```bash
# Create PostgreSQL databases
sudo -u postgres psql << 'EOF'
CREATE USER gigapdf WITH PASSWORD 'your-password';
CREATE DATABASE gigapdf OWNER gigapdf;
CREATE DATABASE gigapdf_celery OWNER gigapdf;
\q
EOF
```

### 4. Environment Configuration

Create environment files:

#### Backend (.env)
```bash
cp .env.example .env
```

Edit `.env`:
```bash
# Application
APP_ENV=development
APP_SECRET_KEY=your-secret-key-minimum-32-characters-long-here
DEBUG=true

# Database
DATABASE_URL=postgresql://gigapdf:your-password@localhost:5432/gigapdf

# Redis
REDIS_URL=redis://localhost:6379/0

# S3/Object Storage (Scaleway or AWS)
S3_ENDPOINT_URL=https://s3.fr-par.scw.cloud
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=gigapdf-documents
S3_REGION=fr-par

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

#### Frontend (apps/web/.env)
```bash
# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

# BetterAuth Configuration
BETTER_AUTH_SECRET=your-long-random-secret-key-for-auth
BETTER_AUTH_URL=http://localhost:3000

# Database (PostgreSQL)
DATABASE_URL=postgresql://gigapdf:your-password@localhost:5432/gigapdf
```

#### Admin (apps/admin/.env)
```bash
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

### 5. Run Migrations

```bash
# Activate virtual environment
source venv/bin/activate

# Run Alembic migrations for backend tables
alembic upgrade head

# Generate Prisma client and sync auth tables
cd apps/web
npx prisma db push
npx prisma generate
cd ../..
```

### 6. Build UI Package

```bash
# Build the shared UI component library
pnpm --filter @giga-pdf/ui build
```

### 7. Start Development Servers

Open 3 terminal windows:

**Terminal 1 - Backend API:**
```bash
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Web Frontend:**
```bash
pnpm --filter web dev
# Available at http://localhost:3000
```

**Terminal 3 - Admin Panel:**
```bash
pnpm --filter admin dev
# Available at http://localhost:3001
```

**Terminal 4 - Celery Worker (for async tasks):**
```bash
source venv/bin/activate
celery -A app.tasks.celery_app worker --loglevel=info
```

---

## Production Deployment

### Environment Variables for Production

#### Backend (.env)
```bash
APP_ENV=production
APP_SECRET_KEY=generate-a-long-random-key-using-openssl-rand-hex-32
DEBUG=false

DATABASE_URL=postgresql://user:password@your-db-host:5432/gigapdf
REDIS_URL=redis://your-redis-host:6379/0

# S3/Object Storage
S3_ENDPOINT_URL=https://s3.your-region.scw.cloud
S3_ACCESS_KEY_ID=your-production-access-key
S3_SECRET_ACCESS_KEY=your-production-secret-key
S3_BUCKET_NAME=gigapdf-production
S3_REGION=your-region

# CORS - Set to your production domains
CORS_ALLOWED_ORIGINS=https://your-domain.com,https://admin.your-domain.com

# JWT Auth
AUTH_JWT_PUBLIC_KEY=your-production-jwt-public-key
AUTH_JWT_ALGORITHM=RS256
AUTH_JWT_ISSUER=https://your-domain.com
```

#### Frontend Production (apps/web/.env.production)
```bash
NEXT_PUBLIC_APP_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_WS_URL=wss://api.your-domain.com

BETTER_AUTH_SECRET=your-production-auth-secret-very-long-and-secure
BETTER_AUTH_URL=https://your-domain.com

DATABASE_URL=postgresql://user:password@your-db-host:5432/gigapdf

# Stripe (for billing)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxx
STRIPE_SECRET_KEY=sk_live_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx
```

### Docker Deployment

```dockerfile
# Use docker-compose.yml for full stack deployment
docker-compose -f docker-compose.prod.yml up -d
```

### Building for Production

```bash
# Build all packages
pnpm build

# Build specific apps
pnpm --filter web build
pnpm --filter admin build
```

### Running with PM2

```bash
# Backend
pm2 start "uvicorn app.main:app --host 0.0.0.0 --port 8000" --name gigapdf-api

# Web Frontend
cd apps/web
pm2 start npm --name gigapdf-web -- start

# Admin
cd apps/admin
pm2 start npm --name gigapdf-admin -- start

# Celery Worker
pm2 start "celery -A app.tasks.celery_app worker --loglevel=info" --name gigapdf-worker
```

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/gigapdf
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Web Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Backend API
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

---

## API Documentation

Once the server is running, access the interactive API documentation:

- **Swagger UI**: http://localhost:8000/api/docs
- **ReDoc**: http://localhost:8000/api/redoc
- **OpenAPI JSON**: http://localhost:8000/api/v1/openapi.json

## API Endpoints Overview

### Documents
- `POST /api/v1/documents/upload` - Upload PDF
- `GET /api/v1/documents/{id}` - Get document structure
- `GET /api/v1/documents/{id}/download` - Download PDF
- `DELETE /api/v1/documents/{id}` - Delete document

### Pages
- `GET /api/v1/documents/{id}/pages/{num}` - Get page
- `GET /api/v1/documents/{id}/pages/{num}/preview` - Get page preview
- `POST /api/v1/documents/{id}/pages` - Add page
- `DELETE /api/v1/documents/{id}/pages/{num}` - Delete page
- `PUT /api/v1/documents/{id}/pages/reorder` - Reorder pages
- `PUT /api/v1/documents/{id}/pages/{num}/rotate` - Rotate page

### Elements
- `GET /api/v1/documents/{id}/pages/{num}/elements` - List elements
- `POST /api/v1/documents/{id}/pages/{num}/elements` - Create element
- `PATCH /api/v1/documents/{id}/elements/{eid}` - Update element
- `DELETE /api/v1/documents/{id}/elements/{eid}` - Delete element

### Plans (Admin)
- `GET /api/v1/plans` - List all plans
- `GET /api/v1/plans/{id}` - Get plan by ID or slug
- `POST /api/v1/plans` - Create plan
- `PATCH /api/v1/plans/{id}` - Update plan
- `DELETE /api/v1/plans/{id}` - Delete plan

---

## Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific tests
pytest tests/unit/
pytest tests/integration/
```

## Code Quality

```bash
# Format code
black app tests

# Lint code
ruff check app tests

# Type checking
mypy app
```

---

---

## Deployment Checklist (Production Server)

### Required Environment Variables for S3 Storage (Scaleway)

```bash
# S3 Storage Configuration (REQUIRED for document persistence)
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_BUCKET_NAME=your-bucket-name
S3_REGION=fr-par
S3_ACCESS_KEY_ID=your-scaleway-access-key
S3_SECRET_ACCESS_KEY=your-scaleway-secret-key
```

### Backend Dependencies Update

After pulling latest changes, run:
```bash
source .venv/bin/activate
pip install -r requirements.txt  # Includes boto3 for S3
```

### CORS Configuration

The backend automatically allows these origins in development mode:
- http://localhost:3000 (web)
- http://localhost:3001 (admin)
- http://localhost:3002, 3003 (alternative ports)

For production, set the `CORS_ALLOWED_ORIGINS` environment variable:
```bash
CORS_ALLOWED_ORIGINS=https://your-domain.com,https://admin.your-domain.com
```

### Authentication Flow

1. Frontend uses `better-auth` for session management
2. Backend accepts JWT tokens via `Authorization: Bearer <token>` header
3. In development mode, user ID is accepted as token for testing

### Document Storage Architecture

Documents are stored in Scaleway S3 with the following key structure:
```
documents/{user_id}/{document_id}/v{version}.pdf
```

Example: `documents/user123/doc456/v1.pdf`

### Recent Changes Summary

1. **S3 Storage Integration**: Documents are now persisted to Scaleway S3 instead of local disk
2. **CORS Fix**: Fixed credential-based CORS by using explicit origins instead of wildcard
3. **Auth Token Race Condition Fix**: Frontend now waits for auth token before making API calls
4. **Tenant Quota Sharing**: Users in tenants inherit the tenant's quota limits
5. **Async Database Access**: All endpoints use SQLAlchemy 2.x async patterns

### Quick Test Commands

```bash
# Test backend health
curl http://localhost:8000/health

# Test storage endpoint with auth
curl -H "Authorization: Bearer test-user-123" \
  http://localhost:8000/api/v1/storage/documents?page=1&per_page=12

# Test S3 connection (admin endpoint)
curl -H "Authorization: Bearer admin-token" \
  http://localhost:8000/api/v1/admin/settings/storage/test
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## Support

- **Issues**: https://github.com/your-org/gigapdf/issues
- **Documentation**: https://docs.gigapdf.com
