# Audit Features GigaPDF — 2026-05-03

> Source : agent code-explorer Wave 1 (read-only).
> Le rapport ci-dessous a été retourné comme message d'agent ; consigné ici par l'orchestrateur.

## Synthèse

| Catégorie | Nombre |
|-----------|--------|
| Routes API `/api/pdf/*` actives | 10 |
| Features mentionnées mais absentes | 4 (Compress, Watermark, OCR, Sign) |
| Modules pdf-engine | 9 domaines, ~35 fichiers source |
| Fichiers de tests présents | 16 |
| Fichiers de tests manquants | 9 |
| Dialogs UI trouvés | 4 (split, merge, encrypt, convert) |
| Routes sans dialog UI | 3 (preview, forms, metadata) |

---

## Tableau Features — Statut Complet

| Feature | Route | Engine | Tests Engine | Dialog UI | Statut |
|---------|-------|--------|--------------|-----------|--------|
| Split PDF | `POST /api/pdf/split` | `splitAt`, `splitPDF` | Oui (22) | `split-dialog.tsx` | Fonctionnel — `pageCount: null` hardcodé (P2) + bug Wave 2 (link refs) |
| Merge PDF | `POST /api/pdf/merge` | `mergePDFs` | Oui (15) | `merge-dialog.tsx` | Fonctionnel |
| Pages ops | `POST /api/pdf/pages` | `addPage`, `deletePage`, `movePage`, `rotatePage`, `copyPage`, `resizePage`, `extractPages` | Oui (45+) | toolbar | Fonctionnel |
| Encrypt/Decrypt | `POST /api/pdf/encrypt` | `encryptPDF`, `decryptPDF`, `getPermissions`, `setPermissions` | Oui (20) | `encrypt-dialog.tsx` | Fonctionnel |
| HTML/URL→PDF | `POST /api/pdf/convert` | `htmlToPDF`, `urlToPDFSafe` | **ABSENT** | `convert-dialog.tsx` | Fonctionnel — timeout HTML asymétrique (P1) + champ fantôme `pageSize` (P1) |
| Parse document | `POST /api/pdf/parse-from-s3` | `parseDocument`, `extractTextBlocks`, `extractImages`, `extractFormFields` | Partiel (text seulement) | N/A | `extractImages`, `extractFormFields` non-testés (P2) |
| Apply elements | `POST /api/pdf/apply-elements` | `addText`, `updateText`, `addImage`, `updateImage`, `addShape`, `addAnnotation`, `addFormField`, `deleteElementArea` | Partiel | N/A | `deleteElementArea` non-testé + **P0 sécurité** |
| Preview/Thumbnails | `POST /api/pdf/preview` | `renderPage`, `renderThumbnail`, `renderAllThumbnails` | **ABSENT** | aucun | 0 test (P2) |
| Forms | `POST /api/pdf/forms` | `getFormFields`, `fillForm`, `addFormField` | Partiel (reader, filler) | aucun | `addFormField` non-testé, pas d'UI |
| Metadata | `POST /api/pdf/metadata` | `getMetadata`, `setMetadata` | Oui | aucun | Pas d'UI |
| **Compress** | absent | absent | absent | absent | **MANQUANT** |
| **Watermark** | absent | absent | absent | absent | **MANQUANT** |
| **OCR** | absent | absent | absent | absent | **MANQUANT** |
| **Signature électronique** | absent | absent | absent | absent | **MANQUANT** |

---

## Bugs identifiés par priorité

### P0 — CRITIQUE (sécurité / correctness)

**Redaction factice — `deleteElementArea`**
- Fichier : `packages/pdf-engine/src/render/redaction.ts:24-31`
- Implémentation : `page.drawRectangle({ color: rgb(1,1,1), opacity: 1 })` — rectangle blanc peint par-dessus
- **Le contenu sous-jacent (texte, images) reste dans le content stream PDF et est extractible** par tout lecteur ou via API text extraction
- Ce n'est PAS une redaction au sens ISO 32000 (qui impose suppression des opérateurs)
- Aucun test
- **Risque légal** : si un utilisateur "supprime" des données sensibles via cette fonction, il croit que c'est sûr alors que c'est récupérable

### P1 — MAJEUR

1. **`flattenAnnotations` incomplète** (`packages/pdf-engine/src/render/flatten.ts:33-37`) : supprime `/Annots` du dict de page mais ne fait pas le compositing des appearance streams dans le content stream
2. **HTML→PDF timeout non capé** (`apps/web/src/app/api/pdf/convert/route.ts:82`) : 30s pour HTML vs 15s pour URL, asymétrie non intentionnelle, risque resource exhaustion
3. **`convert-dialog.tsx:133` champ `pageSize` fantôme** : envoyé mais ignoré par la route → désalignement contrat

### P2 — MINEUR

1. **Split `pageCount: null` hardcodé** (`apps/web/src/app/api/pdf/split/route.ts`) : commenté "not cheaply available without re-parsing", UI affiche probablement vide
2. **9 modules sans tests** : preview, redaction, flatten, form-renderer, flattenForm, extractImages, extractFormFields, htmlToPDF/urlToPDFSafe (le plus risqué : SSRF prevention sans test)

---

## Features Orphelines

Routes sans dialog UI : `preview`, `forms`, `metadata`. Aucun dialog orphelin.

---

## Recommandations Priorisation

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| **P0 immédiat** | Documenter dans la docstring de `deleteElementArea` que c'est couverture visuelle, pas redaction sécurisée. Test de non-régression vérifiant que le texte reste extractible. Décider si vrai flux de redaction est in-scope. | Petit | Critique légal/sécurité |
| P1 sprint | Tests `deleteElementArea`, `flattenAnnotations`, `flattenForms` | Moyen | Couverture |
| P1 sprint | Caper timeout HTML→PDF à 15s comme URL | Trivial | Anti-DoS |
| P1 sprint | Supprimer `pageSize` du payload `convert-dialog.tsx:133` | Trivial | Propreté contrat |
| P2 | Tests `htmlToPDF`/`urlToPDFSafe` (SSRF) | Grand | Sécurité |
| P2 | Tests `renderPage`/`renderThumbnail`/`renderAllThumbnails` | Moyen | Couverture |
| P2 | Tests `extractImages`/`extractFormFields` | Moyen | Couverture |
| P3 | Dialog UI Forms (fill+get) | Grand | UX |
| P3 | Dialog UI Metadata | Petit | UX |
| P3 won't fix | Compress / Watermark / OCR / Sign — features absentes, hors scope | N/A | Roadmap future |

---

## Fichiers essentiels

- `packages/pdf-engine/src/index.ts` — carte API publique
- `packages/pdf-engine/src/render/redaction.ts:24` — P0
- `packages/pdf-engine/src/render/flatten.ts:33` — P1
- `apps/web/src/app/api/pdf/convert/route.ts:82` — P1 timeout
- `apps/web/src/app/api/pdf/apply-elements/route.ts` — orchestrateur
- `apps/web/src/components/editor/convert-dialog.tsx:133` — P1 champ fantôme
