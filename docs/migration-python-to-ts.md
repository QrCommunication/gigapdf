# Migration Python → TypeScript PDF Engine

## Contexte

GigaPDF utilise deux paths parallèles pour le traitement PDF :

- **Path Python (legacy)** : FastAPI + PyMuPDF (fitz, AGPL) → remplacé par des shims pikepdf/pdfplumber pendant la migration
- **Path TypeScript (actif)** : `packages/pdf-engine` (pdf-lib, MIT) appelé via les routes Next.js `/api/pdf/*`

L'objectif est d'éliminer complètement le path Python pour le traitement PDF et de supprimer la dépendance AGPL (PyMuPDF/fitz). **PyMuPDF n'est plus dans `requirements.txt`** — il n'est présent que via `try/import fitz` avec fallback `fitz = None`. Les quatre fichiers qui tentent encore de l'importer s'exécutent donc sans le module mais contiennent du code mort (appels à `fitz.*` jamais atteints si fitz est None).

---

## État actuel (snapshot 2026-04-21)

### Python legacy — fichiers à supprimer progressivement

| Fichier | Lignes | Statut | Consommateurs actifs | Équivalent TS |
|---------|--------|--------|----------------------|---------------|
| `app/core/renderer.py` | 147 | No-op complet — toutes méthodes sont des stubs avec `logger.warning` | `app/services/element_service.py` (import en tête), `app/services/document_service.py` (import dans `download_document`) | `packages/pdf-engine/src/render/` (addText, addImage, addShape, addAnnotation, addFormField, flattenAnnotations, flattenForms) |
| `app/core/pdf_engine.py` | 546 | Shim actif — `PDFEngine` stocke les bytes bruts via pikepdf ; `LegacyDocumentProxy` / `LegacyPageProxy` utilisés partout | `app/repositories/document_repo.py`, `app/repositories/redis_document_repo.py`, `app/api/v1/merge_split.py`, `app/api/v1/storage.py`, `app/core/__init__.py`, `app/services/document_service.py` | `packages/pdf-engine/src/engine/` (openDocument, saveDocument, getMetadata, addPage, deletePage, movePage, rotatePage) |
| `app/core/parser.py` | 299 | Shim — retourne des scene graphs minimaux ; pdfplumber pour métadonnées de fallback | `app/services/document_service.py`, `app/api/v1/merge_split.py`, `app/tasks/processing_tasks.py` | `packages/pdf-engine/src/parse/` (parseDocument, parsePage, parseMetadata, parseBookmarks) |
| `app/core/preview.py` | 278 | Shim — pdfplumber + Pillow (pas fitz) ; OCR pipeline fonctionne toujours | `app/services/document_service.py`, `app/tasks/export_tasks.py` | `packages/pdf-engine/src/preview/` (renderPage, renderThumbnail, extractImage) |
| `app/services/document_service.py` | 545 | Actif — coordonne upload/parse/session ; appelle renderer (no-op), engine (pikepdf) | Routes `/api/v1/documents/*`, `/api/v1/pages/*`, `/api/v1/storage/*`, `/api/v1/embed/*` | Pas d'équivalent TS direct — logique métier à migrer vers Next.js handlers |
| `app/services/element_service.py` | 487 | Actif — CRUD éléments ; importe PDFRenderer (no-op) en tête de fichier | Routes `/api/v1/documents/{id}/elements/*` | Next.js `/api/pdf/apply-elements` (route TS active) |
| `app/api/v1/merge_split.py` | 472 | Actif mais CASSÉ — appelle `fitz.open()` qui renvoie None crash | Routes Python `/api/v1/documents/merge` et `/{id}/split` | `packages/pdf-engine/src/merge-split/` (mergePDFs, splitPDF, splitAt) — **TS complet** |
| `app/api/v1/security.py` | 763 | Actif mais CASSÉ — utilise `fitz.PDF_PERM_*` (constantes fitz None) | Routes Python `/{id}/security/encrypt`, `/decrypt`, `/permissions` | `packages/pdf-engine/src/encrypt/` (encryptPDF, decryptPDF, getPermissions) — **TS complet** (note : encryptPDF est V1 stub, chiffrement réel via qpdf à implémenter) |
| `app/tasks/export_tasks.py` | 530 | Actif — Celery task ; `export_document` appelle `fitz.open()` (crash si fitz None pour fallback depuis bytes) + PreviewGenerator pour images | Déclenché via `/api/v1/documents/{id}/export` | `packages/pdf-engine/src/preview/` pour images, `src/parse/text-extractor.ts` pour txt/html ; DOCX/XLSX nécessitent encore Python |
| `app/tasks/processing_tasks.py` | 218 | Actif mais CASSÉ — `merge_documents` et `split_document` Celery tasks utilisent `fitz.open()` | Appelé indirectement (tâches legacy) | `packages/pdf-engine/src/merge-split/` |

### TypeScript actif (`packages/pdf-engine/`)

| Module | Fonctionnalités couvertes | Gaps / Limitations |
|--------|---------------------------|-------------------|
| `engine/` | openDocument, saveDocument, closeDocument, getMetadata, setMetadata, getPageDimensions, addPage, deletePage, movePage, rotatePage, copyPage, resizePage | Aucun gap fonctionnel |
| `parse/` | parseDocument, parsePage, parseMetadata, parseBookmarks, extractText, extractImages, extractAnnotations, extractForms, extractDrawings | Aucun gap |
| `render/` | addText, updateText, addImage, updateImage, addShape, addAnnotation, addFormField, updateFormFieldValue, deleteElementArea, flattenAnnotations, flattenForms, redaction | Aucun gap |
| `merge-split/` | mergePDFs, splitPDF, splitAt | Aucun gap |
| `forms/` | getFormFields, fillForm, flattenForm | Aucun gap |
| `encrypt/` | encryptPDF (V1 stub sans chiffrement objet réel), decryptPDF, getPermissions, setPermissions | **GAP** : `encryptPDF` re-sauvegarde le PDF sans chiffrer les objets PDF. Chiffrement AES-128/256 réel nécessite intégration qpdf (spawn subprocess) |
| `preview/` | renderPage, renderThumbnail, renderAllThumbnails, extractImage | Requiert canvas (node-canvas) — dépendance native |
| `convert/` | htmlToPDF, urlToPDF, urlToPDFSafe | Requiert Playwright — dépendance lourde |
| `utils/` | color, coordinates, font-map, page-range, logger | Complet |

### Routes Next.js actives (TS)

| Route | Fichier | Fonctionnel |
|-------|---------|-------------|
| `POST /api/pdf/apply-elements` | `apps/web/src/app/api/pdf/apply-elements/route.ts` | Oui — addText, addImage, addShape, addAnnotation, addFormField, deleteElementArea |
| `POST /api/pdf/save` | `apps/web/src/app/api/pdf/save/route.ts` | Oui — openDocument + saveDocument |

---

## Analyse des Gaps et Risques

### CASSÉ EN PRODUCTION MAINTENANT

Les routes suivantes sont **silencieusement cassées** depuis la suppression de fitz :

1. **`POST /api/v1/documents/merge`** — `fitz.open()` retourne None → `merged_pdf = None` → crash à `None.insert_pdf()`
2. **`POST /api/v1/documents/{id}/split`** — même problème avec `fitz.open()`
3. **`POST /api/v1/documents/{id}/security/encrypt`** — `fitz.PDF_PERM_PRINT` sur `None` → AttributeError
4. **`GET /api/v1/documents/{id}/security/permissions`** — idem pour les constantes fitz
5. **Celery tasks `merge_documents` et `split_document`** — fitz.open() crash
6. **Celery task `export_document`** (fallback depuis bytes) — si la session Redis est expirée, `fitz.open(stream=pdf_bytes)` crash

### Gaps TS réels

| Feature | Python Status | TS Status | Effort migration |
|---------|--------------|-----------|-----------------|
| Merge/Split | CASSÉ | Complet | Faible — réécrire 2 handlers FastAPI pour appeler Next.js TS |
| Encrypt/Decrypt | CASSÉ | V1 stub | Moyen — encryptPDF nécessite intégration qpdf pour chiffrement réel |
| Export images (PNG/JPEG/WebP) | Fonctionnel via pdfplumber | Complet | Faible — migrer Celery task vers appel Next.js |
| Export TXT | Fonctionnel via fitz (CASSÉ si fallback) | Complet via text-extractor | Faible |
| Export HTML | Fonctionnel via fitz (CASSÉ si fallback) | Partiel — TS parse produit du texte, pas HTML layout | Moyen |
| Export DOCX | Fonctionnel (python-docx) | **ABSENT** en TS | Élevé — nécessite lib DOCX en TS (docx npm) ou garder Python |
| Export XLSX | Fonctionnel (openpyxl) | **ABSENT** en TS | Élevé — nécessite lib XLSX en TS (exceljs) ou garder Python |
| OCR (Tesseract) | Fonctionnel (pytesseract) | **ABSENT** en TS | Élevé — garder Python pour OCR |
| Encryption réelle AES-256 | CASSÉ | GAP (stub) | Moyen — qpdf via spawn |
| Page reorder (select) | No-op / CASSÉ | Complet (movePage) | Faible |
| Metadata get/set | Fonctionnel (pikepdf) | Complet | Faible |
| Session management | Python/Redis | Python/Redis | À conserver Python |

---

## Roadmap

### Phase 1 — Urgences (Semaine 1) : Réparer les cassures silencieuses

**Priorité absolue** : les routes cassées retournent des erreurs 500 aléatoires.

- [ ] **`app/api/v1/merge_split.py`** : Réécrire les deux handlers pour appeler `mergePDFs`/`splitAt` via `httpx` vers Next.js, OU appeler directement `subprocess` + pdf-lib via un script Node.js. Variante recommandée : proxy HTTP vers `http://localhost:3000/api/pdf/merge` (route TS à créer).
- [ ] **`app/api/v1/security.py`** : Réécrire `encrypt_document` et `get_permissions` pour :
  - `encrypt` → appeler `encryptPDF` du TS engine via Next.js proxy (note : encryption stub V1, avertir l'utilisateur)
  - `get_permissions` → appeler `getPermissions` du TS engine
  - Retirer toutes les références `fitz.PDF_PERM_*` et `fitz.PDF_ENCRYPT_*`
- [ ] **`app/tasks/export_tasks.py`** : Supprimer la branche `fitz.open(stream=pdf_bytes)` (fallback cassé). La session doit exister dans Redis ou le job échoue proprement.
- [ ] **`app/tasks/processing_tasks.py`** : Marquer `merge_documents` et `split_document` comme `@deprecated`, les faire échouer proprement avec un message clair au lieu de crasher silencieusement.

### Phase 1 Quick Win : `renderer.py` est safe à supprimer

`app/core/renderer.py` est un no-op **complet** — toutes les méthodes logguent un warning et retournent sans effet. Les deux consommateurs :

1. `element_service.py` ligne 11 : `from app.core.renderer import PDFRenderer` — importé mais `PDFRenderer` est instancié dans chaque méthode, puis ses méthodes ne font rien. L'import peut être retiré sans effet fonctionnel.
2. `document_service.py` ligne 320 : `from app.core.renderer import PDFRenderer; renderer = PDFRenderer(session.pdf_doc)` puis `renderer.flatten_forms()` / `renderer.flatten_annotations()` — ces appels sont des no-ops. La fonctionnalité flatten n'est pas réellement exécutée.

**Suppression safe MAINTENANT si** : On accepte que flatten_forms/flatten_annotations restent des no-ops (déjà le cas). Le comportement utilisateur final ne change pas.

### Phase 2 — Migration routes (Semaine 1-2)

- [ ] Créer route TS `POST /api/pdf/merge` dans `apps/web/src/app/api/pdf/merge/route.ts`
- [ ] Créer route TS `POST /api/pdf/split` dans `apps/web/src/app/api/pdf/split/route.ts`
- [ ] Créer route TS `POST /api/pdf/encrypt` et `GET /api/pdf/permissions` dans `apps/web/src/app/api/pdf/security/`
- [ ] Réécrire `export_tasks.py` pour images/txt/html via appel Next.js
- [ ] Décider : DOCX/XLSX restent Python (python-docx + openpyxl) ou migrer vers TS (docx + exceljs)

### Phase 2 — Flatten réel (Semaine 2)

- [ ] Implémenter flatten_forms et flatten_annotations dans Next.js via `flattenForms`/`flattenAnnotations` du TS engine
- [ ] Relier `document_service.download_document` à la route TS `/api/pdf/apply-elements` pour les flatten

### Phase 3 — Cleanup final

- [ ] Supprimer `app/core/renderer.py` et retirer les imports dans `element_service.py` et `document_service.py`
- [ ] Supprimer `app/core/preview.py` une fois export_tasks migré
- [ ] Supprimer `app/core/parser.py` une fois les Celery tasks migrées
- [ ] Simplifier `app/core/pdf_engine.py` : garder uniquement `open_document` (pikepdf pour validation) et `save_document` (retourner bytes bruts), supprimer `LegacyDocumentProxy.select()` et les méthodes no-op
- [ ] Simplifier `app/services/document_service.py` : retirer `generate_previews`, l'accès à `session.pdf_doc` pour rendu
- [ ] Supprimer de `requirements.txt` : `pypdf`, `pdfplumber`, `python-docx` (si migré), `openpyxl` (si migré), `pdf2image`
- [ ] Garder : `pikepdf` (validation upload), `pytesseract` + `pdfplumber` + `Pillow` (OCR pipeline)
- [ ] Mettre à jour `app/core/__init__.py` : retirer les imports de `PDFRenderer`, `PDFParser`, `PreviewGenerator`

### Phase 4 — Encryption réelle

- [ ] Implémenter `encryptPDF` réel via qpdf (spawn subprocess) dans `packages/pdf-engine/src/encrypt/`
- [ ] Ou intégrer une lib npm MIT avec chiffrement objet complet (alternative : `node-qpdf2`)

---

## Blueprint par fichier

### `app/core/renderer.py` — Suppression safe

**Prérequis** : Retirer les imports et instanciations dans les 2 consommateurs.

1. `app/services/element_service.py` ligne 11 : supprimer `from app.core.renderer import PDFRenderer`
2. Dans toutes les méthodes de `ElementService` qui instancient `PDFRenderer` : supprimer les lignes `renderer = PDFRenderer(session.pdf_doc)` et `renderer.add_xxx(...)` — ces appels sont déjà des no-ops.
3. `app/services/document_service.py` lignes 320-328 : supprimer le bloc `from app.core.renderer import PDFRenderer; renderer = PDFRenderer(...); renderer.flatten_*()` — déjà no-op.
4. `app/core/__init__.py` : supprimer `from app.core.renderer import PDFRenderer`
5. Supprimer `app/core/renderer.py`

### `app/api/v1/security.py` — Réécriture (URGENT)

Remplacer les 4 usages de `fitz.*` constantes par des entiers hardcodés conformes au spec PDF (déjà calculés dans le TS engine `permissions.ts`) ou par un appel HTTP au TS engine. Architecture recommandée :

```python
# Constantes PDF spec (remplacement de fitz.PDF_PERM_*)
PDF_PERM_PRINT = 0x4       # bit 3
PDF_PERM_MODIFY = 0x8      # bit 4
PDF_PERM_COPY = 0x10       # bit 5
PDF_PERM_ANNOTATE = 0x20   # bit 6
PDF_PERM_FORM = 0x100      # bit 9
PDF_PERM_ASSEMBLE = 0x400  # bit 11
```

La logique `encrypt_document` peut utiliser ces constantes localement pour stocker `session.encryption_params`. L'application réelle du chiffrement doit appeler le TS engine au moment du `download_document`.

### `app/api/v1/merge_split.py` — Réécriture (URGENT)

Deux stratégies possibles :

**Option A (recommandée)** : Appel HTTP interne vers Next.js

```python
async def merge_documents(request, user):
    pdf_bytes_list = [await load_session_bytes(doc_id) for doc_id in request.document_ids]
    # POST multipart vers http://localhost:3000/api/pdf/merge avec les bytes + page_ranges
    result_bytes = await call_nextjs_merge(pdf_bytes_list, request.page_ranges)
    # Créer une nouvelle session avec result_bytes
```

**Option B** : Appel direct au TS engine via `@giga-pdf/pdf-engine` (si Next.js est le même process — non applicable, TS et Python sont des processes séparés).

### `app/tasks/export_tasks.py` — Migration partielle

| Format | Action |
|--------|--------|
| `png/jpeg/webp/svg` | Appeler Next.js `POST /api/pdf/render-page` (route à créer) ou utiliser pdfplumber (déjà en place, fonctionnel) |
| `txt` | Appeler TS `extractText` via Next.js |
| `html` | Appeler TS `parseDocument` ou garder Python (pdfplumber) |
| `docx` | **Garder Python** (`python-docx`) — pas d'équivalent TS suffisant |
| `xlsx` | **Garder Python** (`openpyxl`) — pas d'équivalent TS suffisant |

---

## Consommateurs par module (référence rapide)

### Qui importe `app.core.renderer` ?
- `app/services/element_service.py` (ligne 11, import en tête)
- `app/services/document_service.py` (ligne 320, import lazy dans méthode)
- `app/core/__init__.py` (ligne 11)

### Qui importe `app.core.pdf_engine` ?
- `app/core/__init__.py`
- `app/repositories/document_repo.py` (LegacyDocumentProxy, pdf_engine)
- `app/repositories/redis_document_repo.py` (LegacyDocumentProxy, pdf_engine)
- `app/services/document_service.py` (pdf_engine global)
- `app/api/v1/merge_split.py` (pdf_engine, fitz)
- `app/api/v1/storage.py` (pdf_engine, import lazy)

### Qui importe `app.core.parser` ?
- `app/core/__init__.py`
- `app/services/document_service.py`
- `app/api/v1/merge_split.py` (import lazy)
- `app/tasks/processing_tasks.py` (import lazy)

### Qui importe `app.core.preview` ?
- `app/core/__init__.py`
- `app/services/document_service.py`
- `app/tasks/export_tasks.py` (import lazy)

---

## Estimation d'effort de finalisation

| Phase | Tâches | Effort estimé | Priorité |
|-------|--------|---------------|----------|
| P1 — Réparer cassures | Réécrire security.py, merge_split.py (appels fitz), tâches Celery | 2-3 jours | CRITIQUE |
| P1 Quick Win | Supprimer renderer.py + nettoyer imports | 2 heures | Sûr maintenant |
| P2 — Routes TS merge/split/security | Créer 4 routes Next.js + proxy Python | 3-4 jours | Haute |
| P2 — Export images via TS | Migrer export_tasks images → Next.js | 2 jours | Moyenne |
| P2 — Flatten réel | Implémenter via TS engine | 1 jour | Moyenne |
| P3 — Cleanup parser/preview/pdf_engine | Simplifier après migration routes | 3-4 jours | Basse |
| P3 — Supprimer dépendances Python PDF | Retirer pypdf, pdfplumber, pdf2image | 1 jour | Basse |
| P4 — Encryption réelle qpdf | Implémenter via spawn qpdf | 3-5 jours | Basse |
| **Total** | | **~3 semaines** | |

---

## Dépendances Python à conserver après migration complète

| Package | Raison de conserver |
|---------|---------------------|
| `pikepdf` | Validation PDF à l'upload (détection chiffrement, page count) |
| `pytesseract` | OCR pipeline — aucun équivalent TS viable |
| `pdfplumber` | Fallback OCR page rendering (tant que OCR en Python) |
| `Pillow` | Manipulation images pour OCR |
| `python-docx` | Export DOCX (à décider si migrer vers TS) |
| `openpyxl` | Export XLSX (à décider si migrer vers TS) |

### Dépendances Python à supprimer après migration complète

| Package | Raison de suppression | Quand |
|---------|----------------------|-------|
| `pypdf` | Remplacé par pikepdf pour validation | Phase 3 |
| `pdf2image` | Rendu maintenant via TS engine | Phase 3 |
| `pdfplumber` | Si OCR migré vers TS, ou si fallback supprimé | Phase 4+ |

---

## Risques

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Routes merge/split retournent 500 en production | **Actuel** | Élevé | Phase 1 urgente |
| Security encrypt retourne 500 si fitz None | **Actuel** | Élevé | Phase 1 urgente |
| Export task crash si session Redis expirée | Élevé | Moyen | Nettoyer fallback fitz dans export_tasks |
| encryptPDF V1 ne chiffre pas vraiment le PDF | Actuel | Élevé (sécurité) | Documenter limitation, Phase 4 qpdf |
| Casser l'upload lors de la simplification de pdf_engine | Faible | Élevé | Tests d'intégration avant suppression |
| Preview OCR cassé si pdfplumber retiré prématurément | Faible | Moyen | Ne retirer qu'après migration OCR |
