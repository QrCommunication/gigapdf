# Impact Analysis - GigaPDF Editor & Fonts Pipeline

Session: SESSION_20260421_gigapdf_audit
Date: 2026-04-21
Scope:
1. Fix edition PDF + persistence pipeline
2. Auto-extraction of embedded PDF fonts on open
3. On-the-fly font loading via FontFace API + frontend cache

Overall Risk: HIGH (Score 7/10) — touches multipart save flow, widget contract, shared types contract (TS + Python), and adds new public endpoints.

---

## 1. Cartographie des fichiers impactés

### 1.1 Backend — Python FastAPI (monolith `app/`)

| File | Role | Impact |
|---|---|---|
| `app/api/v1/storage.py` (2700+ LOC) | POST /api/v1/storage/documents (save), /load, /versions | MEDIUM — save path already handles the PDF bytes; need to verify version bump logic and file-bytes routing from editor session |
| `app/api/v1/embed.py` | POST /embed/sessions, /complete, DELETE | LOW — only consumed by widget, add fonts in session metadata if needed |
| `app/api/v1/documents.py` | Document session CRUD | LOW — potential `fonts[]` field on open response |
| `app/api/v1/modify.py` / `elements.py` / `text.py` / `forms.py` | Element CRUD for session docs | MEDIUM — font_family on TextElement must remain accepted |
| `app/services/storage_service.py` | AES-256-GCM encryption, S3 persist, versioning | LOW — interface stable, but confirm `save_document` receives rebuilt PDF bytes (not element graph) |
| `app/services/document_service.py` | Session-level document ops | MEDIUM — might need a `get_fonts(document_id)` method |
| `app/models/elements.py` | TextStyle (`font_family`, `original_font`) | LOW — fields exist (`font_family`, `original_font`). NO schema change needed for persistence. |
| `app/models/page.py` / `database.py` | PageObject / DB tables | MEDIUM — optional new `fonts` field on PageObject or `document.metadata.fonts[]` |
| NOT FOUND: any `/api/v1/fonts` endpoint, any `pdf_fonts` table, any font extractor | — | Must be CREATED |

### 1.2 Node.js/TS "PDF engine" — `packages/pdf-engine` (server-side handler in Next.js)

| File | Role | Impact |
|---|---|---|
| `packages/pdf-engine/src/parse/parser.ts` | `parseDocument()` entry point using pdfjs-dist | HIGH — needs a new `extractFonts` step; `buildPageObject()` must aggregate font metadata |
| `packages/pdf-engine/src/parse/text-extractor.ts` | Extracts text items + `mapPdfFontToStandard` | HIGH — currently maps PDF font names via heuristics; needs to surface `fontRef` + `dataUrl` for embedded fonts |
| `packages/pdf-engine/src/utils/font-map.ts` | `normalizeFontName`, `mapPdfFontToStandard` | MEDIUM — add helpers for embedded-font hash/name |
| `packages/pdf-engine/src/engine/document-handle.ts` + `page-ops.ts` | `openDocument`/`saveDocument` via pdf-lib | HIGH — `saveDocument()` must preserve embedded fonts (risk of GC removing them with `garbage: 1-4`) |
| `packages/pdf-engine/src/render/text-renderer.ts` | `addText`/`updateText` writes text with pdf-lib StandardFonts | CRITICAL — today defaults to `StandardFonts.Helvetica` (see `font-map.ts:46`). Editing text loses the original embedded font => visible regression after save. |
| NEW: `packages/pdf-engine/src/parse/font-extractor.ts` | — | CREATE — Parse font dict via pdfjs `commonObjs`/`Resources/Font`, export TTF/OTF/CFF bytes |
| `packages/pdf-engine/src/index.ts` | Public re-exports | MEDIUM — add `extractFonts`, types `ExtractedFont` |

### 1.3 Next.js app — `apps/web/src/app/api/pdf/*`

| File | Role | Impact |
|---|---|---|
| `apps/web/src/app/api/pdf/open/route.ts` | POST /api/pdf/open (parse+scene graph) | HIGH — response schema gets new `fonts: ExtractedFont[]` or `pages[].fonts` field |
| `apps/web/src/app/api/pdf/save/route.ts` | POST /api/pdf/save (re-write bytes) | HIGH — default `garbage=0` is safe; guard against upgrading to garbage>0 which drops unused resources including fonts |
| `apps/web/src/app/api/pdf/apply-elements/route.ts` | POST /api/pdf/apply-elements (edit pipeline) | CRITICAL — the core edition path. Currently calls `updateText`/`addText` which fall back to Helvetica => silent font loss. |
| NEW: `apps/web/src/app/api/pdf/fonts/route.ts` (or `[documentId]/fonts/[fontId]/route.ts`) | Serve individual extracted font files | CREATE — returns `font/ttf` or `font/otf` bytes |
| `apps/web/src/app/api/v1/embed/validate-key/route.ts` | Widget auth | LOW — unchanged |

### 1.4 Frontend — `apps/web/src` + packages

| File | Role | Impact |
|---|---|---|
| `apps/web/src/app/editor/[id]/page.tsx` | Main editor page, wires `useApplyElements` + `useDocumentSave` | HIGH — must load fonts before painting; pass `fonts[]` to canvas |
| `apps/web/src/app/embed/[[...params]]/page.tsx` | Widget iframe page | HIGH — must load fonts in iframe too; cross-origin fetch considerations |
| `apps/web/src/hooks/use-document.ts` | Fetches scene graph | MEDIUM — consume new `fonts` field |
| `apps/web/src/hooks/use-document-save.ts` | Hybrid save hook (immediate/debounced/auto) | LOW — stable API, no change to behavior |
| `apps/web/src/components/editor/content-edit-layer.tsx` | ElementModification aggregator | MEDIUM — include `fontRef` in modifications so backend can re-use embedded font |
| `apps/web/src/components/editor/editor-canvas.tsx` + `packages/canvas/src/**` | Fabric canvas renderer | HIGH — `fontFamily: "Arial"` default in `text-renderer.ts:57` and `text-tool.ts:87,120`; must resolve to extracted font name once loaded |
| `packages/canvas/src/objects/pdf-text.ts` | Fabric PDFText object | MEDIUM — use extracted font family name instead of fallback |
| `packages/ui/src/components/editor/font-picker.tsx` | UI font selector (21 hardcoded fonts) | MEDIUM — merge with extracted fonts list |
| NEW: `packages/canvas/src/utils/font-loader.ts` (or `apps/web/src/lib/font-loader.ts`) | FontFace API + LRU cache | CREATE |

### 1.5 Widget SDK — `packages/embed`

| File | Role | Impact |
|---|---|---|
| `packages/embed/src/index.ts` | `GigaPdfEditor` class, iframe mounting, postMessage | LOW-MEDIUM — no new event needed but `ready` timing shifts (fonts must load first) |
| `packages/embed/src/types.ts` | SDK public contract | LOW — no breaking change if we keep same events |
| `packages/embed/src/react.tsx` | React wrapper | LOW |

### 1.6 Storage

- **Current**: PDFs stored encrypted (AES-256-GCM) in S3 via `StorageService`. Metadata in Postgres `stored_documents` + `document_versions`.
- **Fonts**: NO dedicated storage today. Options:
  - A) Extract on-demand in-memory from PDF bytes (no DB) — RECOMMENDED for MVP
  - B) Cache extracted fonts in S3 keyed by `{stored_document_id}/{version}/{font_hash}.ttf` — recommended for performance
  - C) New table `pdf_fonts` (REJECTED — high cost, low value for the MVP)

---

## 2. APIs publiques touchées

### 2.1 Existantes — breaking change potentiel

| Endpoint | Change | Breaking? |
|---|---|---|
| `POST /api/pdf/open` | Add `fonts: ExtractedFont[]` on pages OR root `data` | NO (additive) |
| `POST /api/pdf/apply-elements` | Text operations must respect `originalFont` / font ref | YES (silent regression today) — fix is mandatory, not a breaking change |
| `POST /api/pdf/save` | Keep `garbage=0` default | NO |
| `POST /api/v1/storage/documents` | No schema change | NO |
| `POST /api/v1/embed/sessions` + `/complete` | No schema change | NO |

### 2.2 Nouveaux endpoints — à créer

| Method + Path | Purpose | Auth |
|---|---|---|
| `GET /api/pdf/fonts/:documentId` | List fonts of session doc | Session |
| `GET /api/pdf/fonts/:documentId/:fontId` | Stream font bytes (TTF/OTF) | Session (short-lived signed URL preferred) |
| Widget variant: `GET /api/v1/embed/sessions/:sessionId/fonts/:fontId` | Same but scoped to widget session | API Key (X-API-Key) |

Response contract proposée (ExtractedFont):
```ts
interface ExtractedFont {
  id: string;           // hash of font data (sha256 prefix 16 chars)
  name: string;         // original PDF internal name
  family: string;       // normalized family ("Helvetica", "MyCustomFont")
  weight: "normal" | "bold" | number;
  style: "normal" | "italic";
  format: "truetype" | "opentype" | "cff";
  embedded: boolean;    // false => standard/system font, no download needed
  url: string | null;   // signed URL to font bytes if embedded
  sizeBytes: number;
}
```

### 2.3 Widget embed contract (postMessage)

- `GigaPdfOutboundMessage.action`: `save | export | load | getFile` — no change
- `GigaPdfInboundMessage.event`: `ready | save | export | error | pageChange | complete` — no breaking change; `ready` fires only after fonts loaded
- Cross-origin consideration: font URLs must include proper CORS headers (`Access-Control-Allow-Origin`) because the iframe origin differs from parent

---

## 3. Schéma BD impacté

### Current (Postgres)
- `stored_documents`, `document_versions`, `folders` — handle encrypted PDF blobs
- No font-specific table

### Changes required

| Change | Priority |
|---|---|
| Option A — NO schema change, fonts extracted on-demand from PDF bytes | RECOMMENDED |
| Option B — Add `metadata.fonts` JSON column to `document_versions` (cache) | Optional perf win |
| Migration needed? | NO for MVP (Option A); YES (single JSONB column, zero-downtime) for Option B |

**Recommendation**: Option A (no migration). Ship font extraction as a stateless server function; add S3 cache layer only if p95 latency exceeds 2s.

---

## 4. Risques de régression (Critique / Haut / Moyen / Bas)

### CRITIQUE

1. **Font loss during text edit** — `apply-elements/route.ts` + `render/text-renderer.ts` already fall back to Helvetica when editing any non-standard font text. Currently IN PRODUCTION. Fix must avoid corrupting the embedded font table in the PDF.
2. **PDF corruption via pdf-lib save** — `saveDocument()` with `garbage: 1-4` may GC embedded font objects that pdfjs parsed but pdf-lib doesn't recognize as "used" after text edit. Must force `garbage: 0` OR re-embed the font before saving.
3. **Data loss on concurrent save** — `useDocumentSave` debounced at 2s + immediate path; two `saveWithPriority('immediate')` calls set `savingRef` guard, but `performSave` early-returns `false` (not queued). A critical edit during save is silently dropped.
4. **Widget iframe font isolation** — iframe origin differs from parent; `new FontFace(...).load()` will fail silently on CORP/CORS mismatch.

### HAUT

5. **Memory leak on font cache** — If cache is keyed by `documentId+fontId` without bounds, long-running embed sessions grow unbounded. Must be LRU with size cap.
6. **SSRF via font URLs** — If the widget accepts an external `file` URL and the backend fetches remote fonts by URL, vulnerable to SSRF (fetch http://169.254.169.254/...). Fonts MUST be extracted from the PDF bytes only, never fetched by URL.
7. **Font injection / malicious TTF** — Extracted bytes served back to the browser; a maliciously crafted TTF can crash the renderer. Sanitize via a font parser before serving, or use `subtle` CORP headers + integrity checks.
8. **Auto-save `beforeunload` regression** — Adding font-loading promises to the editor's boot path can extend "first interactive" window, causing users to close the tab before initial save; `pendingChanges` counter might skew.
9. **License compliance** — Commercial fonts embedded in a PDF are typically licensed for rendering that PDF only. Re-serving the TTF over HTTP to arbitrary embedders may violate the font license.

### MOYEN

10. **CSP blocking `font-src`** — Current CSP (if any) needs `font-src 'self' data: blob:` + the domain where fonts are served.
11. **Content-Type mismatch** — Serving `font/ttf` vs `application/x-font-ttf` matters for some browsers.
12. **`originalFont` lost on round-trip** — `TextStyle.originalFont` exists on both TS (`elements.ts:42`) and Python (`elements.py:91`) but is NOT propagated through `apply-elements` operations.
13. **Fabric canvas font-name collision** — If two docs have fonts both normalized to "Helvetica", loading the second FontFace overwrites the first unless names are scoped (e.g., `${docId}__Helvetica`).

### BAS

14. **i18n / RTL fonts** — Heuristic `mapPdfFontToStandard` ignores non-Latin scripts; extracted fonts fix this as a side-effect.
15. **Performance — initial parse** — Adding font extraction to `parseDocument` grows response size (+100KB-2MB per font). Needs compression (brotli) and/or lazy-load per-page.

---

## 5. Dépendances entrantes / sortantes

### 5.1 PDF editor callers (incoming)

- `apps/web/src/app/editor/[id]/page.tsx` — authenticated flow
- `apps/web/src/app/embed/[[...params]]/page.tsx` — widget iframe
- `packages/embed/src/index.ts` — external SDK consumers
- `examples/` — public snippets in `/home/rony/Projets/gigapdf/examples`

### 5.2 Editor outgoing calls

- `POST /api/pdf/open` -> `@giga-pdf/pdf-engine.parseDocument` -> `pdfjs-dist`
- `POST /api/pdf/apply-elements` -> `pdf-lib` (`addText`, `updateText`, `deleteElementArea`)
- `POST /api/pdf/save` -> `pdf-lib` (`saveDocument`)
- `POST /api/v1/storage/documents` -> Python `StorageService.save_document` -> AES-256-GCM -> S3
- WebSocket `/ws/collaboration/*` -> `CollaborationService` (not in scope here)

### 5.3 Tests existants

**Covered (regression-sensitive)**:
- `packages/pdf-engine/__tests__/parse/parser.test.ts`
- `packages/pdf-engine/__tests__/parse/text-extractor.test.ts`
- `packages/pdf-engine/__tests__/utils/font-map.test.ts` — confirms `normalizeFontName` and `mapPdfFontToStandard`
- `packages/pdf-engine/__tests__/render/text-renderer.test.ts`
- `packages/pdf-engine/__tests__/engine/document-handle.test.ts`

**NOT covered (gap)**:
- `apps/web/src/app/api/pdf/apply-elements/route.ts` — no integration test for text edit preserving embedded fonts
- `apps/web/src/app/api/pdf/open/route.ts` — no contract test on response shape
- `apps/web/src/hooks/use-document-save.ts` — no test for debounce + immediate races
- `packages/embed/src/**` — only `index.test.ts` for SDK happy-path
- No E2E for widget font loading
- No Python test for `/api/v1/storage/documents` encryption round-trip
- No fixture with CID/embedded fonts in `packages/pdf-engine/__tests__/fixtures/`

---

## 6. Recommandations AVANT modification

### 6.1 Tests de non-régression à créer (prioritaires)

1. **Fixture PDF** with embedded fonts (at least 1 CID font, 1 subset TTF, 1 standard Helvetica). Place in `packages/pdf-engine/__tests__/fixtures/embedded-fonts.pdf`.
2. **Integration test** `apply-elements.test.ts` — edit text in embedded-font PDF, save, re-parse, assert fontFamily preserved.
3. **Snapshot test** on `parseDocument` response shape (catch breaking additions).
4. **Unit test** on new `font-extractor.ts` — extraction + hashing stable across runs.
5. **Hook test** `use-document-save.test.tsx` — race between immediate and debounced saves, verify no dropped change.
6. **E2E** (Playwright) — Widget mode: load PDF with Arabic/Asian embedded font, verify visual render matches.
7. **Security test** — malformed TTF rejected, oversized font (>10MB) rejected, SSRF blocked.

### 6.2 Feature flags recommandés

| Flag | Scope | Default |
|---|---|---|
| `FONT_EXTRACTION_ENABLED` | Backend (Python + Node route) | false on prod until validated |
| `FONT_DYNAMIC_LOAD_ENABLED` | Frontend (editor + widget) | false on prod |
| `PDF_SAVE_GARBAGE_LEVEL` | `save` route env var | 0 (never higher until validated) |

### 6.3 Backups recommandés

1. **S3 snapshot** of staging `stored_documents` bucket before first deploy (documents already versioned, but snapshot the versioning metadata too).
2. **Postgres dump** of `stored_documents` + `document_versions` (schema + data) — 5 min operation.
3. **Git tag** `pre-font-pipeline-v1.0.0` on current `main` before any merge.
4. **Feature branch** `feature/pdf-font-extraction` — no direct commits to main.

### 6.4 Plan de rollback

- Env vars flip (instant): `FONT_EXTRACTION_ENABLED=false`, `FONT_DYNAMIC_LOAD_ENABLED=false`
- Revert migration: N/A if Option A chosen
- Revert deploy: git revert + `git push` + redeploy (deploy workflow doc: `rules/devops-cicd.md`)

### 6.5 Validation utilisateur

This is **HIGH risk** (score 7/10). User MUST confirm before implementation:
- Accept plan (fonts extracted stateless, served via short-lived URLs)?
- Accept keeping `garbage=0` on save (slightly larger files but no font loss)?
- Accept that first phase does NOT write to DB (Option A)?
- Accept font license risk disclaimer (serving embedded fonts may conflict with commercial font EULAs) and scope limited to rendering-only, no download-to-disk button?

### 6.6 Agents à impliquer

1. `fullstack-coordinator` — owns cross-cutting edit pipeline fix
2. `backend-laravel` -> NOT relevant; use a Python-focused agent for FastAPI routes
3. `frontend-react` — editor/widget FontFace integration
4. `security-specialist` — TTF validation + SSRF + CSP `font-src`
5. `qa-testing` — non-regression matrix before merge
6. `performance-engineer` — p95 latency on open (parse + font export)
7. `regression-guard` — MANDATORY after any code change

---

## 7. Résumé exécutif

- **Fichiers impactés**: ~22 directs, ~8 à créer
- **Tests à exécuter**: 5 suites existantes + 7 nouveaux tests à écrire
- **Endpoints à créer**: 2 (`/api/pdf/fonts/:documentId`, `/api/pdf/fonts/:documentId/:fontId`)
- **Breaking changes API publics**: 0 (si additions rétrocompatibles)
- **Migration BD**: 0 (Option A, recommandée)
- **Risque le plus critique**: perte silencieuse de la police à chaque édition de texte (déjà en production aujourd'hui via `apply-elements` -> Helvetica fallback)

**Action bloquante avant développement**: valider avec l'utilisateur le choix Option A (stateless, sans migration) vs Option B (cache S3 + JSONB metadata).

---

## Annexe — Fichiers clés absents ou non trouvés

- No `/api/v1/fonts` endpoint (Python) — confirmed absent via `Grep` on `app/api/v1/`
- No `pdf_fonts` table — confirmed absent in `migrations/versions/` and `app/models/database.py`
- No font extractor in `packages/pdf-engine/src/parse/` — confirmed absent
- No E2E test for widget mode — confirmed absent in `packages/embed/src/__tests__/`
- No fixture PDF with embedded CID fonts — confirmed absent in `packages/pdf-engine/__tests__/fixtures/`
