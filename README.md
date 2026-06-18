<p align="center">
  <img src="branding/logo-stacked.svg" alt="GigaPDF Logo" width="120" />
</p>

<h1 align="center">GigaPDF</h1>

<p align="center">
  <strong>The self-hostable WYSIWYG PDF editor — edit text, images and forms
  in your browser, with a complete REST API.<br>
  Open source, source-available under PolyForm Noncommercial 1.0.0
  (commercial licensing available).</strong>
</p>

<p align="center">
  <a href="https://github.com/QrCommunication/gigapdf/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-blue.svg" alt="License: PolyForm-Noncommercial-1.0.0" />
  </a>
  <a href="https://github.com/QrCommunication/gigapdf/blob/main/TRADEMARK.md">
    <img src="https://img.shields.io/badge/trademark-protected-orange.svg" alt="Trademark Protected" />
  </a>
  <a href="https://github.com/QrCommunication/gigapdf/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/QrCommunication/gigapdf/ci.yml?branch=main&label=CI" alt="CI" />
  </a>
  <a href="https://github.com/QrCommunication/gigapdf/actions/workflows/security.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/QrCommunication/gigapdf/security.yml?branch=main&label=security%20audit" alt="Security Audit" />
  </a>
  <a href="https://github.com/QrCommunication/gigapdf/stargazers">
    <img src="https://img.shields.io/github/stars/QrCommunication/gigapdf" alt="GitHub Stars" />
  </a>
  <a href="https://giga-pdf.com">
    <img src="https://img.shields.io/badge/cloud-giga--pdf.com-green" alt="Cloud" />
  </a>
</p>

<p align="center">
  <a href="#why-gigapdf">Why GigaPDF?</a> •
  <a href="#quick-start-self-hosting">Quick Start</a> •
  <a href="#cloud-vs-self-hosting">Cloud vs Self-hosting</a> •
  <a href="#features">Features</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Why GigaPDF?

- **True WYSIWYG editing** — Edit text directly in PDFs (not just annotate),
  thanks to a Fabric.js canvas layered on top of pdfjs-dist with full font
  re-embedding for accurate output.
- **Self-hostable from day one** — `docker compose up` and you're running.
  No cloud lock-in, no telemetry, your data stays on your infrastructure.
- **API-first design** — Complete REST API (OpenAPI documented) so you can
  integrate PDF editing into your own apps.

## Quick start (self-hosting)

GigaPDF can be self-hosted in two ways: **Docker** (recommended) or
**native** (bare-metal / VPS).

### Option 1 — Docker (recommended)

Prerequisites: Docker 24+ with the Compose plugin.

```bash
git clone https://github.com/QrCommunication/gigapdf.git
cd gigapdf
cp .env.example .env             # edit values, especially LEGAL_*
cp apps/web/.env.example apps/web/.env.local
docker compose up -d
# App at http://localhost:3000
```

The compose stack starts six services:

| Service | Image / build | Port |
|---|---|---|
| `postgres` | `postgres:17-alpine` | 5432 |
| `redis` | `redis:8-alpine` | 6379 |
| `api` | FastAPI backend (`Dockerfile.api`) | 8000 |
| `celery-worker` + `celery-beat` | Background jobs (`Dockerfile.api`) | — |
| `web` | Next.js frontend (`Dockerfile.web`) | 3000 |
| `admin` | Admin dashboard (`Dockerfile.admin`) | 3001 |

The `web` image is based on **Debian bookworm**. All PDF, OCR, Office
conversion, font processing, and HTML rendering run inside the in-house
**[gigapdf-lib](https://github.com/QrCommunication/gigapdf-lib)** Rust →
WASM engine — no third-party system binaries required.

> ⚠️ **Self-hosters must configure `NEXT_PUBLIC_LEGAL_*` env vars** in
> `apps/web/.env.local` for LCEN compliance. The web app refuses to start in
> production mode without them. See `apps/web/.env.example`.

### Option 2 — Native (bare-metal / VPS)

Prerequisites:

- **Node.js 24** + **pnpm 10.28**
- **Python 3.12** + venv (backend API, `requirements.txt`)
- **PostgreSQL 17** and **Redis 8**

Build and install:

```bash
git clone https://github.com/QrCommunication/gigapdf.git
cd gigapdf

# Backend (FastAPI + Celery)
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Frontend (Next.js web + admin + packages)
pnpm install && pnpm build
```

Run the services behind a reverse proxy. The repository ships systemd units
(`deploy/systemd/`) and an Nginx configuration (`deploy/nginx.conf`) whose
routing pattern is:

- `/api/pdf/*` and `/api/auth/*` → **Next.js** (`:3000`, TypeScript PDF engine)
- `/api/*`, `/socket.io/*`, `/webhooks/*` → **FastAPI** (`:8000`)
- `/admin` → admin dashboard (`:3001`)
- everything else → Next.js web (`:3000`)

See [`docs/guides/INSTALLATION.md`](docs/guides/INSTALLATION.md) and
[`docs/guides/DEPLOYMENT.md`](docs/guides/DEPLOYMENT.md) for the full
walkthrough.

## Cloud vs Self-hosting

| | Cloud (giga-pdf.com) | Self-hosted |
|---|---|---|
| **Setup** | Zero config | Docker / Kubernetes |
| **Updates** | Automatic | Manual (`git pull`) |
| **Support** | Email / SLA | Community (GitHub Discussions) |
| **Cost** | Subscription | Free (your infra cost) |
| **Data residency** | EU (Scaleway, Paris) | Wherever you host |
| **Customization** | Configuration only | Full code access |

The cloud version is operated by [QR Communication SAS](https://qrcommunication.com).
The self-hosted version uses the exact same code base.

## Features

### PDF Editing
- **Visual WYSIWYG editor** — Canvas-based editing with drag-and-drop and
  professional navigation: native scrolling while zoomed, cursor-anchored
  Ctrl+wheel zoom, 50–400% presets, Fit page / Fit width (Ctrl+0 / Ctrl+1),
  Space or middle-click panning
- **Text manipulation** — Add, edit, format text (bold, italic, underline,
  alignment); new text adopts the document's dominant font
- **Faithful fonts** — Automatic identification of the PDF's fonts with
  on-demand Google Fonts download through a server-side proxy
  (`/api/fonts/google`, DB + IndexedDB cache, no client request ever reaches
  Google); the downloaded font is embedded in the final PDF
- **Images & shapes** — Insert, resize, position visual elements
- **Annotations** — Highlights, comments, stamps, freehand drawings
- **Form designer** — Design and fill interactive PDF forms: text,
  multiline, date, checkbox, radio groups and dropdowns with editable
  options; required / read-only fields, defaults, max length and tab-order
  reordering; Design / Fill modes with highlighting of the document's
  existing fields and flattening after filling
- **Layers & multi-selection** — Per-element visibility and locking in a
  layers panel; batch-edit opacity, colors and alignment across a
  multi-selection

### Document operations
- Page management (add, remove, reorder, rotate)
- Merge & split documents
- Compression with the achieved ratio shown before applying
- Encryption & password protection
- Digital signatures (PKCS#7) with your own P12/PFX certificate —
  processed in memory only, never stored
- Watermarking (single page or whole document)
- PDF/A conversion
- OCR — text extraction from scans (fra+eng default) and "searchable PDF"
  mode that adds an invisible text layer to image-only pages
- Conversion (HTML → PDF, URL → PDF; Word, Excel, PowerPoint and
  OpenDocument ↔ PDF — import
  `.doc`/`.docx`/`.xls`/`.xlsx`/`.ppt`/`.pptx`/`.odt`/`.ods`/`.odp`,
  export DOCX/XLSX/PPTX/ODT/ODP; all processed natively by gigapdf-lib)
- Sharing (email invitations, public links) and document detail page with
  version history, one-click restore and activity history

### Document management
- Trash with restore — deleted documents are recoverable for 30 days,
  then purged automatically
- Tags with filtering and autocomplete
- Full-text search across document names and content (PostgreSQL
  `tsvector` + GIN index)
- Real thumbnails generated at upload and refreshed after editing
- Document duplication, folder organization & renaming
- Parallel uploads (3 concurrent)

### Public site & localization
- Bilingual app — interface in French and English; public pages are served
  under locale-prefixed URLs (French by default, English under `/en/*`)
  with per-page canonical and `fr`/`en`/`x-default` hreflang
- 32 SEO guide pages (20 PDF tools, 10 professions, 2 hubs) written in
  both languages with localized slugs and JSON-LD structured data
  (SoftwareApplication, HowTo, FAQPage)

### Developer tools
- **REST API** — Complete OpenAPI spec, see `docs/api/`
- **Webhooks** — Document lifecycle events
- **Real-time collaboration** — WebSocket-based: live element sync on the
  canvas, multiple cursors

## Architecture

GigaPDF is a pnpm + Turbo monorepo:

```
apps/
  web/        Next.js 16 frontend + API routes
  admin/      Admin dashboard
  mobile/     Expo / React Native app
packages/
  pdf-engine/ TypeScript PDF processing (pdfjs-dist + gigapdf-lib)
  canvas/     Fabric.js editor canvas
  editor/     React editor components
  embed/      Embeddable widget
  billing/    Stripe integration (optional)
  api/        TypeScript API client
  ui/         Shared UI components (shadcn-based)
  ...
```

See [`docs/architecture.md`](docs/architecture.md) for details.

## Contributing

Contributions are welcome! Please:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md)
2. Sign your commits with DCO: `git commit -s` (every commit, no exceptions)
3. Read the [Code of Conduct](CODE_OF_CONDUCT.md)

## Security

Found a vulnerability? **Do not open a public issue.** See [SECURITY.md](SECURITY.md)
for the private reporting process (GitHub Security Advisory or
contact@qrcommunication.com).

## License & Trademark

GigaPDF has **two distinct licensing regimes**:

### Code: PolyForm Noncommercial 1.0.0 (source-available)

The source code is source-available under [PolyForm Noncommercial 1.0.0](LICENSE):
free to use, study, modify and redistribute for any **noncommercial** purpose.
**Commercial use requires a separate license** — contact QR Communication at
<contact@qrcommunication.com> to discuss it.

### Name & logo: Trademarks of QR Communication SAS

The "GigaPDF" name and logo are trademarks of **QR Communication SAS**.
**Forks with code modifications must rebrand entirely** (different name,
different logo, different domain). See [TRADEMARK.md](TRADEMARK.md) for
details. Logo assets are in [`branding/`](branding/) under
[CC-BY-ND 4.0](branding/LICENSE).

## About

GigaPDF is built and maintained by [QR Communication](https://qrcommunication.com),
a Paris-based company.

- 🌐 **Cloud version**: https://giga-pdf.com
- 💬 **Discussions**: https://github.com/QrCommunication/gigapdf/discussions
- 📧 **Contact**: contact@qrcommunication.com
- 🐛 **Issues**: https://github.com/QrCommunication/gigapdf/issues
