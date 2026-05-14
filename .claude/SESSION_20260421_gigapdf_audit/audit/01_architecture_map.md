# GigaPDF — Cartographie Architecture Exhaustive

**Session:** SESSION_20260421_gigapdf_audit
**Date:** 2026-04-21
**Source:** Wave -1 / Explore agent

## Vue d'Ensemble

| Aspect | Valeur |
|--------|--------|
| Type | Monorepo polyglotte (pnpm workspaces) |
| Package Manager | pnpm 10.28.0+ |
| Apps | 3 (web, admin, mobile) |
| Packages | 13 (editor, pdf-engine, canvas, api, embed, etc.) |
| Node version | >=20.0.0 |
| Python version | 3.12+ (FastAPI) |

## Stack par Domaine

| Domaine | Technologie | Version | Rôle | Fichier clé |
|---------|-------------|---------|------|------------|
| Frontend Web | Next.js 16 + React 19 | 19.2.3 | WYSIWYG PDF editor | `/apps/web/package.json` |
| State Management | Zustand | 5.0.10 | Editor state | `/packages/editor/src/stores/` |
| PDF Rendering | pdf.js | 4.10.38 | Client-side PDF parsing & preview | `/packages/canvas/` |
| PDF Manipulation | pdf-lib | 1.17.1 | Text/image/form insertion, merge/split, encrypt | `/packages/pdf-engine/src/render/` |
| Canvas/Drawing | Fabric.js | 7.1.0 | Editable canvas layer | `/packages/canvas/` |
| UI Components | shadcn/ui | - | Dashboard, dialogs, toolbars | `/apps/web/src/components/` |
| Styling | Tailwind CSS | 4.0.0 | Utility-first CSS | `/tailwind.config.ts` |
| Backend API | FastAPI | Latest | Python async API | `/app/main.py` |
| Database | PostgreSQL 16 | - | Documents, users, billing, history | `docker-compose.yml` |
| Cache/Queue | Redis 7 | - | Session cache, job queue | `docker-compose.yml` |
| Auth | better-auth | 1.4.13 | JWT + API key auth | `/apps/web/src/` |
| Build | Turbo + tsup | 2.7.4 | Monorepo orchestration | `/turbo.json` |

## PDF Editor Frontend

### Architecture & Components

**Entry Point:** `/apps/web/src/app/editor/[id]/page.tsx`

**State Management (Zustand):**
- `/packages/editor/src/stores/document-store.ts` — Pages, elements, metadata
- `/packages/editor/src/stores/canvas-store.ts` — Viewport zoom, pan
- `/packages/editor/src/stores/selection-store.ts` — Selected elements
- `/packages/editor/src/stores/ui-store.ts` — Panel visibility, modals
- `/packages/editor/src/stores/history-store.ts` — Undo/redo

**Key Components:**
- `/components/editor/editor-canvas.tsx` — PDF background + Fabric overlay
- `/components/editor/editor-toolbar.tsx` — Tool selection
- `/components/editor/content-edit-layer.tsx` — Fabric canvas for editing
- `/components/editor/properties-panel.tsx` — Inspector
- `/components/editor/layers-panel.tsx` — Z-order management
- `/components/editor/pages-sidebar.tsx` — Page thumbnails

### Rendering Flow

1. User navigates to `/editor/[id]`
2. Backend returns `{ pages, elements, metadata }`
3. pdf-engine parse avec pdfjs, génère thumbnails
4. EditorCanvas render current page sur canvas (pdfjs)
5. Fabric canvas overlays pour editability
6. User edits → Zustand stores updated
7. Sync middleware batch changes, envoie backend

### POLICES (état actuel - CRITIQUE)

**Implementation actuelle:**
- **LIMITÉ** aux StandardFonts de pdf-lib (Helvetica, Times-Roman, Courier)
- `/packages/pdf-engine/src/utils/font-map.ts` normalise font names
- `/packages/pdf-engine/src/render/text-renderer.ts` embed fonts via `pdf-lib.embedFont()`

**Status:** Aucun chargement dynamique. Fallback à Helvetica. Polices embarquées dans PDF sources IGNORÉES.

**→ Gap identifié pour Wave 2** : implémenter extraction des polices embarquées + FontFace API frontend.

## Backend API (FastAPI)

**Stack:** FastAPI (async) + Python 3.12 + PostgreSQL 16 + Redis 7

**Main Entry:** `/app/main.py` (lifespan, middleware stack: CORS/Auth/RateLimit/ErrorHandler, APIRouter v1, WebSocket Socket.io)

### Endpoints PDF

Location: `/app/api/v1/`

| Endpoint | Method | File | Purpose |
|----------|--------|------|---------|
| `/documents` | POST | `documents.py` | Create from PDF |
| `/documents/{id}` | GET/PUT/DELETE | `documents.py` | Manage document |
| `/elements` | POST/PUT/DELETE | `elements.py` | Text, images, shapes |
| `/pages/{id}` | PUT | `pages.py` | Page properties |
| `/merge-split/merge` | POST | `merge_split.py` | Merge PDFs |
| `/merge-split/split` | POST | `merge_split.py` | Split at pages |
| `/forms/{doc_id}` | GET/PUT | `forms.py` | Form fields |
| `/export` | POST | `export.py` | PDF/DOCX/HTML |
| `/security/{id}/encrypt` | POST | `security.py` | Password encrypt |
| `/storage/upload` | POST | `storage.py` | S3/local |
| `/embed/sessions` | POST/DELETE | `embed.py` | Widget sessions |

### Database & ORM

**ORM:** SQLAlchemy 2.0 async + asyncpg
**Models:** User, Tenant, Document, Page, Element, Form, Annotation, APIKey, StoredFile, DocumentHistory

### Storage

- PDFs: S3-compatible (MinIO/AWS) `s3://gigapdf/{tenant_id}/{doc_id}/`
- Cache: Redis (session, rendering)
- Metadata: PostgreSQL (JSONB)

### Background Jobs (Celery)

- `process_pdf` — Parse, OCR, thumbnails
- `export_pdf` — Render PDF/DOCX/HTML
- `merge_pdfs`, `split_pdf`, `encrypt_pdf`

## Widget Embed (Public/Private Keys)

### Build & Distribution

**Source:** `/packages/embed/src/`
- `index.ts` — GigaPdfEditor class (UMD)
- `react.tsx` — React wrapper

### API Keys

| Type | Prefix | Storage | Usage |
|------|--------|---------|-------|
| Private | `giga_sk_*` | DB hash | Backend only |
| Publishable | `giga_pub_*` | Plain text | Client-side embed |

**Endpoints:**
- `POST /api/v1/api_keys`
- `GET /api/v1/api_keys`
- `DELETE /api/v1/api_keys/{id}`

### postMessage Communication

**Parent → Iframe:**
```typescript
iframe.contentWindow.postMessage({
  type: 'gigapdf:command',
  action: 'export' | 'save' | 'load' | 'getFile',
  payload: {...}
}, allowedOrigin);
```

**Iframe → Parent:**
```typescript
window.parent.postMessage({
  type: 'gigapdf:event',
  event: 'ready' | 'save' | 'export' | 'error' | 'pageChange' | 'complete',
  data: {...}
}, parentOrigin);
```

### Security

- CORS: Whitelist origins (middleware)
- CSP: frame-ancestors, script-src, style-src
- Iframe sandbox: `allow-same-origin allow-scripts allow-forms allow-popups`

### Session Lifecycle

1. `POST /api/v1/embed/sessions` → `{ sessionId, documentId }`
2. Iframe loads `/embed?sessionId=...&documentId=...`
3. User edits
4. "Done" → iframe posts message
5. Parent receives blob PDF modifié
6. Session TTL 24h

## Dépendances Critiques (PDF-related)

| Package | Version | Usage |
|---------|---------|-------|
| pdf-lib | 1.17.1 | PDF rendering, encryption |
| pdfjs-dist | 4.10.38 | PDF parsing |
| canvas | 3.1.0 | Node.js server rendering |
| node-forge | 1.3.1 | Encrypt/decrypt |
| playwright | 1.50.1 | HTML→PDF, URL→PDF |
| fabric | 7.1.0 | Editable canvas |
| sharp | 0.33.5 | Image optimization |

## Key File Locations

**Frontend Editor:**
- `/apps/web/src/app/editor/[id]/page.tsx`
- `/apps/web/src/components/editor/`
- `/packages/editor/src/stores/`
- `/packages/pdf-engine/src/`
- `/packages/canvas/src/`

**Backend:**
- `/app/main.py`
- `/app/api/v1/`
- `/app/models/`
- `/app/repositories/`
- `/app/services/`
- `/app/tasks/`

**Widget:**
- `/packages/embed/src/index.ts`
- `/apps/web/src/app/embed/`
- `/app/api/v1/embed.py`

**Config:**
- `/turbo.json`
- `/docker-compose.yml`
- `.env.example`
- `/app/config.py`
