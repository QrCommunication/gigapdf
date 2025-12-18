# Architecture Overview / Vue d'ensemble de l'architecture

Technical documentation of GigaPDF's system architecture.

Documentation technique de l'architecture système de GigaPDF.

---

## Table of Contents / Table des matières

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Backend Architecture](#backend-architecture)
4. [Frontend Architecture](#frontend-architecture)
5. [Database Schema](#database-schema)
6. [Authentication Flow](#authentication-flow)
7. [Real-time Collaboration](#real-time-collaboration)
8. [File Storage](#file-storage)
9. [Background Jobs](#background-jobs)
10. [Billing System](#billing-system)
11. [Security Architecture](#security-architecture)

---

## System Overview

### High-Level Architecture / Architecture de haut niveau

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                     │
├─────────────────────────────────────────────────────────────────────────┤
│   Web Browser    │    Mobile App    │    API Client    │    Admin       │
└────────┬─────────┴────────┬─────────┴────────┬─────────┴────────┬───────┘
         │                  │                  │                  │
         ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           LOAD BALANCER                                  │
│                         (Nginx / Traefik)                               │
└────────┬─────────────────────────┬──────────────────────────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────┐      ┌─────────────────────────────────────────────────┐
│   WEB FRONTEND  │      │               BACKEND API                       │
│   (Next.js 15)  │      │              (FastAPI)                          │
│                 │      │                                                 │
│ • App Router    │      │ ┌───────────────┐  ┌───────────────┐           │
│ • React 19      │◄────►│ │   REST API    │  │  WebSocket    │           │
│ • Tailwind CSS  │      │ │   /api/v1/*   │  │  /ws/*        │           │
│ • BetterAuth    │      │ └───────────────┘  └───────────────┘           │
└─────────────────┘      └────────┬─────────────────────┬─────────────────┘
                                  │                     │
         ┌────────────────────────┼─────────────────────┤
         ▼                        ▼                     ▼
┌─────────────────┐     ┌─────────────────┐    ┌───────────────────────────┐
│   PostgreSQL    │     │     Redis       │    │    Object Storage (S3)    │
│                 │     │                 │    │                           │
│ • Documents     │     │ • Sessions      │    │ • PDF Files               │
│ • Users         │     │ • Cache         │    │ • Exports                 │
│ • Plans         │     │ • Pub/Sub       │    │ • Previews                │
│ • Subscriptions │     │ • Job Queue     │    │                           │
└─────────────────┘     └────────┬────────┘    └───────────────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Celery Worker  │
                        │                 │
                        │ • PDF Processing│
                        │ • OCR           │
                        │ • Export        │
                        │ • Billing Sync  │
                        └─────────────────┘
```

### Component Communication / Communication entre composants

| Source | Destination | Protocol | Purpose |
|--------|-------------|----------|---------|
| Browser | Web Frontend | HTTPS | User interface |
| Browser | Backend API | HTTPS | REST API calls |
| Browser | Backend API | WSS | Real-time collaboration |
| Web Frontend | Backend API | HTTPS | Server-side API calls |
| Backend API | PostgreSQL | TCP | Data persistence |
| Backend API | Redis | TCP | Caching & pub/sub |
| Backend API | S3 | HTTPS | File storage |
| Celery | Redis | TCP | Job queue |
| Celery | PostgreSQL | TCP | Job results |

---

## Technology Stack

### Backend / Backend

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| **Framework** | FastAPI | 0.109+ | REST API & WebSocket |
| **ORM** | SQLAlchemy | 2.x | Database access |
| **Migrations** | Alembic | 1.13+ | Schema migrations |
| **Task Queue** | Celery | 5.3+ | Background jobs |
| **WebSocket** | Socket.IO | 5.x | Real-time features |
| **PDF Engine** | PyMuPDF | 1.23+ | PDF manipulation |
| **OCR** | Tesseract | 5.x | Text extraction |
| **Validation** | Pydantic | 2.x | Data validation |

### Frontend / Frontend

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| **Framework** | Next.js | 15.x | React framework |
| **UI Library** | React | 19.x | Components |
| **Styling** | Tailwind CSS | 3.4+ | Utility CSS |
| **Components** | Radix UI | Latest | Accessible primitives |
| **Auth** | BetterAuth | 1.x | Authentication |
| **State** | SWR | 2.x | Data fetching |
| **i18n** | next-intl | 4.x | Internationalization |

### Infrastructure / Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Database** | PostgreSQL 16 | Primary data store |
| **Cache** | Redis 7 | Sessions, cache, pub/sub |
| **Storage** | S3-compatible | File storage |
| **Process Manager** | PM2 | Production process management |
| **Reverse Proxy** | Nginx | Load balancing, SSL |
| **Containers** | Docker | Deployment |

---

## Backend Architecture

### Directory Structure / Structure des répertoires

```
app/
├── api/
│   ├── v1/                    # API version 1
│   │   ├── documents.py       # Document CRUD operations
│   │   ├── pages.py           # Page manipulation
│   │   ├── elements.py        # Element editing
│   │   ├── annotations.py     # PDF annotations
│   │   ├── forms.py           # Form handling
│   │   ├── merge_split.py     # Document merging/splitting
│   │   ├── export.py          # Format conversion
│   │   ├── storage.py         # File management
│   │   ├── billing.py         # Subscription management
│   │   ├── webhooks.py        # Webhook configuration
│   │   └── admin/             # Admin endpoints
│   └── websocket.py           # Real-time collaboration
│
├── core/
│   ├── database.py            # Database connection & session
│   └── security.py            # JWT validation & auth
│
├── models/
│   ├── document.py            # Document model
│   ├── user.py                # User model (external auth)
│   ├── plan.py                # Subscription plans
│   ├── subscription.py        # User subscriptions
│   └── collaboration.py       # Collaboration sessions
│
├── schemas/
│   ├── document.py            # Request/Response schemas
│   ├── page.py
│   ├── element.py
│   └── billing.py
│
├── services/
│   ├── document_service.py    # Business logic
│   ├── pdf_service.py         # PDF operations
│   ├── storage_service.py     # S3 operations
│   ├── collaboration_service.py # Real-time sessions
│   └── billing_service.py     # Stripe integration
│
├── repositories/
│   ├── document_repository.py # Data access layer
│   └── user_repository.py
│
├── tasks/
│   ├── celery_app.py          # Celery configuration
│   ├── pdf_tasks.py           # PDF processing tasks
│   ├── export_tasks.py        # Export tasks
│   └── billing_tasks.py       # Billing sync tasks
│
├── middleware/
│   ├── cors.py                # CORS handling
│   └── rate_limit.py          # Rate limiting
│
├── utils/
│   ├── pdf.py                 # PDF utilities
│   └── s3.py                  # S3 utilities
│
├── config.py                  # Configuration
├── dependencies.py            # FastAPI dependencies
└── main.py                    # Application entry point
```

### Request Flow / Flux de requête

```
Request → Nginx → FastAPI
                    │
                    ▼
              Middleware
              (CORS, Auth)
                    │
                    ▼
               Dependency
              Injection
            (DB, User, etc.)
                    │
                    ▼
                 Router
               (Endpoint)
                    │
                    ▼
                Service
            (Business Logic)
                    │
                    ▼
              Repository
             (Data Access)
                    │
                    ▼
               Database
```

### Layer Responsibilities / Responsabilités des couches

| Layer | Responsibility |
|-------|----------------|
| **Router** | HTTP handling, validation, serialization |
| **Service** | Business logic, orchestration |
| **Repository** | Database operations, queries |
| **Model** | Data structure, relationships |
| **Schema** | Request/response validation |

---

## Frontend Architecture

### Directory Structure / Structure des répertoires

```
apps/web/
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── (auth)/               # Authentication routes
│   │   │   ├── login/            # Login page
│   │   │   ├── register/         # Registration page
│   │   │   └── forgot-password/  # Password reset
│   │   │
│   │   ├── (dashboard)/          # Protected routes
│   │   │   ├── documents/        # Document list
│   │   │   ├── settings/         # User settings
│   │   │   └── billing/          # Subscription management
│   │   │
│   │   ├── editor/               # PDF Editor
│   │   │   └── [documentId]/     # Dynamic editor route
│   │   │
│   │   ├── api/                  # API routes
│   │   │   └── auth/             # BetterAuth handlers
│   │   │
│   │   ├── layout.tsx            # Root layout
│   │   └── page.tsx              # Landing page
│   │
│   ├── components/
│   │   ├── auth/                 # Auth components
│   │   ├── dashboard/            # Dashboard components
│   │   ├── editor/               # Editor components
│   │   └── ui/                   # UI primitives (local)
│   │
│   ├── hooks/                    # Custom React hooks
│   │   ├── use-auth.ts           # Authentication hook
│   │   ├── use-documents.ts      # Document fetching
│   │   └── use-editor.ts         # Editor state
│   │
│   ├── lib/
│   │   ├── auth.ts               # BetterAuth server config
│   │   ├── auth-client.ts        # BetterAuth client
│   │   ├── api.ts                # API client
│   │   └── utils.ts              # Utility functions
│   │
│   └── middleware.ts             # Route protection
│
├── messages/                     # i18n translations
│   ├── en.json
│   └── fr.json
│
└── prisma/
    └── schema.prisma             # Auth database schema
```

### Component Hierarchy / Hiérarchie des composants

```
App
├── RootLayout
│   ├── ThemeProvider
│   ├── AuthProvider
│   └── Toaster
│
├── (Auth) Layout
│   ├── LoginPage
│   └── RegisterPage
│
├── (Dashboard) Layout
│   ├── Sidebar
│   ├── Header
│   └── Main Content
│       ├── DocumentsPage
│       │   ├── DocumentGrid
│       │   └── DocumentCard
│       └── SettingsPage
│
└── Editor Layout
    ├── EditorToolbar
    ├── EditorCanvas
    │   ├── PageRenderer
    │   └── ElementOverlay
    ├── PageNavigator
    └── PropertiesPanel
```

---

## Database Schema

### Core Tables / Tables principales

```sql
-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    tenant_id UUID,
    name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Pages table
CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id),
    page_number INTEGER NOT NULL,
    width FLOAT NOT NULL,
    height FLOAT NOT NULL,
    rotation INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Elements table
CREATE TABLE elements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES pages(id),
    type VARCHAR(50) NOT NULL,
    x FLOAT NOT NULL,
    y FLOAT NOT NULL,
    width FLOAT NOT NULL,
    height FLOAT NOT NULL,
    content TEXT,
    style JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Collaboration sessions
CREATE TABLE collaboration_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id),
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    user_color VARCHAR(7) NOT NULL,
    cursor_x FLOAT,
    cursor_y FLOAT,
    cursor_page INTEGER,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Element locks
CREATE TABLE element_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    element_id UUID NOT NULL REFERENCES elements(id),
    user_id VARCHAR(255) NOT NULL,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Plans (subscription tiers)
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_monthly INTEGER NOT NULL,
    price_yearly INTEGER NOT NULL,
    stripe_price_id_monthly VARCHAR(255),
    stripe_price_id_yearly VARCHAR(255),
    features JSONB NOT NULL,
    limits JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    tenant_id UUID,
    plan_id UUID NOT NULL REFERENCES plans(id),
    stripe_subscription_id VARCHAR(255),
    stripe_customer_id VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    billing_cycle VARCHAR(20) NOT NULL,
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    trial_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Entity Relationships / Relations entre entités

```
┌──────────────────┐
│      Users       │
│   (BetterAuth)   │
└────────┬─────────┘
         │
         │ 1:N
         ▼
┌──────────────────┐       ┌──────────────────┐
│    Documents     │──────►│   Subscriptions  │
└────────┬─────────┘  N:1  └────────┬─────────┘
         │                          │
         │ 1:N                      │ N:1
         ▼                          ▼
┌──────────────────┐       ┌──────────────────┐
│      Pages       │       │      Plans       │
└────────┬─────────┘       └──────────────────┘
         │
         │ 1:N
         ▼
┌──────────────────┐
│     Elements     │
└──────────────────┘
```

---

## Authentication Flow

### JWT Authentication / Authentification JWT

```
┌─────────────────────────────────────────────────────────────┐
│                      AUTHENTICATION FLOW                     │
└─────────────────────────────────────────────────────────────┘

1. User Login
   ┌────────┐    POST /auth/login     ┌──────────────┐
   │ Client ├────────────────────────►│  BetterAuth  │
   └────────┘                         │   (Next.js)  │
                                      └──────┬───────┘
                                             │
                                      Creates session
                                      & JWT token
                                             │
                                      ┌──────▼───────┐
                                      │  PostgreSQL  │
                                      │  (sessions)  │
                                      └──────────────┘

2. API Request with Token
   ┌────────┐    Authorization: Bearer <token>    ┌──────────┐
   │ Client ├────────────────────────────────────►│ FastAPI  │
   └────────┘                                     └────┬─────┘
                                                       │
                                                Validate JWT
                                                (RS256 signature)
                                                       │
                                                       ▼
                                                Extract user_id
                                                from claims
```

### Token Structure / Structure du token

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "user_123abc",
    "name": "John Doe",
    "email": "john@example.com",
    "iat": 1705312200,
    "exp": 1705398600,
    "iss": "https://your-domain.com",
    "aud": "giga-pdf"
  }
}
```

---

## Real-time Collaboration

### WebSocket Architecture / Architecture WebSocket

```
┌─────────────────────────────────────────────────────────────┐
│                   COLLABORATION SYSTEM                       │
└─────────────────────────────────────────────────────────────┘

┌──────────┐      ┌──────────┐      ┌──────────┐
│ Client A │      │ Client B │      │ Client C │
└────┬─────┘      └────┬─────┘      └────┬─────┘
     │                 │                 │
     └────────────┬────┴────────────────┘
                  │
                  ▼
          ┌──────────────┐
          │  Socket.IO   │
          │   Server     │
          └──────┬───────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────┐  ┌──────────────┐
│    Redis     │  │  PostgreSQL  │
│  (pub/sub)   │  │  (sessions)  │
└──────────────┘  └──────────────┘
```

### Event Types / Types d'événements

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_document` | Client → Server | Join editing session |
| `leave_document` | Client → Server | Leave editing session |
| `cursor:move` | Client → Server | Update cursor position |
| `element:lock` | Client → Server | Lock element for editing |
| `element:unlock` | Client → Server | Release element lock |
| `document:update` | Client → Server | Broadcast document change |
| `user:joined` | Server → Client | User joined notification |
| `user:left` | Server → Client | User left notification |
| `cursor:moved` | Server → Client | Other user's cursor moved |
| `element:locked` | Server → Client | Element locked by other user |
| `document:updated` | Server → Client | Document changed by other user |

---

## File Storage

### Storage Architecture / Architecture de stockage

```
S3 Bucket Structure
├── documents/
│   └── {user_id}/
│       └── {document_id}/
│           ├── v1.pdf           # Original version
│           ├── v2.pdf           # Modified version
│           └── previews/
│               ├── page_1.png   # Page previews
│               ├── page_2.png
│               └── ...
│
├── exports/
│   └── {user_id}/
│       └── {export_id}/
│           └── output.docx
│
└── temp/
    └── {job_id}/
        └── processing.pdf
```

### Storage Operations / Opérations de stockage

| Operation | Method | Path |
|-----------|--------|------|
| Upload document | PUT | `documents/{user_id}/{doc_id}/v{n}.pdf` |
| Download document | GET | `documents/{user_id}/{doc_id}/v{n}.pdf` |
| Get preview | GET | `documents/{user_id}/{doc_id}/previews/page_{n}.png` |
| Delete document | DELETE | `documents/{user_id}/{doc_id}/*` |

---

## Background Jobs

### Celery Architecture / Architecture Celery

```
┌─────────────────────────────────────────────────────────────┐
│                      CELERY WORKFLOW                         │
└─────────────────────────────────────────────────────────────┘

┌────────────┐    Submit task    ┌────────────┐
│  FastAPI   ├──────────────────►│   Redis    │
│    API     │                   │  (Broker)  │
└────────────┘                   └─────┬──────┘
                                       │
                               Pull tasks
                                       │
                                 ┌─────▼──────┐
                                 │   Celery   │
                                 │   Worker   │
                                 └─────┬──────┘
                                       │
                         ┌─────────────┼─────────────┐
                         │             │             │
                         ▼             ▼             ▼
                    PDF Tasks    Export Tasks   Billing Tasks
                         │             │             │
                         └─────────────┼─────────────┘
                                       │
                                       ▼
                                 ┌────────────┐
                                 │ PostgreSQL │
                                 │  (Results) │
                                 └────────────┘
```

### Task Types / Types de tâches

| Queue | Tasks | Priority |
|-------|-------|----------|
| `default` | Document processing, previews | Normal |
| `export` | PDF to DOCX/HTML conversion | Normal |
| `ocr` | Text extraction from images | Low |
| `billing` | Stripe synchronization | High |

---

## Billing System

### Stripe Integration / Intégration Stripe

```
┌─────────────────────────────────────────────────────────────┐
│                     BILLING FLOW                             │
└─────────────────────────────────────────────────────────────┘

1. Subscription Creation
   ┌────────┐                    ┌──────────┐
   │ Client ├───────────────────►│ FastAPI  │
   └────────┘ POST /billing/     └────┬─────┘
              subscribe                │
                                       │ Create checkout
                                       ▼
                               ┌──────────────┐
                               │    Stripe    │
                               │  Checkout    │
                               └──────┬───────┘
                                      │
                                      │ Redirect
                                      ▼
                               Payment Flow
                                      │
                                      │ Webhook
                                      ▼
                               ┌──────────────┐
                               │   FastAPI    │
                               │  /webhooks   │
                               └──────┬───────┘
                                      │
                                      │ Update
                                      ▼
                               ┌──────────────┐
                               │  PostgreSQL  │
                               │(subscription)│
                               └──────────────┘
```

### Webhook Events / Événements Webhook

| Stripe Event | Action |
|--------------|--------|
| `checkout.session.completed` | Create subscription |
| `customer.subscription.updated` | Update plan/status |
| `customer.subscription.deleted` | Cancel subscription |
| `invoice.paid` | Record payment |
| `invoice.payment_failed` | Handle failure |

---

## Security Architecture

### Security Layers / Couches de sécurité

```
┌─────────────────────────────────────────────────────────────┐
│                     SECURITY LAYERS                          │
└─────────────────────────────────────────────────────────────┘

1. Network Layer
   ├── Firewall (UFW)
   ├── SSL/TLS (Let's Encrypt)
   └── Rate Limiting (Nginx)

2. Application Layer
   ├── JWT Authentication
   ├── CORS Policy
   ├── Input Validation (Pydantic)
   └── SQL Injection Prevention (SQLAlchemy)

3. Data Layer
   ├── Encrypted connections (TLS)
   ├── Password hashing (bcrypt)
   └── Sensitive data encryption

4. Storage Layer
   ├── S3 bucket policies
   ├── Signed URLs (time-limited)
   └── User-scoped access
```

### Authorization Model / Modèle d'autorisation

| Resource | Owner | Tenant Admin | Tenant Member |
|----------|-------|--------------|---------------|
| Own documents | Full | Full | Full |
| Tenant documents | - | Full | Read/Write |
| Other documents | - | - | - |
| Billing | - | Full | - |
| User management | - | Full | - |

---

## Performance Considerations

### Caching Strategy / Stratégie de cache

| Data | TTL | Storage |
|------|-----|---------|
| Page previews | 24h | S3 + CDN |
| User sessions | 7d | Redis |
| API responses | 5min | Redis |
| Document metadata | 1h | Redis |

### Database Indexes / Index de base de données

```sql
-- Frequently queried
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX idx_pages_document_id ON pages(document_id);
CREATE INDEX idx_elements_page_id ON elements(page_id);

-- Full-text search
CREATE INDEX idx_documents_name_gin ON documents USING gin(name gin_trgm_ops);
```

---

## Monitoring & Observability

### Metrics / Métriques

| Metric | Source | Purpose |
|--------|--------|---------|
| Request latency | FastAPI middleware | Performance |
| Error rate | Application logs | Reliability |
| Active connections | Socket.IO | Capacity |
| Queue depth | Celery | Processing load |
| Storage usage | S3 metrics | Resource planning |

### Logging / Journalisation

```python
# Log levels
DEBUG   # Development only
INFO    # Normal operations
WARNING # Potential issues
ERROR   # Failures requiring attention
```

---

## Next Steps / Prochaines étapes

- **[API Reference](api/README.md)** - Detailed API documentation
- **[Development Guide](guides/DEVELOPMENT.md)** - Contributing guidelines
- **[Deployment Guide](guides/DEPLOYMENT.md)** - Production setup
- **[WebSocket Guide](WEBSOCKET_COLLABORATION.md)** - Real-time features
