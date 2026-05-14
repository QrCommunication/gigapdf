# 03 — Dead Code Inventory

## Résumé

| Catégorie | Count |
|-----------|-------|
| Fichiers Python sans importeur externe | 2 (security_audit_service.py, job_service.py non importés) |
| Fichiers TS sans importeur (hors barrel re-exports) | 2 (feature-flags.ts, use-embedded-fonts non appelé dans apps) |
| Exports packages/ jamais consommés (apps uniquement) | 12 (pdf-engine : closeDocument, getPageDimensions, setCanvasPoolSize, destroyCanvasPool, setPlaywrightPoolSize, destroyPlaywrightPool) |
| Méthodes LegacyDocumentProxy sans caller hors fichier | 3 (set_metadata no-op, select no-op, permissions setter no-op) |
| Routes API Python définies mais jamais appelées depuis le front | 2 (/documents/{id}/pages/{n}/preview, /documents/{id}/pages/{n}/images/{xref}) |
| Env vars déclarées mais jamais lues | 6 (stripe_starter_price_id, stripe_pro_price_id, scw_access_key, scw_secret_key, scw_default_organization_id, scw_default_project_id) |

---

## 1. Fichiers Python sans importeur externe

### app/services/security_audit_service.py
- **Callers** : 0 — aucun fichier n'importe `security_audit_service` ni `SecurityAuditService`.
- **Contenu** : Logging d'événements sécurité (chiffrement, accès, auth). Service complet avec enum `SecurityEventType`.
- **Statut** : Code mort à confirmer. Le service existe (singleton `security_audit_service = SecurityAuditService()`) mais n'est jamais instancié depuis l'extérieur.
- **Recommandation** : Vérifier si l'intention était de le brancher dans `app/api/v1/security.py`. Si non, supprimer. Si oui, il manque le branchement.

### app/services/job_service.py
- **Callers** : 0 import entrant — `app/api/v1/jobs.py` n'importe pas `job_service`, il accède directement à `celery_app` et à la DB.
- **Statut** : Code mort. Le singleton `job_service = JobService()` en ligne 203 est créé mais jamais consommé.
- **Recommandation** : Supprimer ou brancher dans `jobs.py`.

---

## 2. Fichiers TS sans importeur

### apps/web/src/lib/feature-flags.ts
- **Callers** : 0 import dans tout le code applicatif.
- **Exporte** : `FONT_DYNAMIC_LOAD_ENABLED` (basé sur `NEXT_PUBLIC_FONT_DYNAMIC_LOAD`).
- **Note** : Le hook `use-embedded-fonts.ts` du package editor lit directement `process.env['NEXT_PUBLIC_FONT_DYNAMIC_LOAD']` au lieu d'importer ce fichier. Il n'y a donc aucun consumer de `feature-flags.ts`.
- **Recommandation** : Soit supprimer ce fichier, soit faire en sorte que `use-embedded-fonts.ts` l'importe pour centraliser le flag.

### packages/editor/src/hooks/use-embedded-fonts.ts (usage indirect manquant)
- **Callers dans apps/** : 0 — aucun composant de `apps/web` n'appelle `useEmbeddedFonts`.
- **L'hook est exporté** depuis `packages/editor/src/index.ts` mais jamais consommé dans `apps/web/src/`.
- **Problème connexe** : `use-embedded-fonts.ts` fetch `/api/pdf/fonts/:documentId` (Next.js) mais cette route Next.js **n'existe pas** (`apps/web/src/app/api/pdf/fonts/` est absent). La route Python `/api/v1/pdf/fonts/*` existe côté backend, mais aucun proxy Next.js ne la relaie.
- **Recommandation** : Soit créer la route Next.js `/api/pdf/fonts/[documentId]/route.ts`, soit documenter que la feature est désactivée par défaut et que l'hook est prêt à l'emploi mais non branché.

---

## 3. Exports packages/ jamais consommés par les apps

Ces symboles sont exportés depuis `packages/pdf-engine/src/index.ts` mais ont **0 usage** dans `apps/web/src/` et `packages/editor/src/` (ils sont implémentés dans le package mais non consommés de l'extérieur).

| Symbole | Note |
|---------|------|
| `closeDocument` | Exporté, implémenté, 0 appel dans apps — le cycle open/save est géré sans fermeture explicite |
| `getPageDimensions` | 0 appel dans apps ; les dimensions arrivent via `parseDocument` |
| `setCanvasPoolSize` | Configuration du pool canvas — jamais utilisée (pool avec taille par défaut) |
| `destroyCanvasPool` | Nettoyage lifecycle — jamais appelé (pas de shutdown propre côté Next.js serverless) |
| `setPlaywrightPoolSize` | Idem, pool Playwright non configuré dynamiquement |
| `destroyPlaywrightPool` | Idem |
| `parseBookmarks` | Signet extraction — non utilisée dans le frontend actuel |
| `parseMetadata` | Metadata standalone — remplacée par `getMetadata` dans les routes |
| `updateFormFieldValue` | Mise à jour valeur formulaire — non exposée dans les API routes Next.js |
| `clearFontCache` | Gestion cache police — non appelée (cache géré implicitement) |
| `rgbToHex` | Utilitaire couleur inverse — 0 usage dans apps |
| `normalizeColor` | Idem |
| `webToPdf` / `pdfToWeb` / `scaleRect` | Utilitaires de coordonnées — utilisés uniquement en interne au package |
| `normalizeFontName` / `resolveStandardFont` / `isStandardFont` / `mapPdfFontToStandard` | Utilitaires font — utilisés en interne au package pdf-engine |
| `engineLogger` | Logger interne — non réexposé aux consommateurs |

**Note** : `webToPdf`, `pdfToWeb`, `scaleRect`, et les utilitaires font sont intensivement utilisés *à l'intérieur* de `packages/pdf-engine/src/` — ils ne sont pas morts, juste leur export public est superflu. Candidats à retirer de `index.ts` (ne pas supprimer les implémentations).

---

## 4. Méthodes LegacyDocumentProxy / LegacyPageProxy

Focus sur `app/core/pdf_engine.py`.

### LegacyDocumentProxy — méthodes no-op ou orphelines

| Méthode / Propriété | Callers externes | Statut |
|--------------------|-----------------|--------|
| `tobytes()` | `embed.py:478`, `fonts.py:153`, `export_tasks.py:249` | Vivante — utilisée |
| `authenticate(password)` | `security.py:515` | Vivante |
| `metadata` (property) | `security.py:735` | Vivante |
| `permissions` (getter) | `security.py:740` | Vivante |
| `permissions` (setter) | `security.py:306` | **No-op documenté** — setter est un `logger.warning()` pur |
| `set_metadata(dict)` | `security.py:305` | **No-op documenté** — `logger.warning()` pur |
| `close()` | 0 | **Jamais appelée** — close est un no-op mais même pas invoqué |
| `select(page_indices)` | `document_service.py:543` (reorder_pages) | **No-op documenté** — warning uniquement, pages non réordonnées réellement |
| `page_count` | `document_service.py:76,85,107`, `export_tasks.py:250` | Vivante |
| `is_encrypted` | `security.py:510,730` | Vivante |

**Bug critique détecté** : `document_service.py:281` appelle `session.pdf_doc.extract_image(image_xref)` mais `LegacyDocumentProxy` n'a **pas de méthode `extract_image`**. L'appel lèvera `AttributeError` à l'exécution. La route `GET /documents/{id}/pages/{n}/images/{xref}` est donc cassée.

### LegacyPageProxy — toutes propriétés vivantes

`rect`, `mediabox`, `cropbox` sont accédées dans `document_service.py` via `get_page()`. Pas de code mort ici.

### PDFEngine — méthodes no-op (stubs de migration)

| Méthode | Statut |
|---------|--------|
| `add_page()` | Appelée depuis `document_service.py:402` → no-op (warning) |
| `delete_page()` | Appelée depuis `document_service.py:452` → no-op |
| `move_page()` | Non appelée par document_service (move délégué au TS engine) |
| `rotate_page()` | Appelée depuis `document_service.py:499` → no-op |
| `copy_page()` | 0 caller externe — dead |
| `resize_page()` | 0 caller externe — dead |
| `get_metadata()` | Vivante (appelée indirectement via metadata endpoint) |
| `set_metadata()` | Vivante (appelée `document_service` et via pikepdf) |

---

## 5. Routes API Python définies mais jamais appelées depuis le frontend

### Routes présentes dans Python mais absentes du client TS (`packages/api`) et de `apps/web`

| Route Python | Fichier | Status |
|---|---|---|
| `GET /documents/{id}/pages/{n}/preview` | `pages.py:371` | Définie, mais `usePagePreview` dans `packages/api/hooks/use-pages.ts` existe et appelle cette route Python — sauf qu'**aucun composant `apps/web`** n'utilise `usePagePreview`. Route techniquement morte côté frontend. |
| `GET /documents/{id}/pages/{n}/images/{xref}` | `pages.py:215` | Définie, mais **aucun composant `apps/web`** n'utilise `usePageImage`. De plus, `get_page_image()` dans `document_service.py` appelle `extract_image()` qui n'existe pas sur `LegacyDocumentProxy` (bug). |
| `GET /api/v1/pdf/fonts/*` (Python backend) | `fonts.py` | La route Python existe, mais aucune route proxy Next.js `/api/pdf/fonts/` n'existe. `use-embedded-fonts.ts` fetch `/api/pdf/fonts/:documentId` (Next.js) qui est absent — la feature fonts est non fonctionnelle end-to-end. |

**Note** : La grande majorité des routes Python sont bien appelées, soit via `apps/web/src/lib/api.ts`, soit via les routes API Next.js (`/api/pdf/*`). Les routes billing, sharing, storage, quota, admin, embed, api-keys, etc. ont tous des consommateurs.

---

## 6. Variables d'environnement déclarées mais non lues

Fichier : `app/config.py` (classe `Settings`)

| Variable | Déclarée | Utilisée | Note |
|----------|----------|----------|------|
| `stripe_starter_price_id` | ✅ | 0 usages | **Explicitement DEPRECATED** dans config.py — commentaire dit "use database" |
| `stripe_pro_price_id` | ✅ | 0 usages | Idem |
| `scw_access_key` | ✅ | 0 usages | Commentaire : "scw CLI reads SCW_ env vars directly" — jamais lu par Python |
| `scw_secret_key` | ✅ | 0 usages | Idem |
| `scw_default_organization_id` | ✅ | 0 usages | Idem |
| `scw_default_project_id` | ✅ | 0 usages | Idem |

---

## Recommandations de cleanup (par fichier, action à faire)

### PRIORITÉ HAUTE — Bug actif

| Fichier | Action |
|---------|--------|
| `app/services/document_service.py:281` | **Bug** : `session.pdf_doc.extract_image(image_xref)` appelle une méthode inexistante sur `LegacyDocumentProxy`. Soit implémenter `extract_image()` via pikepdf, soit supprimer la route `GET /pages/{n}/images/{xref}` si elle n'est plus requise. |

### PRIORITÉ HAUTE — Code mort confirmé

| Fichier | Action |
|---------|--------|
| `app/services/security_audit_service.py` | Supprimer si non branché intentionnellement, sinon l'importer et appeler depuis `security.py` |
| `app/services/job_service.py` | Supprimer `job_service` singleton ou l'importer dans `api/v1/jobs.py` |
| `app/core/pdf_engine.py` — `copy_page()`, `resize_page()` | Supprimer ces méthodes (0 caller) |
| `app/core/pdf_engine.py` — `LegacyDocumentProxy.close()` | Supprimer — no-op jamais appelé |
| `app/core/pdf_engine.py` — `LegacyDocumentProxy.permissions` setter | Documenter explicitement comme no-op ou supprimer si callers peuvent être mis à jour |

### PRIORITÉ MOYENNE — Exports superflus dans packages/pdf-engine/src/index.ts

| Symboles | Action |
|----------|--------|
| `webToPdf`, `pdfToWeb`, `scaleRect`, `normalizeFontName`, `resolveStandardFont`, `isStandardFont`, `mapPdfFontToStandard`, `engineLogger` | Retirer de l'export public (`index.ts`) — uniquement usages internes. Ne pas supprimer les implémentations. |
| `closeDocument`, `getPageDimensions`, `setCanvasPoolSize`, `destroyCanvasPool`, `setPlaywrightPoolSize`, `destroyPlaywrightPool`, `parseMetadata`, `parseBookmarks`, `updateFormFieldValue`, `clearFontCache`, `rgbToHex`, `normalizeColor` | Idem — retirer de l'export public si aucun app ne les consomme |

### PRIORITÉ MOYENNE — Feature incompète (fonts)

| Fichier | Action |
|---------|--------|
| `apps/web/src/lib/feature-flags.ts` | Soit supprimer, soit faire importer `FONT_DYNAMIC_LOAD_ENABLED` par `use-embedded-fonts.ts` |
| `apps/web/src/app/api/pdf/fonts/` | Créer le route handler Next.js `[documentId]/route.ts` et `[documentId]/[fontId]/route.ts` qui proxifient vers le backend Python `GET /api/v1/pdf/fonts/*` — sinon la feature fonts est dead end-to-end |

### PRIORITÉ BASSE — Config.py nettoyage

| Variable | Action |
|----------|--------|
| `stripe_starter_price_id`, `stripe_pro_price_id` | Supprimer (déjà documentées DEPRECATED dans le code) |
| `scw_access_key`, `scw_secret_key`, `scw_default_organization_id`, `scw_default_project_id` | Supprimer ou déplacer dans la documentation d'infra (elles sont lues par le CLI scw, pas par Python) |

### PRIORITÉ BASSE — Routes Python sans caller frontend

| Route | Action |
|-------|--------|
| `GET /documents/{id}/pages/{n}/preview` | À conserver (c'est l'API publique documentée), mais brancher `usePagePreview` dans un composant UI ou supprimer le hook si la feature preview via TS engine (`/api/pdf/preview`) est l'approche choisie |
| `GET /documents/{id}/pages/{n}/images/{xref}` | À résoudre avec le bug `extract_image` ci-dessus. Si la feature est abandonnée au profit du TS engine, supprimer la route et le hook `usePageImage` |
