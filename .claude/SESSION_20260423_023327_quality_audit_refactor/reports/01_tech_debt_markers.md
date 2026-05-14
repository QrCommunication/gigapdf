# 01 — Tech Debt Markers Inventory

> Inventaire read-only. Aucun fichier source modifié.
> Date : 2026-04-22. Zones scannées : apps/web/src, apps/admin/src, apps/mobile/src, packages/pdf-engine/src, packages/api/src, packages/editor/src, app/services/, app/api/v1/, app/core/, app/tasks/
> Exclusions appliquées : node_modules, .next, dist, __pycache__, __tests__/fixtures

---

## Résumé chiffré

| Catégorie | Count | Scope |
|-----------|-------|-------|
| `as any` | 36 | TS/TSX (toutes zones) |
| `as unknown as` | 67 | TS/TSX (toutes zones, incl. tests) |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | 0 | TS/TSX |
| `@deprecated` | 2 | TS/TSX |
| `TODO`/`FIXME` (TS/TSX) | 55 | packages/api/* majoritairement |
| `TODO`/`FIXME`/`DEPRECATED` (Python) | 40 | app/api/v1/, app/core/, app/tasks/ |
| `# type: ignore` | 3 | Python (tests uniquement) |
| `# noqa` | 7 | Python (app/middleware, app/models) |
| `console.log` (fichiers source prod, hors scripts/examples) | 121 | TS/TSX |
| `console.log` (Python) | 235 | Python API (print → debug) |
| Fichiers > 500 LOC (TS/TSX) | 24 | Voir section dédiée |
| Fichiers > 500 LOC (Python) | 20+ | Voir section dédiée |
| Modules Python DEPRECATED entiers | 3 | app/core/pdf_engine.py, app/core/preview.py, app/services/document_service.py |

---

## Top 15 fichiers par dette cumulée TS/TSX
*(critères : as any + as unknown as + TODO/FIXME + console.log + @ts-ignore)*

| Rang | Fichier | Score | Détail |
|------|---------|-------|--------|
| 1 | `apps/web/src/app/editor/[id]/page.tsx` | 29 | 7×`as unknown as`, 7×TODO, 15×`console.log` — 1183 LOC |
| 2 | `apps/mobile/src/services/auth.ts` | 23 | 3×`as unknown as`, 20×`console.log` — 816 LOC |
| 3 | `apps/web/src/components/editor/editor-canvas.tsx` | 18 | 2×`as unknown as`, 16×`console.log` — 1281 LOC |
| 4 | `apps/mobile/src/stores/authStore.ts` | 17 | 1×`as any`, 16×`console.log` — God Object |
| 5 | `apps/web/src/app/api/pdf/apply-elements/route.ts` | 10 | 10×`as unknown as` |
| 6 | `apps/web/src/components/editor/content-edit-layer.tsx` | 9 | 9×`as unknown as` — 1545 LOC |
| 7 | `apps/mobile/src/services/api.ts` | 9 | 8×`: any`, 9×`console.log` — 565 LOC |
| 8 | `apps/web/src/app/embed/[[...params]]/page.tsx` | 7 | 7×`as unknown as` — 1038 LOC |
| 9 | `packages/api/src/services/elements.ts` | 6 | 6×TODO |
| 10 | `packages/api/src/hooks/use-elements.ts` | 6 | 6×TODO |
| 11 | `apps/web/src/hooks/use-document.ts` | 6 | 1×`as unknown as`, 5×`console.log` |
| 12 | `apps/web/src/app/(legal)/docs/embed/page.tsx` | 6 | 5×`as unknown as`, 6×`console.log` — 501 LOC |
| 13 | `packages/api/src/services/uploads.ts` | 5 | 5×TODO |
| 14 | `packages/api/src/services/jobs.ts` | 5 | 5×TODO |
| 15 | `packages/api/src/hooks/use-uploads.ts` | 5 | 5×TODO |

---

## Top 10 fichiers par `any` dans les signatures de types (`: any`, `<any>`, `Record<string, any>`)

| Rang | Fichier | Count |
|------|---------|-------|
| 1 | `apps/mobile/src/services/pdf-editor.ts` | 37 |
| 2 | `apps/mobile/src/services/utils.ts` | 14 |
| 3 | `apps/mobile/src/services/documents.ts` | 8 |
| 4 | `apps/mobile/src/services/api.ts` | 8 |
| 5 | `apps/mobile/src/services/types.ts` | 6 |
| 6 | `apps/mobile/src/services/examples.ts` | 6 |
| 7 | `apps/mobile/src/services/annotations.ts` | 6 |
| 8 | `packages/editor/src/middleware/sync-middleware.ts` | 5 |
| 9 | `apps/mobile/src/stores/authStore.ts` | 5 |
| 10 | `apps/mobile/src/services/elements.ts` | 4 |

---

## Fichiers volumineux (> 500 LOC)

### TS/TSX — Top 24 (tous > 500 LOC)

| LOC | Fichier | Zone | Statut |
|-----|---------|------|--------|
| 1595 | `apps/web/src/lib/api.ts` | web | God Object — API client monolithique |
| 1545 | `apps/web/src/components/editor/content-edit-layer.tsx` | web | God Component — 9 occurrences as unknown as |
| 1455 | `apps/mobile/app/(tabs)/index.tsx` | mobile | God Screen — 3×as any, 3×console.log |
| 1281 | `apps/web/src/components/editor/editor-canvas.tsx` | web | God Component — 16×console.log |
| 1183 | `apps/web/src/app/editor/[id]/page.tsx` | web | Page monolithique — dette #1 cumulée |
| 1150 | `apps/mobile/src/services/pdf-editor.ts` | mobile | 37×`: any` dans signatures |
| 1038 | `apps/web/src/app/embed/[[...params]]/page.tsx` | web | 7×as unknown as |
| 994 | `apps/admin/src/lib/api.ts` | admin | God Object admin |
| 965 | `apps/web/src/components/dashboard/document-explorer.tsx` | web | 5×console.log |
| 962 | `apps/admin/src/app/(dashboard)/plans/page.tsx` | admin | Page complexe |
| 943 | `apps/mobile/app/document/[id].tsx` | mobile | 1×as any, 4×console.log |
| 881 | `apps/web/src/components/editor/encrypt-dialog.tsx` | web | Dialog > 800 LOC |
| 816 | `apps/mobile/src/services/auth.ts` | mobile | 20×console.log, dette #2 |
| 810 | `apps/web/src/components/editor/metadata-dialog.tsx` | web | Dialog > 800 LOC |
| 799 | `apps/web/src/components/editor/editor-toolbar.tsx` | web | Toolbar monolithique |
| 731 | `apps/web/src/components/dashboard/document-table.tsx` | web | Table complexe |
| 725 | `packages/api/src/services/pdf.ts` | api pkg | Service monolithique |
| 700 | `packages/pdf-engine/src/parse/image-extractor.ts` | pdf-engine | 2×as unknown as |
| 672 | `packages/pdf-engine/src/parse/text-extractor.ts` | pdf-engine | Parser 672 LOC |
| 637 | `apps/mobile/src/services/examples.ts` | mobile | Fichier exemples en production |
| 633 | `apps/mobile/src/services/elements.ts` | mobile | 2×as any |
| 614 | `apps/web/src/app/page.tsx` | web | Landing page monolithique |
| 608 | `apps/web/src/app/(dashboard)/organization/page.tsx` | web | Page org > 600 LOC |
| 583 | `apps/web/src/app/(dashboard)/billing/page.tsx` | web | Page billing |
| 562 | `apps/web/src/components/editor/forms-panel.tsx` | web | Panel > 500 LOC |
| 543 | `apps/mobile/src/services/pages.ts` | mobile | 2×as any |
| 540 | `apps/mobile/src/services/EXAMPLE_SCREEN.tsx` | mobile | **EXAMPLE en production** |
| 535 | `apps/web/src/components/dashboard/document-card.tsx` | web | Card > 500 LOC |
| 533 | `apps/mobile/src/services/types.ts` | mobile | 6×`: any` |
| 515 | `apps/web/src/hooks/use-document-save.ts` | web | Hook > 500 LOC |
| 512 | `apps/admin/src/app/(dashboard)/tenants/[id]/page.tsx` | admin | Page > 500 LOC |
| 511 | `apps/web/src/app/(dashboard)/documents/page.tsx` | web | Page > 500 LOC |
| 501 | `apps/web/src/app/(legal)/docs/embed/page.tsx` | web | 6×console.log |

### Python — Top 20 (tous > 500 LOC)

| LOC | Fichier | Zone | Anomalie |
|-----|---------|------|----------|
| 2790 | `app/api/v1/storage.py` | api | 24×print (debug) — God Router |
| 2271 | `app/api/v1/sharing.py` | api | 18×print — God Router |
| 1887 | `app/api/v1/elements.py` | api | 19×print — God Router |
| 1808 | `app/api/v1/billing.py` | api | 14×print |
| 1666 | `app/api/v1/pages.py` | api | 9×print |
| 1540 | `app/api/v1/text.py` | api | 5×TODO (non implémenté) + 17×print |
| 1462 | `app/api/v1/admin/tenants.py` | admin api | God Router admin |
| 1198 | `app/api/v1/documents.py` | api | 7×print |
| 949 | `app/api/v1/forms.py` | api | 4×TODO (non implémenté) + 10×print |
| 919 | `app/api/v1/tenant_documents.py` | api | 5×print |
| 898 | `app/api/v1/layers.py` | api | 5×TODO (non implémenté) + 7×print |
| 897 | `app/api/v1/admin/jobs.py` | admin api | 6×print |
| 873 | `app/api/v1/admin/documents.py` | admin api | 6×print |
| 861 | `app/api/v1/bookmarks.py` | api | 4×TODO (non implémenté) + 7×print |
| 806 | `app/api/v1/history.py` | api | 9×print |
| 778 | `app/api/v1/public_billing.py` | api | 5×print |
| 766 | `app/api/v1/security.py` | api | DEPRECATED (fichier entier) + 9×print |
| 745 | `app/api/v1/admin/users.py` | admin api | 8×print |
| 735 | `app/api/v1/export.py` | api | 6×print |
| 716 | `app/services/stripe_service.py` | services | Monolithique |

---

## Modules Python entièrement DEPRECATED (migration Python → TS non terminée)

Ces modules existent uniquement pour éviter des import errors. Ils sont marqués DEPRECATED à leur en-tête.

| Fichier | Marqueur | Action recommandée |
|---------|----------|-------------------|
| `app/core/pdf_engine.py` | `# DEPRECATED` line 4 + 15 méthodes DEPRECATED internes | Supprimer après migration des callers |
| `app/core/preview.py` | `# DEPRECATED` line 4 + TODO line 13 | `export_tasks.py` et `document_service.py` encore callers |
| `app/services/document_service.py` | `# DEPRECATED` line 1 | Vérifier callers avant suppression |
| `app/api/v1/security.py` | `# DEPRECATED` line 1 | Vérifier routes encore exposées |

---

## Liste complète par marqueur

### `as any` — 36 occurrences (tronquée à 36 — exhaustive)

```
packages/editor/src/middleware/sync-middleware.ts:180
packages/editor/src/hooks/use-embedded-fonts.ts:28     (commentaire, pas cast)
packages/s3/src/utils/file-size.ts:54
packages/s3/src/utils/mime-types.ts:101, 109, 117
packages/api/src/websocket/client.ts:207, 228
apps/mobile/app/document/[id].tsx:202
packages/s3/src/operations/download.ts:115
apps/web/src/lib/auth-client.ts:14
apps/mobile/app/(tabs)/index.tsx:798, 1204
apps/mobile/app/(tabs)/settings.tsx:245
apps/mobile/src/stores/authStore.ts:81
packages/pdf-engine/src/preview/renderer.ts:146
apps/mobile/src/services/annotations.ts:432
apps/mobile/src/services/documents.ts:83
apps/mobile/src/components/pdf/AnnotationOverlay.tsx:197
apps/mobile/src/components/DocumentCard.tsx:470
apps/mobile/src/components/pdf/EditorToolbar.tsx:122, 223
apps/mobile/src/services/utils.ts:431
apps/mobile/src/services/elements.ts:88, 515
apps/mobile/src/services/examples.ts:536
apps/mobile/src/services/pages.ts:155, 334
packages/canvas/src/renderers/annotation-renderer.ts:245
packages/canvas/src/utils/export.ts:75
packages/canvas/src/objects/pdf-text.ts:91
packages/canvas/src/objects/pdf-shape.ts:117
packages/canvas/src/hooks/use-canvas.ts:61, 192, 207, 222
```

### `as unknown as` — 67 occurrences (top 50, reste dans tests/vitest-setup)

```
apps/admin/src/lib/prisma.ts:5
apps/web/src/app/api/pdf/apply-elements/route.ts:126, 132, 137 (+ 7 autres lignes)
apps/web/src/app/editor/[id]/page.tsx:82, 86, 91, 96, 100, 504, 552
apps/web/src/app/embed/[[...params]]/page.tsx:129, 133, 138, 143, 146, 399, 473
apps/web/src/components/editor/content-edit-layer.tsx:730, 782, 819, 1095, 1177, 1385, 1399, 1503, 1517
apps/web/src/components/editor/editor-canvas.tsx:1180, 1181
apps/web/src/components/editor/render-elements.ts:109, 195, 338, 364, 373
apps/web/src/hooks/use-document.ts:193
packages/pdf-engine/src/parse/form-extractor.ts:154, 212, 292, 301
packages/logger/src/logger.ts:318
apps/mobile/src/services/auth.ts:3 occurrences
packages/editor/src/hooks/use-embedded-fonts.ts:34
```

### `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` — 0 occurrences

Aucun suppresseur de diagnostic TypeScript. Positif.

### `@deprecated` — 2 occurrences

```
packages/tailwind-config/tailwind.config.ts:2
packages/pdf-engine/src/parse/parser.ts:42  (extractForms, compatibilité backward)
```

### `TODO`/`FIXME` TS/TSX — 55 occurrences (tronquées à 50 ci-dessus, liste complète)

Concentration dans `packages/api/src/` : 46/55 occurrences signalent des **endpoints backend non implémentés**.
Pattern récurrent : `TODO: Backend endpoint not yet implemented`.

Fichiers concernés :
```
packages/api/src/services/documents.ts:65, 130
packages/api/src/services/exports.ts:37, 56, 93
packages/api/src/services/jobs.ts:31, 45, 54, 63, 72
packages/api/src/services/pages.ts:139, 150
packages/api/src/services/uploads.ts:62, 82, 104, 122, 130
packages/api/src/services/elements.ts:98, 135, 151, 162, 173, 185
packages/api/src/services/ocr.ts:38, 66, 75
packages/api/src/hooks/use-uploads.ts:58, 76, 94, 118, 133
packages/api/src/hooks/use-exports.ts:56, 81, 115
packages/api/src/hooks/use-documents.ts:119, 209
packages/api/src/hooks/use-ocr.ts:68, 95, 107
packages/api/src/hooks/use-pages.ts:188, 204
packages/api/src/hooks/use-elements.ts:132, 192, 216, 233, 250, 271
apps/mobile/app/(auth)/login.tsx:104          (Apple login non implémenté)
apps/web/src/app/editor/[id]/page.tsx:331, 335  (canvas element sync partiel)
```

### `# TODO`/`# FIXME`/`# DEPRECATED` Python — 40 occurrences

```
app/services/document_service.py:1    (DEPRECATED)
app/services/activity_service.py:143  (TODO access check)
app/config.py:126                     (DEPRECATED price IDs)
app/core/preview.py:4, 13            (DEPRECATED + TODO remove)
app/core/pdf_engine.py:4, 13         (DEPRECATED + TODO routing)
app/repositories/document_repo.py:435 (TODO post-migration)
app/api/v1/modify.py:481, 493, 501   (TODO element dispatch)
app/tasks/billing_tasks.py:340, 459, 495, 550, 573  (TODO email notifications)
app/api/v1/forms.py:232, 481, 738, 929  (TODO non implémenté)
app/api/v1/text.py:291, 498, 733, 1058, 1296  (TODO non implémenté)
app/api/v1/layers.py:203, 391, 572, 716, 882  (TODO non implémenté)
app/api/v1/bookmarks.py:199, 440, 668, 860   (TODO non implémenté)
app/api/v1/webhooks.py:484, 555             (TODO email notifications)
app/api/v1/annotations.py:195, 319, 486     (TODO non implémenté)
app/api/v1/security.py:1                    (DEPRECATED)
```

### `# type: ignore` Python — 3 occurrences (tests uniquement)

```
tests/unit/services/conftest.py:62, 63, 64
```

Acceptable — uniquement dans les tests de configuration de mocks.

### `# noqa` Python — 7 occurrences

```
app/middleware/api_key_auth.py:267, 316, 352   (BLE001 — bare except)
app/models/database.py:715, 718               (E402 import order)
app/tasks/infra_tasks.py:154                  (E711 None comparison)
app/api/v1/embed.py:194                       (BLE001 — bare except)
```

### `console.log` en production TS/TSX — 121 occurrences (fichiers source hors scripts/examples)

Top 10 fichiers :
```
apps/mobile/src/services/auth.ts:20      (OAuth debug logs en clair)
apps/web/src/app/editor/[id]/page.tsx:15
apps/web/src/components/editor/editor-canvas.tsx:16
apps/mobile/src/stores/authStore.ts:16
apps/mobile/src/services/api.ts:9
apps/web/src/components/dashboard/document-explorer.tsx:5
apps/web/src/hooks/use-document.ts:5
apps/mobile/src/services/storageService.ts:4
apps/mobile/app/document/[id].tsx:4
apps/mobile/app/(auth)/login.tsx:4
packages/api/src/websocket/client.ts:2
packages/editor/src/middleware/persistence-middleware.ts:4
apps/web/src/lib/server-logger.ts:1     (intentionnel — transport console du logger)
apps/web/src/lib/email/mailer.ts:1
```

### `console.log` Python (print statements) — 235 occurrences

Concentration massive dans les routers FastAPI (app/api/v1/*). Ces prints sont utilisés comme logging de debug au lieu du logger structuré. Top fichiers :
```
app/api/v1/storage.py:24
app/api/v1/quota.py:12
app/api/v1/sharing.py:18
app/api/v1/billing.py:14
app/api/v1/history.py:9
app/api/v1/security.py:9
app/api/v1/text.py:17
```

---

## Anomalies structurelles notables

### Fichier de démo en production
- `apps/mobile/src/services/EXAMPLE_SCREEN.tsx` — 540 LOC, contient `console.log`, code d'exemple non supprimé post-migration
- `apps/mobile/src/services/examples.ts` — 637 LOC, dans `/services/` alors que c'est du code d'exemple

### API clients monolithiques (candidats à découpage immédiat)
- `apps/web/src/lib/api.ts` — 1595 LOC, couvre tous les domaines API en un seul fichier
- `apps/admin/src/lib/api.ts` — 994 LOC, même pattern

### Endpoints Python avec corps TODO (jamais implémentés, exposés en prod)
Les fichiers suivants exposent des routes FastAPI dont le corps est uniquement un `# TODO: Implement...` :
- `app/api/v1/forms.py` : 4 endpoints
- `app/api/v1/text.py` : 5 endpoints
- `app/api/v1/layers.py` : 5 endpoints
- `app/api/v1/bookmarks.py` : 4 endpoints
- `app/api/v1/annotations.py` : 3 endpoints

### Duplication de nommage cross-packages
Fichiers portant le même nom dans plusieurs packages (risque de confusion) :
- `documents.ts` — présent dans packages/api/src/services/ ET apps/mobile/src/services/ ET app/api/v1/documents.py
- `elements.ts` — packages/api/src/services/ ET apps/mobile/src/services/
- `auth.ts` — apps/mobile/src/services/ ET apps/mobile/src/lib/ (`auth-client.ts`)
- `utils.ts` — multiple packages
- `types.ts` — multiple packages

Pas de fichier `parser-v2` ou doublon avec suffixe de version détecté.
