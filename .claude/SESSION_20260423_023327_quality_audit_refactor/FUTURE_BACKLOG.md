# GigaPDF — Future Backlog (P2 / P3)

**Date** : 2026-04-22
**Phase** : 3 — Items hors top-15, groupés par thème pour les sprints suivants

Items P0 et P1 critiques → voir `REFACTORING_ROADMAP.md`.

---

## Thème 1 — Architecture frontend (déconstruire les God files)

**Total effort** : ~5-7 jours

- **P1-28 — Découpage `apps/web/src/lib/api.ts`** (1595 LOC → 8 modules)
  Stratégie : `lib/api/{client,auth,storage,documents,billing,organization,quota}.ts` + `index.ts` re-exports sélectifs. Migration progressive : nouveau consommateurs dans nouveaux modules, anciens callers migrés par PR.

- **P1-29 — Découpage `editor-canvas.tsx`** (1281 LOC → composant + 5 hooks)
  Extraction : `useFabricCanvas`, `useCanvasHistory`, `usePdfBackground`, `renderElementsOverlay.ts` (fonction pure), `createFabricObject.ts`, `fabricToElement.ts`.

- **P1-30 — Découpage `editor/[id]/page.tsx`** (1183 LOC → page + 4 hooks + 2 composants)
  Extraction : `useEditorKeyboard`, `useEditorCollaboration`, `useEditorExport`, `useEditorName`, `EditorHeader`, `EditorLayout`.

- **P1-31 — Supprimer `getAuthToken()` des composants de présentation**
  Consommé directement dans 4 fichiers (editor-canvas, use-document, use-document-save, page.tsx) — viole DIP. Migrer vers client HTTP centralisé ou hook `useAuthenticatedFetch`.

- **P2-53 — Typer `ElementCreateRequest` avec union discriminée**
  7× `as unknown as Record<string, unknown>` dans `convertToApiElement` masquent un contrat API trop large. Définir `type ElementCreateRequest = | { type: 'text', style: TextElementStyle, ... } | ...`.

- **P2-47 — Renommer `middleware.ts` → `proxy.ts`** (convention Next.js 16)

- **P2-48 — Audit React Compiler**
  Vérifier activation (`NEXT_COMPILER_DEBUG=1`). Si actif : supprimer `useMemo`/`useCallback` redondants (68 occurrences dans editor). Si inactif : activer explicitement + corriger mutations dans render body.

- **P2-50 — Migration `use-document` vers TanStack Query**
  Remplacer `fetch + useState + useEffect` manuel par `useQuery`. TanStack déjà dans le bundle via `optimizePackageImports`. Apporte cache, dedup, staleTime.

- **P2-51 — Historique undo/redo en `useRef`** (pas `useState`)
  Snapshots JSON multi-Mo dans state React → React DevTools les sérialise, passent par le réconciliateur à chaque render. Pattern : `useRef<{stack,index}>` + `setHistoryVersion(v=>v+1)` pour forcer re-render uniquement quand `canUndo/canRedo` changent.

- **P2-52 — Collaboration WebSocket : implémenter ou masquer**
  Callbacks `onElementCreate/Update/Delete` contiennent uniquement `console.log + // TODO`. Soit implémenter (application des événements distants sur le canvas Fabric via l'handle impératif), soit masquer l'indicateur Wifi/WifiOff.

- **P2-13 — Server Component wrapper pour `editor/[id]/page.tsx`**
  Précharger métadonnées (nom, page count) côté serveur pour éviter le flash d'éditeur vide + vérifier accès document avant SSR.

---

## Thème 2 — Sécurité / Hardening

**Total effort** : ~3-4 jours

- **P1-18 — Migration `python-jose` → `PyJWT`**
  `python-jose` unmaintained (last release 2022). Dépendance `ecdsa@0.19.2` a des vulnérabilités historiques timing attack. Remplacer dans `app/middleware/auth.py` et `app/api/v1/embed.py` par `PyJWT>=2.8.0` (mêmes algorithmes HMAC/RSA).

- **P1-32 — `security.py` DEPRECATED mais toujours routé**
  `app/api/v1/router.py:100-104` inclut encore le router. Option A (rapide) : toutes les routes non-fonctionnelles → 501. Option B : implémenter via pikepdf (voir P0-06). Option C : supprimer le module et ses routes.

- **P2-40 — CSP sans `unsafe-eval` + `unsafe-inline`**
  `apps/web/next.config.ts` actuellement : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. Migrer vers `nonce-{random}` généré par `proxy.ts` + `strict-dynamic`. PDF.js WASM peut utiliser `worker-src blob:` + nonce.

- **P2-42 — Rate limiting applicatif sur routes compute-lourdes**
  Aucune route n'implémente de rate limiting (protection uniquement nginx niveau réseau). Intégrer `@upstash/ratelimit` ou Redis-based dans wrapper `requireSession()`. Priorité : `/convert` (Playwright), `/encrypt`, `/merge`, `/split` (10-20 req/min par user max).

- **P2-43 — `NEXT_PUBLIC_API_URL` utilisé côté serveur**
  `validate-key/route.ts:3` utilise une variable publique côté serveur. Remplacer par `PYTHON_BACKEND_URL` (pattern correct dans `parse-from-s3/route.ts`).

- **P2-62 — `embed_jwt_secret` défaut `""` en prod**
  Actuellement silent fallback. Ajouter validation au démarrage : si `app_env == "production"` et `embed_jwt_secret == ""`, lever `ValueError`.

- **P2-60 — Systemd `ProtectSystem=strict` sur services Next.js**
  `gigapdf-web.service` + `gigapdf-admin.service` n'ont que `NoNewPrivileges` + `PrivateTmp`. Ajouter `ProtectSystem=strict`, `ProtectHome=true`, `ReadWritePaths=...` pour empêcher lecture de `/opt/gigapdf/.env` si Server Component compromis.

---

## Thème 3 — Data integrity & API design Python

**Total effort** : ~3 jours

- **P2-44 — `_embed_sessions` race condition**
  `hasattr(self, '_embed_sessions')` guard dans `document_repo.py:716-733`. Initialiser dans `__init__` + supprimer le guard.

- **P2-45 — `get_document(include_elements=False)` mute la session live**
  Ligne 167-170 : `for page in doc.pages: page.elements = []` sur l'objet de la session partagée. Si 2 requêtes arrivent simultanément, l'une peut effacer les éléments pour l'autre. Créer une copie de `DocumentObject` avant mutation.

- **P2-46 — `PDFEngine.get_document()` cache**
  Ouvre pikepdf à chaque appel pour compter les pages. Stocker `page_count` et `is_encrypted` dans `_documents` (tuple) ou cache `functools.lru_cache` sur `(document_id, hash(pdf_bytes[:64]))`.

- **P2-58 — Imports dynamiques dans try/except**
  Pattern `from app.middleware.error_handler import NotFoundError` répété dans ~10 blocs `except` de `document_service.py`. Remonter en tête de fichier.

- **P2-59 — Accès direct `session.pdf_doc` depuis services**
  `reorder_pages`, `get_page_preview`, `security.py` bypass `self.engine`. Règle : les services passent UNIQUEMENT par `self.engine` pour accéder aux bytes PDF. Les sessions sont opaques.

- **P3-73 — Type hints manquants `document_repo.py`**
  `push_history()`, `_cleanup_old_sessions()`, `_serialize_history()` sans annotations de retour. Ajouter pour résilience mypy/pyright.

- **P3-74 — `except Exception` trop large dans `get_page_image`**
  Masque `AttributeError` (bug P0-08) en 404 NotFound. Remplacer par `except (ValueError, KeyError, IndexError)` typé ou supprimer l'endpoint (voir P0-08).

---

## Thème 4 — pdf-engine TS : API surface + perf + DRY

**Total effort** : ~3 jours

- **P2-39 — Nettoyer `packages/pdf-engine/src/index.ts`**
  20 exports publics sans consommateur : `webToPdf`, `pdfToWeb`, `scaleRect`, `normalizeFontName`, `resolveStandardFont`, `isStandardFont`, `mapPdfFontToStandard`, `engineLogger`, `closeDocument`, `getPageDimensions`, `setCanvasPoolSize`, `destroyCanvasPool`, `setPlaywrightPoolSize`, `destroyPlaywrightPool`, `parseMetadata`, `parseBookmarks`, `updateFormFieldValue`, `clearFontCache`, `rgbToHex`, `normalizeColor`. Retirer de l'export public (implémentations conservées pour usage interne).

- **P2-54 — Parallélisation extraction pages**
  `extractTextBlocks` et `extractImages` traitent pages séquentiellement (`for...of + await`). Sur PDF 100 pages → 10× plus lent que nécessaire. Refactor : extraire `processPage(pdfDoc, pgNum)` + `await Promise.all(pages.map(processPage))`.

- **P2-55 — Séparer `form-extractor.ts`**
  2 extracteurs incompatibles dans le même fichier : `extractFormFields` (pdf-lib, type local `FormField`) et `extractFormFieldElements` (pdfjs, type `@giga-pdf/types.FormFieldElement`). Séparer en `form-extractor-legacy.ts` + `form-extractor.ts`.

- **P2-56 — `as any` + ArrayBuffer détaché dans `preview/renderer.ts`**
  L146 `(page.objs as any).get(imageName)` + L158 `Buffer.from(data.buffer, ...)`. Risque : pdfjs détruit la page, ArrayBuffer détaché avant appel sharp → crash. Définir interface `PdfjsImageData` + copier immédiatement (`Buffer.from(data)`).

- **P2-57 — 4 `as unknown as` dans `form-extractor.ts`**
  Nécessaires pour accéder aux internals privés pdf-lib mais extractibles en interfaces locales (`PdfLibDict`, `AcroField`, `Widget`). Améliore lisibilité et type safety.

- **P3-63 — Les 20 exports publics superflus** (détail ci-dessus, P2-39)

- **P3-64 — `extractTextBlocks` et `extractImages` : clarifier statut**
  Documentés comme APIs publiques pour le Fabric.js editor mais absents de `index.ts`. Décision : exposer via barrel ou marquer `@internal`.

- **P3-65 — `_pdfDoc` exposé dans interface publique**
  Consommateurs peuvent bypass `markDirty`. Séparer `PDFDocumentHandle` (public) et `PDFDocumentHandleInternal` (interne au package).

- **P3-66 — DRY `buildPageObject` vs `buildPageObjectSafe`**
  Duplication ~50 LOC dans `parser.ts`. Extraire `assemblePageObject(pageNumber, viewport, elements, options)`.

- **P3-67 — DRY `image-extractor.ts`** (700 LOC)
  `extractImageElements` et `extractImages` partagent la boucle d'opérateurs (CTM, setGState). Extraire `scanOperatorsForImages(ops, pageHeight): ImageHit[]`.

- **P3-68 — `new Uint8Array(source.buffer, ...)` sur Buffer Node.js**
  Pattern à 3 endroits (document-handle.ts:50, parser.ts, renderer.ts:27). Risque théorique sur buffers poolés Node.js. Remplacer par `Uint8Array.from(source)` pour copie défensive.

- **P3-72 — Fixture `with-forms.pdf` : 6 widgets au lieu de 4 attendus**
  3 tests `form-extractor.test.ts` RED. Solution préférée : recréer fixture avec 4 champs simples sans radio groups.

---

## Thème 5 — Dead code cleanup Python

**Total effort** : ~1 jour

- **P2-33 — Supprimer `app/services/security_audit_service.py`** (0 import externe)
  Alternatif : brancher dans `api_key_auth.py` et `security.py` pour logger événements sécurité.

- **P2-34 — Supprimer `app/services/job_service.py`** (0 import externe)
  Alternatif : brancher dans `api/v1/jobs.py` à la place de l'accès direct `celery_app`.

- **P2-35 — Supprimer `PDFEngine.copy_page()` et `resize_page()`**
  0 caller externe (no-ops). Confirmer via `grep -rn` avant suppression.

- **P2-36 — Supprimer modules `# DEPRECATED`**
  `app/core/preview.py` (PreviewGenerator) : callers limités (`export_tasks.py`, `document_service.py`). Décision : supprimer + migrer callers vers TS engine OU garder temporairement mais désactiver l'endpoint `GET /pages/{n}/preview`.
  `app/core/pdf_engine.py` : en cours de remplacement par opérations pikepdf directes (voir P0-04/P0-05).
  `app/services/document_service.py` (NB : il y a 2 fichiers du même nom — le principal est actif, un autre est DEPRECATED).

- **P2-37 — Supprimer 6 env vars non lues** dans `app/config.py`
  `stripe_starter_price_id`, `stripe_pro_price_id`, `scw_access_key`, `scw_secret_key`, `scw_default_organization_id`, `scw_default_project_id`. Les vars SCW sont lues par le CLI scw, pas Python — documenter dans `infrastructure/README.md`.

---

## Thème 6 — Feature fonts : dead end à fixer ou désactiver

**Total effort** : ~0.5 jour

- **P2-38 — Feature fonts end-to-end brisée**
  `packages/editor/src/hooks/use-embedded-fonts.ts` fetch `/api/pdf/fonts/:documentId` (Next.js) qui **n'existe pas**. La route Python `/api/v1/pdf/fonts/*` existe mais aucun proxy Next.js ne la relaie.
  `apps/web/src/lib/feature-flags.ts` exporte `FONT_DYNAMIC_LOAD_ENABLED` mais 0 import (use-embedded-fonts lit directement `process.env`).
  Décision : créer le route handler Next.js `apps/web/src/app/api/pdf/fonts/[documentId]/route.ts` qui proxie vers Python, OU désactiver la feature explicitement (flag false par défaut + warning au montage).

---

## Thème 7 — Tests et couverture

**Total effort** : ~5-7 jours

### P0 — Tests manquants sur le chemin de bug récent

- **Couverture `document_service.py`** (0 test actuel, bug `LegacyDocumentProxy` récent)
  Créer `tests/integration/api/test_storage_load.py` avec vrai PDF pikepdf (pas MagicMock sur pdf_engine). Code fourni dans rapport 04. Couvre exactement le scénario du bug prod.
  Créer `tests/integration/api/test_documents.py` pour `POST /api/v1/documents`.
  Créer `tests/unit/services/test_document_service.py` avec vrai `PDFEngine()` + vrais `LegacyDocumentProxy` — ne pas stub-iser `app.core.pdf_engine`.

- **Remplacer stubs globaux dans `tests/unit/services/conftest.py`**
  Actuellement `app.core.pdf_engine` est stubbé avec `MagicMock()`. C'est ce qui a caché le bug `LegacyDocumentProxy[i]` (MagicMock accepte `__getitem__` silencieusement). Règle : si un service utilise `pdf_engine`, le test DOIT instancier un vrai `PDFEngine()` ou utiliser un vrai `LegacyDocumentProxy`.

### P1 — Round-trip tests routes `/api/pdf/*`

Les 6 routes critiques sans test (apps/web/src/app/api/pdf/) :
- `POST /api/pdf/save` — round-trip PDF bytes valide
- `POST /api/pdf/apply-elements` — texte ajouté → re-parser → texte présent
- `POST /api/pdf/parse` — page_count matche
- `POST /api/pdf/merge` — page_count = somme des inputs
- `POST /api/pdf/split` — N PDFs résultants valides
- `POST /api/pdf/encrypt` — `pikepdf.open(result)` lève `PasswordError`

Tests à écrire en Vitest + `fetch` mock ou Next.js test adapter.

### P2 — Couverture stores et actions `packages/editor`

25 fichiers source, 0 test (sauf `use-embedded-fonts.test.tsx`). Priorités :
- `document-store.ts` (store Zustand principal)
- `history-store.ts`
- `element-actions.ts` / `page-actions.ts`
- `persistence-middleware.ts` / `sync-middleware.ts`

Tests Vitest + `@testing-library/react` + `renderHook`.

### P3 — Couverture hooks web

- **P3-69 — `apps/web/src/hooks/use-document.ts` sans test**
  Mapping API → `DocumentObject` avec 15+ casts `as unknown`. Créer `use-document.test.ts` avec MSW (`msw` déjà envisageable).

### P2 — Couverture Python routers

Ordre de priorité :
1. `document_service.py` + `storage.py` (P0 ci-dessus)
2. `document_repo.py` (désérialisation Redis + LegacyDocumentProxy)
3. `quota_service.py` (garde-fou avant upload)
4. `element_service.py` (logique métier principale éditeur)
5. `history_service.py` (undo/redo)

---

## Thème 8 — Mobile (apps/mobile) — hors scope prioritaire

- `apps/mobile/src/services/pdf-editor.ts` : 37× `: any` dans signatures
- `apps/mobile/src/services/auth.ts` : 816 LOC, 20× `console.log`, dette #2
- `apps/mobile/src/stores/authStore.ts` : God Object
- `apps/mobile/app/(tabs)/index.tsx` : 1455 LOC
- `apps/mobile/src/services/EXAMPLE_SCREEN.tsx` + `examples.ts` : 1177 LOC de code d'exemple en production (**P3-70**, à supprimer)

Mobile a sa propre dette significative — devrait faire l'objet d'une session dédiée après stabilisation web.

---

## Thème 9 — Duplication de nommage / structure

**Total effort** : ~0.5 jour (documentation, pas refactor)

- Plusieurs fichiers portent le même nom dans différents packages :
  - `documents.ts` : `packages/api/src/services/`, `apps/mobile/src/services/`, `app/api/v1/documents.py`
  - `elements.ts` : `packages/api/src/services/`, `apps/mobile/src/services/`
  - `auth.ts` : `apps/mobile/src/services/`, `apps/mobile/src/lib/auth-client.ts`
  - `utils.ts`, `types.ts` : multiple packages

- Action : documenter dans un README `PACKAGES.md` qui est la source de vérité pour chaque domaine, conventions de nommage par package.

---

## Thème 10 — Sentry / observabilité avancée

- **P2 — `sentry_environment` défaut `"production"`** → risque de tagger des erreurs dev/staging en prod si DSN copié sans changer env. Recommander `default=""` et forcer config explicite.

- **P2 — `sentry_dsn` vide par défaut** : comportement sécurisé (désactivé), à documenter explicitement dans `.env.example`.

- **P2 — Ajouter logs structurés Python avec `structlog`** (après migration `print()` → logger) : format JSON + request_id + user_id injectés via middleware.

---

## Résumé effort par thème

| Thème | Nombre items | Effort estimé |
|-------|-------------|---------------|
| 1. Architecture frontend | 11 | 5-7 jours |
| 2. Sécurité / Hardening | 7 | 3-4 jours |
| 3. Data integrity Python | 7 | 3 jours |
| 4. pdf-engine TS | 11 | 3 jours |
| 5. Dead code Python | 5 | 1 jour |
| 6. Feature fonts | 1 | 0.5 jour |
| 7. Tests & couverture | ~15 tests | 5-7 jours |
| 8. Mobile | 5+ | Session dédiée |
| 9. Duplication nommage | 1 doc | 0.5 jour |
| 10. Sentry observabilité | 3 | 1 jour |
| **Total hors mobile** | **61 items** | **~20-25 jours** |

---

## Note sur la priorisation future

Les items ci-dessus sont réels mais non-bloquants. Recommandation d'ordre :

1. **Sprint suivant (après top-15)** : Thèmes 2 (sécurité restante) + 3 (data integrity Python) + 5 (dead code) — corrections simples, gains rapides
2. **Sprint +1** : Thème 7 (tests) — investissement long terme indispensable
3. **Sprint +2** : Thème 1 (architecture frontend) — demande du temps mais améliore radicalement la maintenabilité
4. **Sprint +3** : Thème 4 (pdf-engine) — perf + API surface
5. **Session dédiée** : Thème 8 (mobile)
