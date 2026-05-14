# Impact Analysis — Migration Python → TS Intégrale

## Blockers critiques

### B1 — Session Redis `pdf_engine._documents`
- `storage.py` appelle `pdf_engine.save_document(document_id)` pour récupérer les bytes avant upload S3
- `document_repo.py` + `redis_document_repo.py` reconstruisent `LegacyDocumentProxy` depuis bytes Redis
- `pdf_engine._documents[document_id]` est le registre central

**Solution choisie (Option A)** :
- Le frontend garde les bytes PDF en mémoire après `/api/pdf/parse`
- `api.saveDocument()` envoie les bytes en multipart
- `storage.py` POST /documents accepte `file: UploadFile` au lieu de lire session

### B2 — Export DOCX/XLSX Python
- `export_tasks.py` utilise `python-docx` et `openpyxl`
- Routes TS `/api/pdf/convert` ne supporte pas encore ces formats

**Solution** : garder Python pour DOCX/XLSX/OCR. Le plan migre seulement les opérations PDF natives.

## Phase préliminaire ajoutée

**Phase B' (nouveau)** — Adapter storage.py pour recevoir bytes depuis frontend
- `/app/api/v1/storage.py`: `save_document` et `create_version` acceptent `UploadFile` multipart
- Plus de dépendance à `pdf_engine._documents`

## Contract breaking change

| Avant | Après |
|-------|-------|
| `/api/v1/documents/upload` → snake_case | `/api/pdf/parse` → camelCase |
| Response.data.document_id | Response.data.documentId |
| Response 201 | Response 200 |

Frontend `api.uploadDocument()` doit être adapté au nouveau contract.

## Packages Python à garder

- pdfplumber (OCR pipeline)
- Pillow (OCR, image manipulation)
- pytesseract (OCR reste Python)
- python-docx, openpyxl (export DOCX/XLSX)

## Packages Python à supprimer après migration

- pikepdf (après merge/split migrés)
- pdf2image (orphelin déjà)
- pypdf (orphelin déjà)

## Ordre validé

1. Phase A (parser TS) — EN COURS
2. **Phase B' (nouveau)** : adapter storage.py pour bytes upload
3. Phase B : intégration frontend
4. Phase C : operations TS
5. Phase D : Python cleanup (parser.py, preview.py, pdf_engine.py suppression)
6. Phase E : Celery cleanup
7. Phase F : tests
8. Phase G : deploy
