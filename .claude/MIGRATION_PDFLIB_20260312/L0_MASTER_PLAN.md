# L0 MASTER PLAN — Migration PyMuPDF → Stack TS (pdf-lib + pdfjs-dist)

**Session**: MIGRATION_PDFLIB_20260312
**Date**: 2026-03-12
**Status**: IN_PROGRESS
**Revision**: 2 (post-impact analysis)

## Objectif

Remplacer PyMuPDF (AGPL-3.0) — seule dependance a licence restrictive — par une stack
TypeScript 100% permissive. Architecture hybride : Next.js gere les PDF ops via
@giga-pdf/pdf-engine, FastAPI conserve uniquement OCR/Celery/WebSockets.

## Decisions validees

| Decision | Choix | Raison |
|----------|-------|--------|
| Architecture | C: Hybride (Next.js + FastAPI OCR) | Meilleur compromis |
| Parsing/Extraction | pdfjs-dist (Apache-2.0) | Deja en frontend, couvre tout |
| Creation/Modification | pdf-lib (MIT) | API simple, TS-first |
| Rendu page→image | pdfjs-dist + node-canvas | Leger (~50MB vs ~400MB Playwright) |
| HTML→PDF | Playwright (MIT) | Chrome headless, rendu fidele |
| Thumbnails | sharp (Apache-2.0) | Rapide, pas de deps natives lourdes |
| Encryption | node-forge (BSD) | Chiffrement PDF natif JS |
| Tests | Ecrits sur le nouveau moteur TS | Pas de tests existants (0% coverage) |

## Architecture Revisee

```
┌─────────────────────────────────────────────────────────┐
│              @giga-pdf/pdf-engine (NEW)                  │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  pdfjs-dist │  │   pdf-lib    │  │  Playwright   │  │
│  │  (Apache)   │  │   (MIT)      │  │  (MIT)        │  │
│  │ • Parse     │  │ • Create     │  │ • HTML→PDF    │  │
│  │ • Extract   │  │ • Modify     │  └──────────────┘  │
│  │ • Render*   │  │ • Merge/Split│  ┌──────────────┐  │
│  │ • Text      │  │ • Forms      │  │ node-canvas   │  │
│  │ • Images    │  │ • Metadata   │  │ + pdfjs-dist  │  │
│  │ • Vectors   │  │ • Bookmarks  │  │ • Page→PNG    │  │
│  └─────────────┘  └──────────────┘  │ • Thumbnails  │  │
│  ┌─────────────┐  ┌──────────────┐  └──────────────┘  │
│  │ node-forge  │  │    sharp     │                     │
│  │  (BSD)      │  │  (Apache)    │                     │
│  │ • Encrypt   │  │ • Resize     │                     │
│  │ • Decrypt   │  │ • Convert    │                     │
│  │ • Perms     │  │ • Optimize   │                     │
│  └─────────────┘  └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
         │
         │ Import dans Next.js API Routes
         ▼
┌─────────────────────┐     ┌──────────────────┐
│  Next.js Web/Admin  │     │   FastAPI         │
│  API Routes /api/*  │     │   (OCR only)      │
│  + @giga-pdf/       │     │   Celery workers  │
│    pdf-engine       │     │   WebSockets      │
└────────┬────────────┘     │   pikepdf+tess    │
         │                  └────────┬─────────┘
         │                           │
         └──────────┬────────────────┘
                    ▼
         ┌──────────────────┐
         │  PostgreSQL 16   │
         │  Redis 7         │
         │  S3 Scaleway     │
         └──────────────────┘
```

## Phase 0 — Audit & Baseline [COMPLETE]

- [x] License audit: seul PyMuPDF (AGPL) est BLOCK
- [x] Impact analysis: 15 fichiers, 23+ endpoints, 0% tests
- [x] Code analysis: types TS deja 1:1 avec scene graph Python
- [x] REVISION: pdf-lib seul insuffisant → stack hybride adoptee

## Phase 1 — Architecture Blueprint [EN COURS]

- [ ] Blueprint @giga-pdf/pdf-engine (structure modules, exports, API surface)
- [ ] Mapping PyMuPDF → equivalent TS pour chaque operation
- [ ] Plan de migration fichier par fichier

## Phase 2 — Implementation Core

- [ ] Scaffold packages/pdf-engine/ (package.json, tsconfig, tsup)
- [ ] Module engine (open/save/metadata — pdf-lib)
- [ ] Module parse (text/images/vectors/annotations/forms — pdfjs-dist)
- [ ] Module render (add text/images/shapes/annotations — pdf-lib)
- [ ] Module merge-split (fusion/decoupe — pdf-lib)
- [ ] Module forms (AcroForm — pdf-lib)
- [ ] Module encrypt (chiffrement/permissions — node-forge + pdf-lib)
- [ ] Module preview (page→image — pdfjs-dist + node-canvas + sharp)
- [ ] Module convert (HTML→PDF — Playwright)

## Phase 3 — Integration API

- [ ] API routes Next.js pour toutes les PDF ops
- [ ] Adapter apps/web pour appeler les nouvelles routes
- [ ] Adapter apps/admin pour appeler les nouvelles routes
- [ ] Adapter apps/mobile client API
- [ ] Refactorer Python OCR (fitz → pikepdf + pdfplumber)
- [ ] Adapter Celery tasks restantes

## Phase 4 — Tests & Validation

- [ ] Tests unitaires pdf-engine (>= 80% coverage)
- [ ] Tests integration API routes
- [ ] Tests E2E (upload → edit → download)
- [ ] Benchmark comparatif

## Phase 5 — Cleanup

- [ ] Supprimer PyMuPDF de requirements.txt
- [ ] Mettre a jour Dockerfiles
- [ ] Nettoyer code Python mort
- [ ] Documentation finale

## Fichiers Impactes (15)

| # | Fichier | Lignes | Action | Module TS cible |
|---|---------|--------|--------|-----------------|
| 1 | app/core/pdf_engine.py | 474 | REMPLACER | engine/ |
| 2 | app/core/parser.py | 908 | REMPLACER | parse/ |
| 3 | app/core/renderer.py | 537 | REMPLACER | render/ |
| 4 | app/core/preview.py | 279 | REMPLACER | preview/ |
| 5 | app/core/ocr.py | 255 | REFACTORER | Reste Python (pikepdf) |
| 6 | app/services/document_service.py | ~500 | ADAPTER | Appelle TS via API |
| 7 | app/repositories/document_repo.py | ~300 | ADAPTER | Simplifie |
| 8 | app/repositories/redis_document_repo.py | ~200 | ADAPTER | Simplifie |
| 9 | app/api/v1/merge_split.py | ~400 | MIGRER | merge-split/ |
| 10 | app/api/v1/security.py | ~700 | MIGRER | encrypt/ |
| 11 | app/tasks/processing_tasks.py | ~200 | ADAPTER | Celery appelle TS |
| 12 | app/tasks/export_tasks.py | ~200 | MIGRER | Partiel → TS |
| 13 | app/api/v1/forms.py | ~? | MIGRER | forms/ |
| 14 | app/api/v1/annotations.py | ~? | MIGRER | render/ |
| 15 | app/api/v1/export.py | ~? | MIGRER | export/ |

## Risques

| Risque | Severite | Mitigation |
|--------|----------|------------|
| Parite parsing parser.py (908 lignes) | CRITIQUE | pdfjs-dist couvre rawdict equivalent |
| Encryption non supportee pdf-lib | HAUT | node-forge pour encrypt/decrypt |
| Rendu page fidelite | MOYEN | node-canvas + pdfjs-dist = 95% fidele |
| 0 tests existants | CRITIQUE | Tests sur nouveau moteur TS |
| Performance rendu | MOYEN | Pool de canvas, cache Redis |
