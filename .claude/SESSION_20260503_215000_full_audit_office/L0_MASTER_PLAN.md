# L0 — Master Plan : Audit complet + Office pipeline

**Session** : SESSION_20260503_215000_full_audit_office
**Date** : 2026-05-03
**Mode** : TIER_3 (custom workflow), parallélisation choisie par l'utilisateur
**Stack Office** : libreoffice headless

## Objectifs

| # | Objectif | Phase |
|---|----------|-------|
| O1 | Audit catalogué de toutes les features ≠ éditeur texte | A |
| O2 | Reproduction + fix bug split (éléments sautent entre pages) | A→B |
| O3 | Reproduction + fix bug export (même symptôme) | A→B |
| O4 | Conversion PDF → DOCX/XLSX/PPTX via libreoffice headless | C |
| O5 | Import DOCX/XLSX/PPTX → édition → export PDF | C |

## Découpage Waves

### Wave 1 — PARALLÈLE (4 agents simultanés)

| Agent | Scope | Output | Conflit potentiel |
|-------|-------|--------|------------------|
| `audit-features` | `apps/web/src/app/api/pdf/*` + `packages/pdf-engine/src/*` (lecture) | `01_audit_features.md` | Aucun (read-only) |
| `repro-split-bug` | Créer test E2E rouge | `__tests__/render/repro-split-elements-jump.test.ts` | Aucun (fichier nouveau) |
| `repro-export-bug` | Créer test E2E rouge | `__tests__/render/repro-export-elements-jump.test.ts` | Aucun (fichier nouveau) |
| `poc-libreoffice` | Verify install, POC standalone, MAJ deploy | `packages/pdf-engine/src/convert/office-headless.ts` + deploy/redeploy.sh + test | Faible (new dir) |

### Wave 2 — SÉQUENTIEL après Wave 1 (ATTEND repros + audit)

| Agent | Scope | Output |
|-------|-------|--------|
| `fix-split` | Corriger `splitPDF` (annotations cross-page, bounds, off-by-one) | Patch + test passe |
| `fix-export` | Étendre fixes texte aux images/shapes/annotations dans `apply-elements` | Patch + test passe |

### Wave 3 — PARALLÈLE après Wave 2 (4 agents)

**Décision XLSX** : libreoffice headless ne supporte PAS PDF→XLSX (limitation découverte en POC). Choix utilisateur : implémenter via pipeline custom pdfjs + exceljs.

| Agent | Scope | Output |
|-------|-------|--------|
| `office-import-route` (3a) | POST `/api/office/upload` : multipart Office → libreoffice → retourne PDF binaire (frontend gère upload PDF via pipeline standard) | Route + tests |
| `office-export-route` (3b) | POST `/api/office/export` : `{documentId, format}`, fetch PDF via Python backend, dispatch libreoffice (docx/pptx) ou convertPdfToXlsx (xlsx) | Route + tests |
| `pdf-to-xlsx-module` (3c) | Nouveau module `packages/pdf-engine/src/convert/pdf-to-xlsx.ts` : parseDocument → extractTextBlocks → grouping Y bands + X clusters → ExcelJS workbook. Re-export via index.ts | Module + tests + exceljs dep |
| `ui-office-dialogs` (3d) | `OfficeUploadDialog` (intégré page documents) + `OfficeExportDropdown` (intégré toolbar éditeur) | 2 composants + tests RTL |

**Dette pré-existante notée** : 12 tests rouges dans `__tests__/utils/font-map.test.ts` (11) + `__tests__/parse/text-extractor.test.ts` (1). Confirmé via `git stash` que ces tests étaient déjà rouges AVANT Wave 2 — pas une régression de cette session. À reporter en backlog tech-debt.

### Wave 4 — Final

- `regression-guard` global (suite complete pdf-engine + web type-check + smoke prod)
- Deploy via `deploy/redeploy.sh`
- Validation utilisateur

## Hypothèses bug split (à infirmer/confirmer en Wave 1)

H1. Off-by-one UI vs API (user voit 5-10, on envoie 4-9)
H2. `pdf-lib copyPages` ne copie pas les annotations cross-page (link annots, form fields shared)
H3. Bounds bake stale pour éléments édités avant split → s'affichent sur la mauvaise page après bake
H4. Render preview du split UI utilise une logique différente de l'API (divergence)

## Hypothèses bug export

H5. Fixes texte récents (commit 365b3cb : top-of-glyph convention) pas étendus aux images/shapes/annotations
H6. `webToPdf` mal calibré pour pages rotées (déjà identifié comme cat. de bug dans pdf-libraries.md)
H7. Scene graph désynchronisé du PDF binary lors de save (cf. pdf-libraries.md "Architecture: PDF binary vs Scene Graph")

## Risques de la parallélisation

- Wave 1 OK (read-only + fichiers disjoints)
- Wave 2 → Wave 3 : `apply-elements` route et `pdf-engine` modules pourraient être touchés par fix-export ET office-export. **Contention probable.** Mitigation : office-export crée un nouveau module `convert/pdf-to-office.ts`, ne touche pas apply-elements.
- Risque max : si fix-split casse les imports utilisés par poc-libreoffice → résolution manuelle au merge.

## Critères de succès (par phase)

- **A** : `repro-split-elements-jump.test.ts` ROUGE + `repro-export-elements-jump.test.ts` ROUGE + audit livré
- **B** : 2 tests précédents VERTS + suite render `pdf-engine` 73/73 vert + visual diff editor OK
- **C** : POC `pdf-to-docx` + `pdf-to-xlsx` + `pdf-to-pptx` via libreoffice fonctionnel + import Office UI fonctionnel + 1 test E2E par format

## Tâches TaskList

Voir tasks `#19-#25` (audit complete) + nouvelles tâches Wave 1-4 ci-dessous.
