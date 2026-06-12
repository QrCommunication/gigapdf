# Changelog

All notable changes to GigaPDF are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
