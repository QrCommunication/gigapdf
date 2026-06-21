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
- REST API: Document CRUD, export, storage, search, billing.
- WebSocket: Real-time collaboration, cursors, element locks.
- Services: Encapsulated business logic (storage, billing, collaboration,
  semantic search embeddings).
- Celery: Async jobs (preview proxying, embeddings, batch operations).

### PDF engine (gigapdf-lib, Rust → WebAssembly)
- All PDF processing runs through the in-house `@qrcommunication/gigapdf-lib`
  (read/write/edit, redaction, AcroForm, annotations, OCR, HTML/CSS→PDF via a
  native JS interpreter, Office↔PDF conversion, rasterisation, crypto/signatures,
  image codecs). No third-party PDF binary (Tesseract, poppler, LibreOffice,
  Ghostscript, Chromium/Playwright, mupdf, pdf-lib) is required.
- The WASM module ships with the frontend; OCR, rendering and conversion run
  client-side. The backend proxies preview rendering and persists results.

### Frontend (Next.js)
- Web App: Main editor UI and user dashboard.
- Admin App: Tenant and user administration.
- Mobile App: Expo-based client for viewing and simple workflows.

### Editor rendering model (direct text editing)
- The edited page is rasterised by the engine **without its text**
  (`renderPageNoText`): the background keeps all non-text content
  (vector art, gradients/shadings, images, annotations) pixel-perfect.
- The real text is drawn on top as **live, editable text** in its embedded
  font and true colour — there is no flattened text image and no colour mask,
  so editing works directly over any background (gradients included).
- Embedded fonts are served to the browser with a synthesised, valid `cmap`
  and all required tables, so the original glyphs render 1:1 even when the
  embedded subset's character map is missing or corrupt.
- Single-page and continuous (Word-like) views share the same `EditorCanvas`
  component, so editing behaves identically. In the continuous view the focused
  page is a full editor; other pages are fast, read-only page bitmaps.

### Editor element editing & layers
- Every element parsed from the PDF — text, **images and vector shapes** — is
  addressable by a single **unified engine index**. Move/resize/delete are
  applied **in place** (`transformElement`/`removeElement`) — lossless, no image
  re-compression or shape re-draw. Geometry/rotation changes that can't be
  expressed as a pure affine fall back to redact + re-add.
- **Vector restyle** (fill/stroke/width/dash **and opacity**) is baked in place
  via `setPathStyle`; image/element opacity via `setElementOpacity` (both use a
  page `/ExtGState`). Shapes are excluded from the background raster
  (`renderPageExcluding`) and drawn as **live, visible Fabric overlays**, so
  restyling is WYSIWYG with no stale preview (same model as text).
- **Stacking order** is baked natively via `reorderElement` (op-range splice that
  re-emits the element's effective graphics state, so appearance is preserved).
- **Layers** are an editor-side construct (not PDF OCGs): create/rename/reorder,
  assign elements, lock/hide a whole layer (cascades to member elements). Layers
  + element→layer membership are persisted per stored document via
  `GET/PUT /api/v1/storage/documents/{id}/layers` (opaque JSONB), keyed by the
  element's deterministic id so they survive a reload.

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

- PostgreSQL 17 (+ pgvector): Primary database and semantic search index.
- Redis: Cache, queue, rate limiting.
- S3: Long-term document storage.
- fastembed: Local, offline multilingual embeddings (no external API).

No third-party PDF/OCR binary (Tesseract, poppler, LibreOffice, Ghostscript,
Chromium/Playwright, fontforge) is required — all PDF processing is handled by
the in-house gigapdf-lib (Rust → WASM).

## Environments

- Local: uvicorn + pnpm dev + local PostgreSQL/Redis.
- Prod: Containerized or Ploi-based deployment.
