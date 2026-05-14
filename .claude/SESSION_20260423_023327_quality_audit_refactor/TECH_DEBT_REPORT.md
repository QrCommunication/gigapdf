# GigaPDF — Tech Debt Master Report

**Date** : 2026-04-22
**Session** : SESSION_20260423_023327_quality_audit_refactor
**Scope** : Backend Python (FastAPI), Frontend Next.js 16 / React 19.2, packages/pdf-engine TS, packages/editor, apps/admin, deploy/ (nginx + systemd)
**Phase** : 3 — Synthèse Master Report

---

## Executive summary

| Axe | État | Commentaire |
|-----|------|-------------|
| Sécurité | CRITIQUE | 15/16 routes PDF sans auth, JWT en sessionStorage, admin panel sans credentials, SSRF image wildcard, encrypt fake |
| Data integrity | CRITIQUE | add_page / delete_page / rotate_page / reorder_pages / encrypt sont des no-ops silencieux qui retournent `success: true` |
| API honesty | CRITIQUE | 21 endpoints Python retournent `200` avec placeholders au lieu de `501 Not Implemented` |
| Type safety TS | MOYEN | 0 `@ts-ignore`, 36 `as any`, 67 `as unknown as`. Majoritairement dans apps/mobile et lib/api.ts |
| Tests | FAIBLE | Python ~4%, TS ~21%, 0 test sur les 18 routes `/api/pdf/*`, 0 test sur editor stores |
| Architecture | MOYEN | God files (lib/api.ts 1595 LOC, editor-canvas 1281, page.tsx 1183), Zustand bien séparé |
| Observabilité | FAIBLE | 121 `console.log` + 235 `print()` en prod, logger structuré sous-exploité |
| Config / Infra | MOYEN | Limits upload incohérentes (100 vs 500 MB), pas de MemoryMax systemd, pas de logrotate |

---

## Inventaire complet des findings (dédupliqué)

Légende priorité :
- **P0** : Bug prod actif, data integrity violation, security breach exploitable — à corriger avant prochain deploy
- **P1** : Risque élevé court-terme — à corriger cette semaine
- **P2** : Dette moyenne — sprint suivant
- **P3** : Nice-to-have — backlog

Légende effort : **XS** < 30min · **S** 1-2h · **M** 0.5-1j · **L** 2-3j · **XL** > 3j

| ID | Category | Priority | Effort | File(s) | Short description | Source reports |
|----|----------|----------|--------|---------|-------------------|----------------|
| P0-01 | Security | P0 | M | apps/web/src/app/api/pdf/*.ts (16 routes) | 15 routes PDF sans `requireSession()`, middleware exclut `/api/*`. DDoS, service gratuit de chiffrement, Playwright exploitable | 02, 13, 15 |
| P0-02 | Security | P0 | M | apps/web/src/lib/api.ts L17-38 | JWT Better-Auth stocké dans `sessionStorage` (lisible par XSS). 6 consommateurs directs | 15 |
| P0-03 | Security | P0 | S | apps/admin/src/lib/api.ts L275-293 | Admin panel envoie les requêtes Python sans `credentials: 'include'` ni Bearer → soit API ouverte, soit panel cassé | 15 |
| P0-04 | Data integrity | P0 | M | app/services/document_service.py L543 + app/core/pdf_engine.py L497 | `reorder_pages()` no-op silencieux — retourne `success:true` mais PDF inchangé | 01, 03, 10 |
| P0-05 | Data integrity | P0 | M | app/services/document_service.py L402/452/499 + app/core/pdf_engine.py L231-280 | `add_page`/`delete_page`/`rotate_page` no-ops silencieux — retournent `success:true` sans modifier le PDF | 01, 10 |
| P0-06 | Security / Data integrity | P0 | S ou M | app/api/v1/security.py L247-349 | `encrypt_document` retourne `encrypted:true` sans jamais chiffrer (faux sentiment de sécurité, risque légal) | 02, 10 |
| P0-07 | API honesty | P0 | S | app/api/v1/text.py, layers.py, bookmarks.py, forms.py, annotations.py | 21 endpoints retournent `200 success:true` avec `placeholder-uuid` au lieu de `501 Not Implemented` | 01, 10 |
| P0-08 | Bug actif | P0 | XS | app/services/document_service.py L281 | `session.pdf_doc.extract_image(image_xref)` — méthode inexistante sur `LegacyDocumentProxy` → AttributeError 500 | 03, 10 |
| P0-09 | Security | P0 | XS | apps/web/next.config.ts L98-103 | `images.remotePatterns: hostname: "**"` → SSRF via `/_next/image?url=...` (métadonnées AWS, services internes) | 02, 14, 15 |
| P0-10 | Config | P0 | XS | app/config.py vs deploy/.env.production.example vs deploy/nginx.conf | `MAX_UPLOAD_SIZE_MB` incohérent : 100MB code / 500MB env-example / 500M nginx → cap PDF-bomb contourné | 14 |
| P1-11 | Security | P1 | XS | apps/admin/src/proxy.ts L26-51 | Middleware admin ne vérifie pas `user.role === 'super_admin'` → tout user authentifié accède au panel | 15 |
| P1-12 | Security | P1 | S | 10 route handlers apps/web/src/app/api/pdf/* | `Content-Disposition: attachment; filename="${file.name}"` sans sanitization → HTTP header injection | 13, 15 |
| P1-13 | Security | P1 | XS | apps/web/src/lib/auth.ts L40 + apps/admin/src/lib/auth.ts L34 | `requireEmailVerification: false` en prod malgré commentaire "Set to true in production" | 15 |
| P1-14 | Reliability | P1 | S | apps/web/src/app/api/pdf/* (13 routes) | Aucune limite de taille upload — parse est à 100MB, les 13 autres acceptent N'IMPORTE QUELLE taille | 13, 15 |
| P1-15 | Observabilité / Security | P1 | S | 16 routes apps/web/src/app/api/pdf/* | `console.error` au lieu de `serverLogger` → logs non-structurés, stack traces leakables | 13 |
| P1-16 | Reliability | P1 | M | packages/pdf-engine/src/render/text-renderer.ts L50-98 | Fallback silencieux Helvetica quand `originalFont` défini et `FONT_EMBED_CUSTOM_ENABLED=false`. 3 tests RED | 11 |
| P1-17 | Data integrity | P1 | S | packages/pdf-engine/src/render/flatten.ts | `flattenAnnotations()` = no-op (uniquement `markDirty`). Annotations natives non supprimées | 11 |
| P1-18 | Security | P1 | M | app/middleware/auth.py + app/api/v1/embed.py | `python-jose` unmaintained (last release 2022). Migration vers `PyJWT>=2.8.0` | 02 |
| P1-19 | Observabilité | P1 | M | app/api/v1/*.py (235 occurrences) | `print()` au lieu de logger structuré dans les routeurs FastAPI (invisible dans Sentry/Datadog) | 01, 10 |
| P1-20 | Observabilité | P1 | S | apps/web/src/app/editor/[id]/page.tsx + editor-canvas.tsx (43 logs) | 43 `console.log` actifs en prod exposant IDs éléments, contenu texte édité | 01, 12 |
| P1-21 | Performance | P1 | S | app/core/pdf_engine.py L202-229 + app/services/document_service.py L86 | `upload_document` appelle `pikepdf.open` N fois (N = page_count) au lieu d'une passe unique | 10 |
| P1-22 | Performance / Reliability | P1 | S | app/api/v1/storage.py L233, L1101 | `pikepdf.open()` synchrone dans `async def` → bloque event loop sous charge | 10 |
| P1-23 | Config / Infra | P1 | XS | deploy/nginx.conf L59, L206 | `ssl_protocols TLSv1.2 TLSv1.3;` — TLSv1.2 autorisé (BEAST, LUCKY13, downgrade) | 14 |
| P1-24 | Config / Headers | P1 | XS | deploy/nginx.conf L64, L211 | HSTS incohérent nginx (2 ans, sans includeSubDomains/preload) vs Next.js (1 an, avec includeSubDomains) | 02, 14 |
| P1-25 | Config / Headers | P1 | XS | deploy/nginx.conf L69, L216 | `X-XSS-Protection "1; mode=block"` déprécié et dangereux (IE legacy) | 02, 14 |
| P1-26 | Config / Infra | P1 | S | deploy/systemd/*.service | Aucun `MemoryMax`/`MemoryHigh` → OOM-kill VPS entier sur PDF-bomb 5000 pages | 14 |
| P1-27 | Config / Infra | P1 | S | deploy/systemd/*.service | `Restart=always` sans `StartLimitBurst` → busy-loop CPU infini si service crashe au boot | 14 |
| P1-28 | Architecture | P1 | M | apps/web/src/lib/api.ts (1595 LOC) | God file couvrant 8 domaines (storage, documents, billing, organization, quota, folders, plans, auth) | 01, 12 |
| P1-29 | Architecture | P1 | L | apps/web/src/components/editor/editor-canvas.tsx (1281 LOC) | God Component 11 responsabilités (Fabric init, history, overlay render, conversion, zoom, keyboard) | 01, 12 |
| P1-30 | Architecture | P1 | M | apps/web/src/app/editor/[id]/page.tsx (1183 LOC, dette #1) | God page avec 15 console.log + 7 `as unknown as` + collaboration WebSocket TODO | 01, 12 |
| P1-31 | Architecture | P1 | S | apps/web/src/lib/api.ts → editor-canvas, use-document, use-document-save, page.tsx | `getAuthToken()` importé dans 4 fichiers de présentation — viole DIP | 12, 15 |
| P1-32 | API design | P1 | M | app/api/v1/router.py L100-104 | `security.py` marqué `# DEPRECATED` mais toujours routé → endpoints encrypt/decrypt actifs mais no-op | 10 |
| P2-33 | Dead code | P2 | XS | app/services/security_audit_service.py | 0 import externe — service entier mort (singleton jamais consommé) | 03, 10 |
| P2-34 | Dead code | P2 | XS | app/services/job_service.py L203 | 0 import externe — singleton jamais consommé (jobs.py accède directement à celery_app) | 03, 10 |
| P2-35 | Dead code | P2 | XS | app/core/pdf_engine.py L282-417 | `copy_page()` et `resize_page()` no-ops avec 0 caller | 03, 10 |
| P2-36 | Dead code | P2 | XS | app/core/preview.py + app/core/pdf_engine.py | Modules marqués `# DEPRECATED`, callers limités (document_service, export_tasks) | 01, 03 |
| P2-37 | Dead code | P2 | XS | app/config.py L129-149 | 6 env vars non lues : stripe_starter_price_id, stripe_pro_price_id, 4× scw_* | 03, 10 |
| P2-38 | Dead code / Feature | P2 | S | apps/web/src/lib/feature-flags.ts + packages/editor/src/hooks/use-embedded-fonts.ts | `use-embedded-fonts` fetch `/api/pdf/fonts/:id` Next.js qui n'existe pas. Feature end-to-end brisée | 03 |
| P2-39 | API surface | P2 | S | packages/pdf-engine/src/index.ts | 20 exports publics sans consommateur dans apps/ ni packages/editor | 03, 11 |
| P2-40 | Security | P2 | M | apps/web/next.config.ts | CSP avec `unsafe-inline` + `unsafe-eval` → XSS script protection neutralisée | 02 |
| P2-41 | Security | P2 | M | apps/web/src/app/api/pdf/* (14 routes) | Validation Zod absente sur 14/16 routes — `JSON.parse as ElementOperation[]` sans validation | 13, 15 |
| P2-42 | Security | P2 | M | Routes compute-heavy (convert, encrypt, merge, split) | Aucun rate limiting applicatif (`@upstash/ratelimit` non utilisé) | 13 |
| P2-43 | Security | P2 | XS | apps/web/src/app/api/v1/embed/validate-key/route.ts L3 | `NEXT_PUBLIC_API_URL` utilisé côté serveur au lieu de `PYTHON_BACKEND_URL` | 15 |
| P2-44 | Architecture | P2 | S | app/repositories/document_repo.py L716-733 | `_embed_sessions` initialisé via `hasattr()` guard → race condition thread-unsafe | 10 |
| P2-45 | Architecture | P2 | S | app/services/document_service.py L167-170 | `get_document(include_elements=False)` mute `page.elements` en place sur la session live → race condition | 10 |
| P2-46 | Performance | P2 | S | app/core/pdf_engine.py L123-145 | `get_document()` ré-ouvre pikepdf à chaque appel (pas de cache `page_count`, `is_encrypted`) | 10 |
| P2-47 | Architecture | P2 | S | apps/web/middleware.ts | Doit être renommé `proxy.ts` (convention Next.js 16). Logique correcte mais mauvais fichier | 12 |
| P2-48 | React | P2 | M | apps/web/next.config.ts | React Compiler non explicitement configuré (défaut Next.js 16). 68 `useMemo`/`useCallback` potentiellement redondants | 12 |
| P2-49 | React | P2 | S | apps/web/src/components/editor/editor-canvas.tsx | Memory leak Fabric : `loadPage` sans AbortController sur fetch PDF + `renderElementsOverlay` promise non annulable | 12 |
| P2-50 | React | P2 | M | apps/web/src/hooks/use-document.ts | Fetch manuel `useState+useEffect+fetch` au lieu de TanStack Query (déjà dans le bundle) | 12 |
| P2-51 | React | P2 | S | apps/web/src/components/editor/editor-canvas.tsx | Historique undo/redo : snapshots JSON multi-Mo dans `useState` au lieu de `useRef` | 12 |
| P2-52 | React | P2 | L | apps/web/src/app/editor/[id]/page.tsx L329-341 | Callbacks collab WebSocket onElement* = uniquement `console.log + // TODO` → faux sentiment de collab active | 12 |
| P2-53 | Type safety | P2 | M | apps/web/src/app/editor/[id]/page.tsx L82-101 | 7 `as unknown as Record<string, unknown>` dans `convertToApiElement` — contrat ElementCreateRequest trop large | 01, 12 |
| P2-54 | Performance TS | P2 | M | packages/pdf-engine/src/parse/text-extractor.ts L461 + image-extractor.ts L554 | `extractTextBlocks`/`extractImages` traitent pages séquentiellement (O(n)) au lieu de `Promise.all` | 11 |
| P2-55 | Architecture TS | P2 | M | packages/pdf-engine/src/parse/form-extractor.ts | 2 extracteurs incompatibles (`extractFormFields` pdf-lib vs `extractFormFieldElements` pdfjs) dans 1 fichier | 11 |
| P2-56 | Memory safety | P2 | S | packages/pdf-engine/src/preview/renderer.ts L146, L158 | `as any` + `Buffer.from(data.buffer, ...)` → ArrayBuffer potentiellement détaché (bug RT-11) | 11 |
| P2-57 | Type safety | P2 | S | packages/pdf-engine/src/parse/form-extractor.ts L154, L212, L292, L301 | 4 `as unknown as` sur API privée pdf-lib — extractibles en interfaces locales | 11 |
| P2-58 | Architecture | P2 | S | app/services/document_service.py (multiple) | Imports dynamiques (`from app.middleware.error_handler import ...`) dans blocs try/except | 10 |
| P2-59 | Architecture | P2 | S | app/services/document_service.py | `session.pdf_doc.xxx` bypass l'engine — violation encapsulation couche service/engine | 10 |
| P2-60 | Config / Infra | P2 | S | deploy/systemd/gigapdf-web.service + gigapdf-admin.service | Pas de `ProtectSystem=strict` ni `ReadWritePaths` → Server Component compromis lit `/opt/gigapdf/.env` | 14 |
| P2-61 | Config / Infra | P2 | S | deploy/systemd + /var/log/gigapdf/ | Pas de logrotate configuré → logs en append illimité saturent le FS | 14 |
| P2-62 | Config | P2 | XS | app/config.py | `embed_jwt_secret` défaut `""` en prod → aucune erreur au démarrage si oubli de config | 14 |
| P3-63 | Dead code | P3 | XS | packages/pdf-engine/src/index.ts | Symboles `webToPdf`, `pdfToWeb`, `scaleRect`, `normalizeFontName`, `resolveStandardFont`, etc. exportés mais usage interne uniquement | 03, 11 |
| P3-64 | API design | P3 | XS | packages/pdf-engine/src/parse/text-extractor.ts + image-extractor.ts | `extractTextBlocks`/`extractImages`/`extractFormFields` documentés publics mais absents de `index.ts` | 11 |
| P3-65 | Architecture | P3 | S | packages/pdf-engine/src/engine/document-handle.ts L17 | `_pdfDoc` exposé dans interface publique → consommateurs bypass `markDirty` | 11 |
| P3-66 | DRY | P3 | S | packages/pdf-engine/src/parse/parser.ts L154, L226 | `buildPageObject` et `buildPageObjectSafe` dupliquent la construction du PageObject | 11 |
| P3-67 | DRY | P3 | M | packages/pdf-engine/src/parse/image-extractor.ts (700 LOC) | `extractImageElements` et `extractImages` dupliquent la boucle d'opérateurs (CTM, setGState) | 11 |
| P3-68 | Memory safety | P3 | XS | packages/pdf-engine/src/engine/document-handle.ts L50 | `new Uint8Array(source.buffer, ...)` sur Buffer Node.js → ArrayBuffer potentiellement pooled | 11 |
| P3-69 | Tests | P3 | M | apps/web/src/hooks/use-document.ts | Hook critique sans test (mapping API → DocumentObject avec 15+ casts) | 04, 12 |
| P3-70 | Dead code | P3 | XS | apps/mobile/src/services/EXAMPLE_SCREEN.tsx + examples.ts | 1177 LOC d'exemples en production dans /services/ | 01 |
| P3-71 | API cleanup | P3 | S | apps/web/src/app/api/pdf/parse-from-s3 vs apps/web/src/app/api/v1/embed/validate-key | 3 formats de réponse JSON coexistent (`{success,data,error}` vs `{authenticated,user}` vs `{valid}`) | 13 |
| P3-72 | Test fixtures | P3 | S | packages/pdf-engine/__tests__/fixtures/with-forms.pdf | Fixture avec 6 widgets attendue à 4 champs → 3 tests form-extractor RED | 11 |
| P3-73 | Type hints Python | P3 | S | app/repositories/document_repo.py L602-646 | `push_history()`, `_cleanup_old_sessions()` sans annotations de retour → mypy/pyright limités | 10 |
| P3-74 | Error handling Python | P3 | S | app/services/document_service.py L304 | `except Exception as e` masque AttributeError (bug extract_image) en 404 NotFound | 10 |

**Total findings (dédupliqués)** : 74 items
- P0 : 10
- P1 : 22
- P2 : 30
- P3 : 12

---

## Chiffres clés cumulés

| Métrique | Valeur |
|----------|--------|
| Routes `/api/pdf/*` sans auth | 16 / 18 (89%) |
| Endpoints Python retournant 200 mensongers | 21 |
| Opérations PDF silencieusement no-op | 5 (reorder, add_page, delete_page, rotate_page, encrypt) |
| Tests couvrant routes `/api/pdf/*` | 0 / 18 |
| Tests couvrant document_service.py | 0 |
| Tests couvrant endpoints FastAPI (total) | 4 / 186 (2.2%) |
| `console.log` / `print()` en prod | 121 TS + 235 Python |
| Fichiers > 500 LOC (TS/TSX) | 24 |
| Fichiers > 500 LOC (Python) | 20+ |
| `as unknown as` | 67 |
| `as any` | 36 |
| `@ts-ignore` | 0 (positif) |

---

## Relation findings ↔ zones orchestration (pour Phase 5)

| Zone | Scope fichiers | Findings concernés |
|------|----------------|-------------------|
| A | `apps/web/src/app/api/pdf/*` + `apps/web/src/lib/api/` (nouveau) | P0-01, P1-12, P1-14, P1-15, P2-41, P2-42 |
| B | `app/services/`, `app/core/`, `app/api/v1/` | P0-04, P0-05, P0-06, P0-07, P0-08, P1-19, P1-21, P1-22, P1-32, P2-33 à P2-37, P2-44 à P2-46 |
| C | `apps/web/middleware.ts`, `apps/web/next.config.ts`, `deploy/nginx.conf`, `deploy/systemd/*` | P0-09, P0-10, P1-11, P1-13, P1-18, P1-23, P1-24, P1-25, P1-26, P1-27, P2-40, P2-47, P2-60, P2-61, P2-62 |
| D | `packages/pdf-engine/src/` | P1-16, P1-17, P2-39, P2-54, P2-55, P2-56, P2-57, P3-63 à P3-68, P3-72 |
| E | `apps/web/src/components/editor/`, `apps/web/src/lib/api.ts`, `apps/web/src/hooks/`, `apps/web/src/app/editor/[id]/page.tsx`, `apps/admin/src/` | P0-02, P0-03, P1-20, P1-28, P1-29, P1-30, P1-31, P2-48 à P2-53, P2-58, P2-59, P3-69 |

---

## Suite

→ Voir `REFACTORING_ROADMAP.md` pour le top-15 actionnable immédiatement (batches parallèles).
→ Voir `FUTURE_BACKLOG.md` pour les P2/P3 regroupés par thème (sprint suivant).
