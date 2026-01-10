# GigaPDF Architecture

## Overview

GigaPDF is a multi-tenant PDF editing platform with a stateless API layer,
S3-compatible storage, and real-time collaboration. The system separates
interactive editing (documents/elements) from persistent storage (stored
documents/versions).

## High-Level Diagram

```
+------------+      +--------------+      +---------------+
| Web / Admin|----->| FastAPI API  |----->| PostgreSQL     |
| Mobile App |      | (REST + WS)  |      | (data + auth)  |
+------------+      +------+-------+      +---------------+
                          |
                          +---------> Redis (cache, queues)
                          |
                          +---------> S3 (document versions)
```

## Core Components

### Backend (FastAPI)
- REST API: Document CRUD, export, OCR, storage, billing.
- WebSocket: Real-time collaboration, cursors, element locks.
- Services: Encapsulated business logic (storage, billing, collaboration).
- Celery: Async jobs (exports, OCR, batch operations).

### Frontend (Next.js)
- Web App: Main editor UI and user dashboard.
- Admin App: Tenant and user administration.
- Mobile App: Expo-based client for viewing and simple workflows.

### Storage
- PostgreSQL: Core data, users, tenants, permissions, metadata.
- Redis: Cache, rate limits, async job queues.
- S3-Compatible: Immutable versions of edited PDFs.

## Data Model (Summary)

- documents: Session documents and element state during editing.
- stored_documents: Persistent saved documents in S3.
- document_versions: Version history with storage keys.
- tenants/users: Multi-tenant ownership and quotas.

## Save Flow

1. User edits a document (elements stored in the DB).
2. On save, the API renders/exports and stores a version in S3.
3. Metadata is updated in PostgreSQL, version history is recorded.

## Collaboration Flow

1. Clients join a document room via WebSocket.
2. Cursor and element updates are broadcast to peers.
3. Element locks prevent conflicting edits.

## Key Directories

- app/: FastAPI backend, services, models, tasks.
- apps/web: Next.js editor UI.
- apps/admin: Admin dashboard.
- apps/mobile: Expo mobile app.
- packages/: Shared UI and editor packages.
- database/: SQL bootstrap migrations and setup scripts.
- migrations/: Alembic migrations.

## External Dependencies

- PostgreSQL: Primary database.
- Redis: Cache, queue, rate limiting.
- S3: Long-term document storage.
- Tesseract: OCR (optional but recommended).

## Environments

- Local: uvicorn + pnpm dev + local PostgreSQL/Redis.
- Prod: Containerized or Ploi-based deployment.
