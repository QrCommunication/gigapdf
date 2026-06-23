# Changelog

All notable changes to GigaPDF are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.0] - 2026-06-23

### Added
- **Long-term signature validation (PAdES-B-LT)** — extend a digital signature
  with embedded revocation data (OCSP/CRL) so it stays verifiable for years,
  even after the signing certificate expires (builds on the B-T timestamping
  added in 1.11.0).
- **Editor — native layers (OCG)**: show and toggle a PDF's optional-content
  layers, with a dedicated annotations panel and a document-language badge.
- **Document library — organize pages**: reorder, rotate and delete the pages of
  a stored document from a visual grid, without opening the editor.
- **Document library — export to 12 formats and PDF→PDF transforms**: convert or
  transform a stored document in place (Office, OpenDocument, image, Markdown,
  CSV, EPUB, HTML, RTF and text).

## [1.11.0] - 2026-06-23

### Added
- **Export to Markdown, CSV and EPUB** — available from the editor and the
  document library, alongside the existing Office (DOCX/XLSX/PPTX/ODT/ODP) and
  image (PNG/JPEG/WebP) outputs.
- **Ten new conversion tools** — PDF → ODS, ODP, HTML, RTF, text, Markdown, CSV
  and EPUB, plus CSV → PDF and Markdown → PDF, each with its own guide page.
- **Editor — table-of-contents editing**: read, add, rename, reorder and remove
  outline entries (bookmarks), written back into the PDF.
- **Editor — automatic PII redaction**: detect and truly remove personal data
  (emails, phone numbers, etc.) from the page, not just mask it.
- **Editor — page resizing** and **new annotation types**.
- **Document library — automatic conversion on import**: images and RTF files
  are converted to PDF as they are added, and a one-click **OCR** action makes
  scanned documents searchable.
- **Image watermarks** — stamp a logo or picture across the pages (not just
  text), from both the watermark tool and the editor.
- **Timestamped digital signatures (PAdES-B-T)** — add an eIDAS advanced
  electronic signature sealed with a trusted RFC 3161 timestamp (FreeTSA),
  proving when a document was signed.
- **List-box form fields** — create multi-choice list boxes when building
  interactive PDF forms, alongside text fields, checkboxes, radios and dropdowns.
- **Editor — rulers and draggable margin guides** (Word-style) in single-page
  view.

### Changed
- **Faithful document conversion, powered by gigapdf-lib 0.69.** Office imports
  (DOCX/XLSX/PPTX/ODT/ODS/ODP) preserve images, hyperlinks, styles, spreadsheet
  formulas and tables; the HTML→PDF renderer covers full CSS; image handling
  adds WebP, AVIF, SVG and GIF; and text is laid out with OpenType shaping for
  correct glyphs and spacing.

## [1.10.0] - 2026-06-21

### Added
- **Element transparency** — set the opacity of any shape or image; it is baked
  into the PDF (no quality loss).
- **Stacking order is saved** — bring to front / send to back is now written into
  the PDF itself, so the order is kept when the file is reopened anywhere.

### Changed
- **Live shape styling** — editing a vector shape's fill, stroke, width or dash
  now updates instantly on the page (WYSIWYG); shapes are rendered as real
  editable objects instead of a flat picture, so there is no stale preview.
- Powered by gigapdf-lib 0.58.1 (in-place opacity via ExtGState, native z-order
  that preserves each element's appearance, and per-element raster exclusion).

## [1.9.0] - 2026-06-21

### Added
- **Edit every element of a PDF — not just text.** Images and vector shapes
  imported from the original PDF can now be selected, moved, resized, deleted
  and duplicated directly on the page. Edits are applied **in place** (lossless)
  — no re-compression of images, no re-drawing of shapes.
- **Change vector shape styles** — fill colour, stroke colour, stroke width and
  dash pattern of a shape can be edited from the properties panel and are baked
  back into the PDF.
- **Layers** — organise page elements into named layers: create, rename,
  reorder, assign elements, and lock or hide a whole layer. Layers and their
  membership now **persist across sessions** (saved per document).
- **Stacking order** — bring an element to front / send to back (toolbar +
  Ctrl/Cmd+] and Ctrl/Cmd+[).

### Changed
- Powered by gigapdf-lib 0.57.0 (in-place affine transform + vector restyle,
  unified element index).

## [1.8.0] - 2026-06-21

### Changed
- **Direct text editing — the editor now renders real, editable text instead of
  a flat image.** Each page is rasterised *without* its text (engine
  `renderPageNoText`); the real text is drawn on top as live, editable text in
  its embedded font and true colour. Editing a text run is now direct and works
  over any background — including gradients and patterns — with no colour mask.
  Non-text content (vector art, gradients/shadings, images) stays pixel-perfect.
- **1:1 text fidelity even with broken embedded fonts.** Embedded subset fonts
  whose character map is missing/corrupt are now repaired server-side (a valid
  `cmap` and the required tables are synthesised from the PDF's encoding /
  `ToUnicode` / CID maps), so the browser always renders the original glyphs.
- **Full editing on every page of the continuous (Word-like) view.** The focused
  page is now a complete editor (create text/shapes, move/resize, retype, delete,
  undo/redo, toolbar) — identical to single-page mode; other pages stay fast,
  read-only previews.

### Fixed
- Text and form fields no longer appear duplicated when opening a document in the
  continuous editor.
- Embedded-font loading no longer floods the server (requests are now throttled
  and have a dedicated rate-limit budget), fixing failed font loads on
  font-heavy documents.

## [1.7.0] - 2026-06-21

### Added
- **Universal merge** — combine any files (PDF, Word, Excel, PowerPoint,
  OpenDocument, images JPG/PNG/GIF/WebP/AVIF, HTML, text, RTF) into a single
  PDF; every file is converted automatically before merging
  (`POST /api/pdf/merge-universal`)
- **Global command palette** (Ctrl/Cmd+K) — jump to any tool or page, or run a
  semantic search across your documents from anywhere in the app
- **Semantic document search** — new `/search` page backed by
  `GET /api/v1/search/semantic`
- **Nine new tools, now 29 in total** — universal merge, image to PDF, PDF to
  image, PDF to PowerPoint, PDF to Excel, RTF to PDF, text to PDF, redact PDF
  and unlock PDF
- **"Features" mega-menu** — lists every tool by category, available on every
  page of the marketing site
- New processing routes `POST /api/pdf/image-to-pdf` and
  `POST /api/pdf/to-image` (returns a ZIP of PNG pages)

### Changed
- Unified header and footer across the whole marketing site

### Fixed
- The semantic search page (`/search`) no longer returns a 404

## [1.6.0] - 2026-06-18

### Added
- New **`/engine`** page (fr + en, statically generated) presenting the in-house
  PDF engine in detail: real content editing, rendering & rasterization, AcroForm
  forms, annotations, RC4/AES encryption + PKCS#7 digital signatures, Type0/CID
  fonts with automatic Google Fonts embedding, a native HTML/CSS→PDF renderer with
  a built-in JavaScript engine, Office conversions (DOCX/XLSX/PPTX/ODT/ODS) and OCR.
- SDK cookbook: the `@qrcommunication/gigapdf-lib` documentation gains task-oriented
  recipes (merge, split, encrypt, sign, annotate, HTML→PDF with fonts, searchable
  OCR, metadata & bookmarks).

### Changed
- **Core PDF processing now runs on the in-house Rust→WebAssembly engine.** Page
  rendering, thumbnails, true redaction, compression, structured-text extraction,
  search, metadata and the PDF↔Office/HTML conversions all go through
  `@qrcommunication/gigapdf-lib` — no third-party PDF/Office/image runtime library.
  The browser canvas renderer loads the engine WASM directly (`load(url)`).
- Product and marketing copy updated to describe the home-made engine; internal
  render/preview identifiers renamed for clarity (`engineRenderPage`,
  `EngineRenderPageOptions`).

### Fixed
- Client bundle build: the engine's Node-only `loadDefault()` (`fs/promises` /
  `url`) is now stubbed out of the **browser** bundle (the browser path uses
  `GigaPdfEngine.load(url)` and never reaches it), unblocking `next build` for the
  embed/editor canvas. The server keeps the real modules (engine stays
  `serverExternalPackages`).

## [1.5.0] - 2026-06-14

### Added
- Export: every output format is now selectable directly from the editor and
  the dashboard — rasterized images (PNG / JPEG / WebP) and Office documents
  (DOCX / XLSX / PPTX / ODT / ODP).
- Mobile app upgraded to **Expo SDK 56** (React Native 0.85).
- Continuous deployment: every push to `main` now auto-deploys to production
  once CI is green (pushes that touch only the mobile app are skipped, since it
  ships via EAS). The README shows live **CI** and **Security Audit** status
  badges.

### Changed
- Runtime modernized to **Node.js 24**, **Redis 8** and **pnpm 10.28**
  (PostgreSQL stays at 17), with a full sweep of dependency major upgrades
  across the toolchain (Vitest 3.2, Fabric 7.4, and the rest).
- Authenticated areas (dashboard, editor, embed) are now explicitly `noindex`
  — defense in depth on top of `robots.txt`.
- OpenAPI version aligned to the product version (1.5.0).

### Fixed
- PDF → image export pipeline unblocked: pages are rasterized with MuPDF
  (fixes HTTP 500 on documents containing images), the pdf.js worker is
  configured for in-thread rendering on the server, export directory
  permissions and the queue / internal-auth / job-status wiring are corrected,
  and "Document not found" on rapid export bursts is resolved.
- Page thumbnails are now generated with MuPDF.

### Security
- All open Dependabot alerts cleared (**76 → 0**): CRITICAL/HIGH transitive
  bumps via `pnpm.overrides`, removal of a stale npm lockfile in `apps/mobile`,
  and Python dependency CVE fixes.

## [1.4.0] - 2026-06-13

### Added
- Public site is now statically generated (SSG): the landing, auth, legal
  and SEO pages prerender per locale (fr + en) with the correct
  `<html lang>` — faster TTFB and fully crawlable HTML. Implemented via
  Next.js multiple root layouts (route groups `(site)` for the localized
  public perimeter, `(app)` for the authenticated app which stays dynamic).
- `/docs`: detailed self-hosting guide (Docker and native — Python venv +
  `pip install -r requirements.txt`, pnpm, system dependencies, Alembic
  migrations, nginx routing) and an API & developers section linking
  Swagger (`/api/docs`), Redoc (`/api/redoc`) and the OpenAPI schema.
- OpenAPI metadata: title, version 1.4.0, AGPL license, contact, grouped
  tags.

### Fixed
- Security: PDF hyperlinks in the editor now open only `http(s)` URLs with
  `noopener,noreferrer` (blocks `javascript:`/`data:` URI XSS).
- Security: the embed page validates the postMessage origin against the
  embedding parent and targets replies (including the file Blob) to that
  origin instead of `*`.
- SEO 404s for unknown/cross-locale tool & solution slugs are now native
  HTTP 404 (static `dynamicParams = false`), replacing the proxy rewrite.
- GitHub URLs corrected to `QrCommunication/gigapdf` across the public site.

## [1.3.0] - 2026-06-13

### Added

**Public site**
- English version of the public pages with locale-prefix routing —
  French URLs are unchanged (default locale, no prefix), English lives
  under `/en/*`, with per-page canonical URLs and valid
  `fr`/`en`/`x-default` hreflang alternates. Dashboard, editor and
  embed keep their cookie-based locale and stay unprefixed.
- 32 programmatic SEO pages, each written in both French and English
  with localized slugs (e.g. `/tools/editer-pdf` ↔
  `/en/tools/edit-pdf`): 20 tool guides, 10 profession pages and the
  2 hub pages, with JSON-LD structured data (SoftwareApplication,
  HowTo, FAQPage, BreadcrumbList). The sitemap now lists both locales
  (~73 URLs).
- Landing page redesign — "print-shop editorial" direction: crop
  marks, fixed scroll ruler, numbered sections, asymmetric hero with a
  pure-CSS editor mockup, and an animated bento grid
  (reduced-motion safe).

**Editor**
- Professional canvas navigation: native scrolling when zoomed (fixes
  the "cannot move around the page once zoomed in" lock-up),
  Ctrl+wheel zoom anchored at the cursor, presets from 50% to 400%,
  Fit page / Fit width, Ctrl+0 / Ctrl+1 shortcuts, and panning with
  Space-hold or middle-click.
- Professional form designer: multiline text, date fields, radio
  groups and dropdowns with editable options; rich field properties
  (unique-name validation, tooltip, required, read-only, defaults,
  max length, font size, alignment); Design / Fill modes with
  highlighting of the document's existing fields; flattening after
  filling; field list with tab-order reordering; 4 px edge snapping.
  The server-side bake honors required, defaults, maxLength, password,
  fontSize, alignment and tooltip.

### Changed
- Honest pricing: every feature ships on every plan, free included —
  plans differ by volumes (storage, documents, API calls, team
  members), branding and support. The fake "advanced editing"
  differentiator is gone.

### Fixed
- **Google OAuth: every sign-up failed** with `unable_to_create_user`.
  better-auth declared the additional field `is_admin` (snake_case)
  while the Prisma client field is `isAdmin`, so each
  `prisma.user.create()` triggered by a Google sign-up threw a
  validation error.
- Plan quotas: the three plan sources of truth (seed script, quota
  service, ORM defaults) are now aligned; enterprise "unlimited" is
  consistently encoded as `-1`; two `-1` quota comparisons that were
  always true / always false are fixed; the free plan's document-limit
  default is now 100 (was 1000).
- Removed hreflang alternates that pointed to 404 URLs.

### Notes for self-hosters
- **Database migration required** after updating:
  ```bash
  source venv/bin/activate
  alembic upgrade head
  ```
  v1.3.0 ships migration `018_free_doc_limit`, a data migration that
  resets free-plan quota rows created with the stale 1000
  document-limit default back to 100 (custom limits set by an admin
  are left untouched). Verify with `alembic current` that
  `018_free_doc_limit` is applied.
- The public site now serves English pages under `/en/*`. The
  reference nginx config routes everything outside `/api/*` to
  Next.js, so no change is needed there — but if you maintain a custom
  path allow-list in front of the web app, make sure `/en/*` reaches
  Next.js.

## [1.2.0] - 2026-06-13

### Added

**Document management**
- Trash: deleting a document now soft-deletes it. New `/trash` page to
  restore or permanently delete documents; trashed documents are purged
  automatically after 30 days (Celery task).
- Tags on documents (max 20, normalized lowercase): chips in the list
  views, tag filter, autocomplete from your existing tags, and a
  manage-tags dialog.
- Full-text search across document names **and** document content
  (PostgreSQL generated `tsvector` + GIN index).
- Real document thumbnails: page 1 is rendered at upload and refreshed
  after editing (`POST /api/v1/storage/documents/{id}/thumbnail`).
- Document duplication ("name (copie)", "(copie 2)", …).
- Folder renaming (`PATCH /api/v1/storage/folders/{id}`).
- Parallel uploads (pool of 3 concurrent uploads).
- Wider import formats: PDF plus Word (`.doc`/`.docx`), Excel
  (`.xls`/`.xlsx`), PowerPoint (`.ppt`/`.pptx`) and OpenDocument
  (`.odt`/`.ods`/`.odp`) — converted to PDF on import.
- Activity history on the document detail page.

**Editor**
- Real-time collaboration is now effective: element changes made by other
  participants appear live on the canvas (server-side WebSocket relay of
  `element:create` / `element:update` / `element:delete`, applied to the
  Fabric canvas).
- Layers panel wired to the scene graph: per-element visibility and
  locking.
- Multi-selection editing: opacity, colors and alignment applied to every
  selected element at once.
- PDF compression with the achieved ratio displayed before applying it to
  the document.
- OCR "searchable PDF": adds an invisible text layer to image-only pages
  so scanned documents become selectable and searchable.
- Digital signature (PKCS#7) with a P12/PFX certificate — the certificate
  and its passphrase are processed in memory only, never stored.
- Export to ODT and ODP, in addition to DOCX, XLSX and PPTX.

**Backend**
- `POST /api/v1/logs`: rate-limited ingestion endpoint for frontend logs.

### Fixed
- **Alembic `migrations/env.py`: migrations were silently rolled back**
  on every database where the `alembic_version` table already existed.
  An implicit transaction opened by the version-table check was never
  committed, so `alembic upgrade head` exited 0 and logged
  "Running upgrade …" while applying **no** schema change. Self-hosters
  should run `alembic upgrade head` again after updating and verify with
  `alembic current` that the latest revision (`017_ged_features`) is
  applied.

### Changed
- The seven legacy FastAPI PDF-manipulation routers (bookmarks, forms,
  history, layers, modify, pages, security — 29 endpoints) are now
  flagged as deprecated in OpenAPI. They are superseded by the TypeScript
  pdf-engine routes (`/api/pdf/*`) and scheduled for removal.
- Removed the unimplemented annotation and text endpoints that only
  returned HTTP 501.

### Notes for self-hosters
- **Database migration required** after updating:
  ```bash
  source venv/bin/activate
  alembic upgrade head
  ```
  v1.2.0 ships migration `017_ged_features` (full-text search columns and
  trash index on `stored_documents`). Because of the `env.py` bug fixed in
  this release, double-check with `alembic current` that the revision is
  really applied.

## [1.1.1] - 2026-06-12

### Fixed
- nginx reference config: `/api/` now defaults to Next.js, with FastAPI
  scoped to its real prefix `/api/v1/` (+ `/api/docs`, `/api/redoc`).
  The previous allow-list routing sent every non-enumerated Next.js API
  route to FastAPI, returning 404 in production for `/api/office/*`
  (Office conversion), `/api/health`, `/api/fonts/google` and
  `/api/v1/embed/validate-key` (embed widget). New Next.js API routes now
  work without touching nginx.

## [1.1.0] - 2026-06-12

### Added
- Automatic identification of the PDF's fonts with on-demand Google Fonts
  download through a server-side proxy (`GET /api/fonts/google`). Lookups
  are cached in the database (`font_cache`) and in the browser (IndexedDB);
  no client request ever reaches Google — GDPR-friendly.
- Server-side bake integration: a font downloaded from Google Fonts is
  embedded in the final PDF, so the saved document renders identically
  everywhere.
- Real text formatting in the editor: bold, italic, underline and text
  alignment.
- Watermark "Apply to document" option (whole document, not just the
  current page).
- Share button in the editor toolbar.
- Document detail page: preview, metadata, and version history with
  one-click restore.
- New text elements adopt the document's dominant font.
- Global toast notification system.

### Fixed
- `Dockerfile.web` / `Dockerfile.admin`: Debian (bookworm) base image with
  the complete PDF system dependencies (LibreOffice, fontforge,
  tesseract-ocr fra+eng, Playwright Chromium), correct `public/` path for
  the standalone monorepo output, and workspace-aware install.
- Folder deletion now wired in the documents list view.
- Missing i18n keys.

### Changed
- `docker-compose.yml`: `env_file` is now set on every application service
  (api, celery-worker, celery-beat, web, admin), so the root `.env` is
  passed in full.

## [1.0.0-oss] — 2026-04-26

### Added
- `LICENSE` (GNU AGPL-3.0-or-later) — the project is now officially
  open source. The previous README announced "MIT" but no LICENSE
  was published, leaving the code in a "all rights reserved" state.
- `TRADEMARK.md` — strict trademark policy: forks with code modifications
  must rebrand entirely. Hosting an unmodified copy is allowed with
  disclaimer. Logo CC-BY-ND 4.0.
- `SECURITY.md` — vulnerability reporting via GitHub Security Advisories
  or contact@qrcommunication.com, with response SLAs per severity.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `.github/workflows/dco.yml` — DCO check on every PR. All commits must
  be signed off (`git commit -s`).
- `.github/ISSUE_TEMPLATE/` — bug, feature, and security templates.
  Blank issues disabled.
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist with DCO reminder.
- `branding/` folder — 4 SVG logo variants under CC-BY-ND 4.0.
- 4 separate legal pages: `/legal-notice`, `/privacy`, `/terms`,
  `/cookies`. Personal email replaced by `contact@qrcommunication.com`.
- `apps/web/src/lib/env.ts` — Zod-validated public legal env vars.
  Production refuses to start without them.

### Changed
- `README.md` — full rewrite: AGPLv3 + trademark badges, new pitch,
  3 differentiators, Cloud vs Self-hosted comparison, License &
  Trademark section, About QR Communication.
- `CONTRIBUTING.md` — repo URL updated (ronylicha → QrCommunication),
  DCO sign-off section added, license clause added.
- All 17 `package.json` files declare `"license": "AGPL-3.0-or-later"`
  per SPDX.
- Hardcoded VPS IP (`51.159.105.179`) removed from deploy scripts and
  docs. `deploy/redeploy.sh` and `deploy/push-deploy.sh` now require
  `GIGAPDF_VPS_HOST` / `DEPLOY_HOST` and fail-fast if missing.
- Hardcoded personal email (`rony@ronylicha.net`) removed from privacy
  and terms pages. Now sourced from `env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`.

### Notes for self-hosters
- You **must** configure `NEXT_PUBLIC_LEGAL_*` env vars in
  `apps/web/.env.local` to comply with French LCEN. The app refuses
  to start in production without them. See `apps/web/.env.example`.
- For deploy scripts: `export GIGAPDF_VPS_HOST=your.host.example.com`
  before running `deploy/redeploy.sh`.

### Links
- AGPLv3 text: https://www.gnu.org/licenses/agpl-3.0.txt
- Trademark policy: [TRADEMARK.md](TRADEMARK.md)
- Logo assets: [branding/](branding/)
