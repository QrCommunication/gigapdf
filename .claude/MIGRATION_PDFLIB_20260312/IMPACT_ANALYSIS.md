# RAPPORT D'IMPACT - Migration PyMuPDF vers pdf-lib

**SESSION**: MIGRATION_PDFLIB_20260312
**Date**: 2026-03-12
**Risque global**: CRITIQUE (9/10)
**Fichiers directement impactes**: 15 fichiers Python + 1 `__init__.py`
**Fichiers indirectement impactes**: 12+ fichiers Python, 30+ fichiers TypeScript
**Tests existants couvrant ces fichiers**: 0 (AUCUN test unitaire/integration specifique)

---

## 1. GRAPHE DE DEPENDANCES

```
                        +-------------------+
                        |   import fitz     |
                        | (PyMuPDF global)  |
                        +-------------------+
                                |
          +---------------------+---------------------+
          |                     |                     |
    +-----v------+       +-----v------+        +-----v------+
    | pdf_engine |       |   parser   |        |  renderer  |
    | (PDFEngine)|       | (PDFParser)|        |(PDFRenderer|
    +-----+------+       +-----+------+        +-----+------+
          |                     |                     |
          |              +------v------+              |
          |              |    ocr.py   |              |
          |              |(OCRProcessor|              |
          |              +------+------+              |
          |                     |                     |
    +-----v------+       +-----v------+        +-----v------+
    | preview.py |       |            |        |            |
    |(PreviewGen)|       |            |        |            |
    +-----+------+       |            |        |            |
          |              |            |        |            |
    +-----v--------------v------------v--------v-----+
    |              document_service.py                |
    |         (DocumentService - ORCHESTRATEUR)       |
    +---------+------------+----------+---------+----+
              |            |          |         |
    +---------v--+  +------v---+  +--v------+  |
    |document_   |  |redis_    |  |element_ |  |
    |repo.py     |  |document_ |  |service  |  |
    |(Sessions)  |  |repo.py   |  |         |  |
    +-----+------+  +------+---+  +----+----+  |
          |                |           |        |
    +-----v----------------v-----------v--------v------+
    |                  API LAYER (FastAPI)              |
    +--------------------------------------------------+
    |                                                   |
    |  documents.py  pages.py  elements.py  export.py  |
    |  merge_split.py  security.py  storage.py         |
    |                                                   |
    +--+----+----+----+----+---+----+----+---+---------+
       |    |    |    |    |   |    |    |   |
    +--v----v----v----v----v---v----v----v---v----------+
    |             CELERY TASKS                          |
    |  processing_tasks.py  export_tasks.py             |
    |  ocr_tasks.py                                     |
    +--------------------------------------------------+
                         |
    +--------------------v-----------------------------+
    |            FRONTEND CONSUMERS                     |
    |  packages/api/  (TypeScript API client)           |
    |  apps/web/     (Next.js)                          |
    |  apps/admin/   (Next.js)                          |
    |  apps/mobile/  (Expo/React Native)                |
    +--------------------------------------------------+
```

---

## 2. FICHIERS DIRECTEMENT IMPACTES (import fitz)

| Fichier | Lignes | Utilisation PyMuPDF | Criticite |
|---------|--------|---------------------|-----------|
| `app/core/pdf_engine.py` | 474 | Moteur principal: open, save, pages, metadata, encryption | CRITIQUE |
| `app/core/parser.py` | 909 | Parsing complet: text, images, shapes, annotations, forms, bookmarks, layers, embedded files | CRITIQUE |
| `app/core/renderer.py` | 538 | Ecriture: text, images, shapes, annotations, forms, redactions | CRITIQUE |
| `app/core/preview.py` | 280 | Rendu pages -> images (PNG/JPEG/WebP/SVG), thumbnails, OCR image | HAUTE |
| `app/core/ocr.py` | 256 | OCR Tesseract: render page -> pixmap, process, add text layer | HAUTE |
| `app/services/document_service.py` | 541 | Orchestration: import fitz direct (type hints) | HAUTE |
| `app/repositories/document_repo.py` | 632 | Session management: fitz.Document storage, serialization | HAUTE |
| `app/repositories/redis_document_repo.py` | 592 | Redis persistence: fitz.open(stream=), tobytes() | HAUTE |
| `app/api/v1/merge_split.py` | 460 | Merge/Split: fitz.open(), insert_pdf() | MOYENNE |
| `app/api/v1/security.py` | 749 | Encryption/Permissions: fitz constants (PDF_PERM_*, PDF_ENCRYPT_*) | MOYENNE |
| `app/tasks/processing_tasks.py` | 209 | Celery merge/split: fitz.open(), insert_pdf(), get_toc() | MOYENNE |
| `app/tasks/export_tasks.py` | 525 | Export multi-format: fitz.open(), get_text(), get_pixmap(), find_tables() | HAUTE |
| `app/tasks/ocr_tasks.py` | 86 | OCR task: utilise ocr_processor + session.pdf_doc | MOYENNE |
| `app/core/__init__.py` | 19 | Re-exports: PDFEngine, PDFParser, PDFRenderer, PreviewGenerator | BASSE |

### Fichiers supplementaires indirectement lies (via document_sessions/document_service)

| Fichier | Impact |
|---------|--------|
| `app/api/v1/documents.py` | Utilise document_service (upload, download, preview) |
| `app/api/v1/pages.py` | Utilise document_service (page CRUD, rotation, reorder) |
| `app/api/v1/export.py` | Utilise document_sessions (export initiation) |
| `app/api/v1/storage.py` | Utilise pdf_engine + document_sessions (save/load persistent) |
| `app/services/element_service.py` | Utilise PDFRenderer + document_sessions (CRUD elements) |
| `app/services/history_service.py` | Utilise document_sessions (undo/redo) |
| `app/dependencies.py` | Injection document_sessions, DocumentService |
| `app/main.py` | Cleanup document_sessions on shutdown |
| `tests/conftest.py` | Fixtures document_sessions |

---

## 3. API ENDPOINTS IMPACTES

Source: `app/api/v1/router.py` -- 20 sub-routers montes.

### Endpoints directement dependants de PyMuPDF

| Route | Methode | Fichier | Impact |
|-------|---------|---------|--------|
| `/documents/upload` | POST | documents.py | CRITIQUE - fitz ouvre le PDF |
| `/documents/{id}` | GET | documents.py | HAUTE - scene graph depuis fitz |
| `/documents/{id}/download` | GET | documents.py | CRITIQUE - fitz.tobytes() |
| `/documents/{id}/pages` | GET/POST/DELETE | pages.py | HAUTE - fitz page operations |
| `/documents/{id}/pages/{n}/preview` | GET | pages.py | HAUTE - fitz.get_pixmap() |
| `/documents/{id}/pages/{n}/images/{xref}` | GET | pages.py | HAUTE - fitz.extract_image() |
| `/documents/{id}/pages/{n}/rotate` | POST | pages.py | MOYENNE - fitz.set_rotation() |
| `/documents/{id}/pages/reorder` | POST | pages.py | MOYENNE - fitz.select() |
| `/documents/{id}/elements/*` | ALL | elements.py | HAUTE - PDFRenderer write ops |
| `/documents/{id}/text/*` | ALL | text.py | HAUTE - fitz text operations |
| `/documents/{id}/annotations/*` | ALL | annotations.py | MOYENNE - PDFRenderer annots |
| `/documents/{id}/forms/*` | ALL | forms.py | MOYENNE - PDFRenderer forms |
| `/documents/{id}/layers/*` | ALL | layers.py | BASSE - fitz layer_ui_configs |
| `/documents/{id}/bookmarks/*` | ALL | bookmarks.py | BASSE - fitz get_toc() |
| `/documents/merge` | POST | merge_split.py | HAUTE - fitz.open() + insert_pdf() |
| `/documents/{id}/split` | POST | merge_split.py | HAUTE - fitz.open() + insert_pdf() |
| `/documents/{id}/security/encrypt` | POST | security.py | HAUTE - fitz encryption constants |
| `/documents/{id}/security/decrypt` | POST | security.py | HAUTE - fitz.authenticate() |
| `/documents/{id}/security/permissions` | GET | security.py | MOYENNE - fitz.permissions |
| `/documents/{id}/exports` | POST | export.py | HAUTE - fitz multi-format export |
| `/documents/{id}/ocr` | POST | via jobs | MOYENNE - Tesseract + fitz pixmap |
| `/storage/documents/{id}/save` | POST | storage.py | HAUTE - pdf_engine + sessions |
| `/storage/documents/{id}/load` | POST | storage.py | HAUTE - fitz.open() from storage |

**Total: 23+ endpoints directement impactes**

---

## 4. WEBSOCKET EVENTS IMPACTES

Source: `app/api/websocket.py`

Le WebSocket ne depend **PAS directement** de PyMuPDF. Il utilise `collaboration_service` qui gere les locks et curseurs sans toucher au moteur PDF.

| Event | Impact |
|-------|--------|
| `connect` / `disconnect` | AUCUN - Auth seulement |
| `join_document` / `leave_document` | AUCUN - Collaboration seulement |
| `element_lock` / `element_unlock` | AUCUN - Lock management seulement |
| `cursor_move` | AUCUN - Position broadcast seulement |
| `document_update` | INDIRECT - Broadcast les changements faits via API REST |

**Verdict**: Le WebSocket n'est PAS impacte par la migration. Les events `document:updated` continueront a fonctionner car ils ne font que relayer des notifications.

---

## 5. CELERY TASKS IMPACTEES

| Task | Fichier | Utilisation fitz | Criticite |
|------|---------|-----------------|-----------|
| `merge_documents` | processing_tasks.py | `fitz.open()`, `insert_pdf()`, `PDFParser` | HAUTE |
| `split_document` | processing_tasks.py | `fitz.open()`, `insert_pdf()`, `get_toc()`, `PDFParser` | HAUTE |
| `export_document` | export_tasks.py | `fitz.open()`, `get_pixmap()`, `get_text()`, `find_tables()` | CRITIQUE |
| `process_ocr` | ocr_tasks.py | `ocr_processor.process_document()` (indirect fitz) | MOYENNE |
| `cleanup_expired_exports` | export_tasks.py | AUCUN | AUCUN |

**Detail critique -- export_tasks.py**: Ce fichier utilise des fonctions PyMuPDF avancees qui n'ont PAS d'equivalent direct en pdf-lib:
- `page.get_text("html")` -- Extraction HTML native
- `page.get_text("dict")` -- Extraction structuree avec blocs/lignes/spans
- `page.find_tables()` -- Detection de tableaux
- `page.get_pixmap(clip=rect, dpi=150)` -- Rendu partiel de page
- Export DOCX avec preservation de la mise en forme

---

## 6. FRONTEND CONSUMERS

### packages/api/ (TypeScript API client)

| Service | Fichier | Endpoints concernes |
|---------|---------|---------------------|
| `documentService` | services/documents.ts | upload, get, download, delete |
| `exportService` | services/exports.ts | createExport, downloadExport |
| `ocrService` | services/ocr.ts | startOcr, applyOcrResults |
| `pageService` | services/pages.ts | preview, rotate, reorder |
| `uploadService` | services/uploads.ts | upload PDF |
| `storageService` | services/storage.ts | save, load persistent |

### apps/web/ (Next.js)

| Composant/Hook | Usage PDF |
|----------------|-----------|
| `editor/editor-canvas.tsx` | Rendu PDF, detection modifications |
| `editor/editor-toolbar.tsx` | Font/taille pour texte PDF |
| `hooks/use-document.ts` | Chargement document |
| `hooks/use-document-save.ts` | Sauvegarde document |
| `hooks/use-collaboration.ts` | Collaboration temps reel |

### apps/admin/ (Next.js)

Usage indirect via les endpoints `/admin/` -- pas de manipulation PDF directe.

### apps/mobile/ (Expo)

| Service | Usage PDF |
|---------|-----------|
| `services/documents.ts` | Upload/download PDF |
| `services/pdf-editor.ts` | Edition PDF via API |
| `services/pages.ts` | Pages operations |
| `components/pdf/PDFViewer.tsx` | Affichage PDF |

**Verdict frontend**: Les consumers frontend ne sont PAS directement impactes car ils appellent l'API REST. Tant que les contrats API (request/response schemas) restent identiques, aucune modification frontend n'est necessaire.

**ATTENTION CRITIQUE**: Si la migration change les formats de reponse (ex: structure du scene graph, format des previews, encodage des images), TOUS les consumers frontend seront casses.

---

## 7. INVENTAIRE DES FONCTIONS PyMuPDF UTILISEES

### Classes et types fitz utilises

| Element fitz | Fichiers | Equivalent pdf-lib |
|-------------|----------|-------------------|
| `fitz.Document` | 8 fichiers | `PDFDocument` |
| `fitz.Page` | 6 fichiers | `PDFPage` |
| `fitz.Rect` | 4 fichiers | Rectangle custom |
| `fitz.Point` | 3 fichiers | Point custom |
| `fitz.Matrix` | 2 fichiers | Pas d'equivalent direct |
| `fitz.Widget` | 1 fichier | Form field API differente |
| `fitz.Annot` | 1 fichier | Annotation API differente |

### Fonctions fitz critiques SANS equivalent pdf-lib

| Fonction | Usage | Difficulte migration |
|----------|-------|---------------------|
| `page.get_pixmap()` | Rendu page -> image raster | IMPOSSIBLE en pdf-lib (pas de rendu) |
| `page.get_text("rawdict")` | Extraction texte structuree | PARTIEL (pdf-lib ne parse pas le texte) |
| `page.get_text("html")` | Extraction HTML | IMPOSSIBLE en pdf-lib |
| `page.get_text("dict")` | Extraction blocs/spans | IMPOSSIBLE en pdf-lib |
| `page.get_drawings()` | Extraction dessins vectoriels | IMPOSSIBLE en pdf-lib |
| `page.get_images()` | Liste des images embedees | Possible mais API differente |
| `page.get_image_rects()` | Position des images | Non supporte nativement |
| `page.get_svg_image()` | Export SVG | IMPOSSIBLE en pdf-lib |
| `page.get_links()` | Extraction des liens | Possible mais API differente |
| `page.annots()` | Iteration annotations | Possible mais API differente |
| `page.widgets()` | Iteration form fields | Possible mais API differente |
| `doc.extract_image(xref)` | Extraction image par xref | Possible mais API differente |
| `doc.get_toc()` | Table des matieres | Possible (outlines) |
| `doc.layer_ui_configs()` | Configuration des layers | Non supporte nativement |
| `doc.embfile_names()` | Fichiers embarques | Possible mais API differente |
| `doc.insert_pdf()` | Merge de PDFs | `copyPages()` |
| `doc.select()` | Reorder pages | Pas d'equivalent direct |
| `page.set_rotation()` | Rotation de page | `page.setRotation()` |
| `page.add_redact_annot()` + `apply_redactions()` | Suppression contenu | IMPOSSIBLE en pdf-lib |
| `doc.authenticate()` | Dechiffrement PDF | Non supporte |
| `doc.is_encrypted` | Detection chiffrement | Non supporte |
| `page.find_tables()` | Detection tableaux | IMPOSSIBLE en pdf-lib |
| `page.insert_text()` | Insertion texte | `page.drawText()` (API differente) |
| `page.insert_image()` | Insertion image | `page.drawImage()` (API differente) |
| `page.new_shape()` | Creation formes | `page.drawLine/Rect/Ellipse()` |
| `fitz.open(stream=bytes)` | Ouverture depuis bytes | `PDFDocument.load(bytes)` |
| `doc.tobytes()` | Serialisation | `pdfDoc.save()` |

---

## 8. RISQUES IDENTIFIES

### CRITICAL

1. **RENDU RASTER IMPOSSIBLE**: pdf-lib est une bibliotheque de CREATION/MODIFICATION de PDF, elle ne fait PAS de rendu. Toute fonctionnalite de preview (thumbnails, export PNG/JPEG/WebP/SVG) ne peut PAS etre portee vers pdf-lib. Il faudra une alternative (pdf.js, pdfium, sharp+ghostscript, ou garder PyMuPDF pour le rendu uniquement).

2. **EXTRACTION DE TEXTE IMPOSSIBLE**: pdf-lib ne peut PAS extraire le texte existant d'un PDF. Le parser entier (`parser.py`) qui extrait texte, styles, positions, liens, etc. ne peut PAS fonctionner avec pdf-lib. Il faudra une alternative (pdf.js, pdfium, ou garder PyMuPDF pour le parsing).

3. **OCR CASSE**: L'OCR depend de `page.get_pixmap()` pour rasteriser la page avant Tesseract. pdf-lib ne peut pas rasteriser.

4. **EXPORT MULTI-FORMAT CASSE**: Les exports TXT, HTML, DOCX, XLSX dependent tous de `page.get_text()` et `page.get_pixmap()`.

5. **ZERO TESTS EXISTANTS**: Aucun test unitaire ou d'integration ne couvre les 12 fichiers cibles. Pas de filet de securite pour detecter les regressions.

6. **ENCRYPTION NON SUPPORTEE**: pdf-lib ne supporte ni le chiffrement ni le dechiffrement de PDF. Les endpoints `/security/*` seront entierement casses.

### WARNING

7. **CHANGEMENT DE STACK**: Migration Python -> TypeScript implique un changement fondamental d'architecture. Le backend FastAPI/Python devra soit:
   - Appeler un service TypeScript/Node.js separe (micro-service)
   - Remplacer le backend Python par Node.js
   - Utiliser une FFI ou un subprocess

8. **ANNOTATIONS ET FORMULAIRES**: Les APIs de pdf-lib pour les annotations et form fields sont significativement differentes de celles de PyMuPDF. Beaucoup de mapping de types sera necessaire.

9. **SESSIONS EN MEMOIRE**: `DocumentSession` stocke `fitz.Document` en memoire. La migration vers pdf-lib changera le type de l'objet document stocke, impactant le serialization/deserialization avec Redis.

10. **MERGE/SPLIT API DIFFERENTE**: `doc.insert_pdf()` de PyMuPDF est tres flexible. `copyPages()` de pdf-lib a des limitations differentes.

### INFO

11. **REDACTIONS NON SUPPORTEES**: pdf-lib ne supporte pas les redactions (`add_redact_annot` + `apply_redactions`). Les operations `update_text` et `update_image` du renderer qui effacent d'abord l'ancien contenu ne fonctionneront pas.

12. **LAYERS NON SUPPORTES**: `doc.layer_ui_configs()` n'a pas d'equivalent en pdf-lib.

13. **TABLE DETECTION**: `page.find_tables()` est specifique a PyMuPDF et n'a pas d'equivalent en pdf-lib ni dans la plupart des alternatives.

---

## 9. CALCUL DU SCORE DE RISQUE

| Facteur | Score |
|---------|-------|
| Base: Modification 12+ fichiers, multi-domaine | 7 |
| +2: Pas de tests existants | +2 |
| +2: Donnees de production (sessions actives, documents) | +2 |
| +1: Modification de contrat API (scene graph structure) | +1 |
| +1: Plus de 10 fichiers impactes | +1 |
| +2: Certaines fonctions IMPOSSIBLES a migrer (rendu, parsing) | +2 |
| +1: Dependances externes impactees (Celery workers) | +1 |
| **TOTAL** | **16** -> CRITIQUE |

Score plafonne a **9+/10 = CRITIQUE**

---

## 10. RECOMMANDATIONS

### STOP -- La migration "PyMuPDF -> pdf-lib" pure est IMPOSSIBLE

pdf-lib est une bibliotheque de **creation** de PDF, pas de **lecture/rendu**. Elle ne peut pas remplacer PyMuPDF pour:
- Le parsing de contenu existant (texte, images, dessins)
- Le rendu en images (previews, thumbnails)
- L'OCR (necessite rasterisation)
- L'export multi-format
- Le chiffrement/dechiffrement
- L'extraction de tableaux

### ALTERNATIVES VIABLES

#### Option A: Architecture Hybride (RECOMMANDEE)
- **pdf-lib** (TypeScript): Creation, modification, merge, split, metadata, formulaires
- **PyMuPDF** (Python, garde): Parsing, rendu, OCR, export, extraction
- Architecture: Le backend Python garde les operations de lecture, un service Node.js gere les operations d'ecriture

#### Option B: Migration vers pdf.js + pdf-lib
- **pdf.js** (TypeScript): Parsing et rendu (mode canvas)
- **pdf-lib** (TypeScript): Creation et modification
- Impact: Necessite un runtime Node.js avec canvas support (node-canvas)
- Limitation: pdf.js cote serveur a des limitations de rendu

#### Option C: Migration vers pdfium (via pdfium-render ou pdfjs-dist)
- **pdfium** (C/C++ via bindings): Parsing complet + rendu
- **pdf-lib** (TypeScript): Operations d'ecriture
- Impact: Plus complexe a deployer, mais couverture fonctionnelle complete

#### Option D: Rester sur PyMuPDF
- Garder l'architecture actuelle
- Ajouter des tests avant toute evolution
- Considerer une couche d'abstraction pour faciliter une migration future

### ORDRE DE MIGRATION (si Option A choisie)

```
Phase 0: Tests                          [2 semaines]
  - Ecrire les tests pour les 12 fichiers AVANT migration
  - Coverage minimum 80% sur le core/

Phase 1: Abstraction Layer              [1 semaine]
  - Creer une interface abstraite IPDFEngine
  - Wrapper PyMuPDF derriere cette interface
  - Pas de changement de comportement

Phase 2: Operations d'ecriture          [2 semaines]
  - Migrer pdf_engine.py (operations CRUD pages)
  - Migrer renderer.py (ajout texte, images, shapes)
  - Garder PyMuPDF pour la lecture

Phase 3: Merge/Split                    [1 semaine]
  - Migrer merge_split.py
  - Migrer processing_tasks.py

Phase 4: Metadata & Security            [1 semaine]
  - Migrer les operations de metadata
  - Evaluer alternatives pour encryption (qpdf?)

Phase 5: Validation                     [1 semaine]
  - Tests de regression complets
  - Tests de performance compare
  - Validation des contrats API (pas de breaking change)
```

### CHECKLIST PRE-MIGRATION (OBLIGATOIRE)

- [ ] Ecrire des tests unitaires pour `PDFEngine` (toutes les methodes)
- [ ] Ecrire des tests unitaires pour `PDFParser` (tous les extracteurs)
- [ ] Ecrire des tests unitaires pour `PDFRenderer` (toutes les operations)
- [ ] Ecrire des tests unitaires pour `PreviewGenerator`
- [ ] Ecrire des tests d'integration pour les endpoints merge/split
- [ ] Ecrire des tests d'integration pour les endpoints security
- [ ] Ecrire des tests d'integration pour les exports multi-format
- [ ] Documenter les contrats API (request/response schemas) en snapshot
- [ ] Preparer un rollback strategy (feature flag backend)
- [ ] Confirmer que la decision d'architecture a ete prise (Option A/B/C/D)

### CHECKLIST POST-MIGRATION

- [ ] Tous les tests existants passent
- [ ] Tous les nouveaux tests passent
- [ ] Aucun breaking change dans les reponses API
- [ ] Performance comparable (benchmark upload/download/preview)
- [ ] Celery tasks fonctionnelles (merge, split, export, OCR)
- [ ] Frontend valide (web, admin, mobile)
- [ ] Monitoring/alerting en place

---

## 11. FICHIERS A SURVEILLER PENDANT LA MIGRATION

### Fichiers qui NE DOIVENT PAS changer de contrat API

| Fichier | Raison |
|---------|--------|
| `app/schemas/responses/` | Schemas de reponse API consommes par le frontend |
| `app/models/document.py` | DocumentObject (scene graph) utilise partout |
| `app/models/elements.py` | Types d'elements (Text, Image, Shape, etc.) |
| `app/models/page.py` | PageObject, Dimensions, MediaBox |
| `app/models/bookmarks.py` | BookmarkObject |
| `app/models/layers.py` | LayerObject |

### Fichiers qui peuvent changer librement

| Fichier | Raison |
|---------|--------|
| `app/core/*.py` | Implementation interne, pas d'API publique directe |
| `app/utils/coordinates.py` | Helpers de conversion de coordonnees |

---

## 12. RESUME EXECUTIF

La migration "PyMuPDF -> pdf-lib" telle qu'envisagee est **techniquement impossible** comme remplacement 1:1. pdf-lib ne couvre qu'environ **30%** des fonctionnalites actuellement fournies par PyMuPDF (creation/modification seulement, pas de parsing/rendu).

**Recommandation**: Abandonner l'idee d'un remplacement complet et choisir une architecture hybride (Option A) ou rester sur PyMuPDF avec une couche d'abstraction.

**Pre-requis absolu avant toute action**: Ecrire les tests manquants. Le risque de regression est maximal avec 0% de couverture sur le code critique.
