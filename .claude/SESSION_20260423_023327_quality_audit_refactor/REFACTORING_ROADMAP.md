# GigaPDF — Refactoring Roadmap (Top-15 actionnable)

**Date** : 2026-04-22
**Phase** : 3 — Roadmap exécutable
**Contrainte** : chaque fix implémentable par un agent en < 15 turns

---

## Recommandations stratégiques

### MAINTENANT (hotfix quasi-immédiat, avant prochain deploy)

Ces items sont des **breaches actives** ou de la **data integrity violation silencieuse**. Ils doivent être corrigés avant le prochain deploy de production :

- **P0-01** : Sécuriser les 16 routes `/api/pdf/*` (DDoS actif possible sur `/convert` et `/encrypt`)
- **P0-02** : Retirer le JWT de `sessionStorage` (faille XSS exploitable)
- **P0-06** : Le endpoint `encrypt_document` retourne `encrypted:true` sans chiffrer — risque légal (RGPD) et perte de confiance utilisateur. Soit 501, soit implémentation pikepdf
- **P0-07** : 21 endpoints retournent `200 success:true` avec `placeholder-uuid` — migration vers `501 Not Implemented`
- **P0-09** : SSRF via `images.remotePatterns: hostname: "**"` — whitelist stricte immédiate

### AUJOURD'HUI (quelques heures)

- **P0-03** : Admin panel sans credentials → soit 100% des appels échouent en prod (panel cassé) soit bypass auth
- **P0-04 / P0-05** : Les 4 opérations PDF no-ops (reorder / add / delete / rotate) sont des mensonges silencieux — fix pikepdf
- **P0-08** : Fix ou suppression de `extract_image` (bug AttributeError actif)
- **P0-10** : Aligner `MAX_UPLOAD_SIZE_MB` à 100MB partout (cap PDF-bomb effectif)
- **P1-11** : Admin middleware doit vérifier `role === 'super_admin'`
- **P1-13** : `requireEmailVerification: true` en prod
- **P1-12** : Sanitize `Content-Disposition` (HTTP header injection)

### SPRINT SUIVANT (planifié, non urgent)

- Migration `python-jose` → `PyJWT`
- `print()` → `logger` (Python)
- `console.log` → `serverLogger` / `useLogger` (TS)
- TanStack Query pour `useDocument`
- Découpage God files (`lib/api.ts`, `editor-canvas.tsx`, `page.tsx`)
- `MemoryMax` systemd + logrotate
- CSP sans `unsafe-inline` / `unsafe-eval`

---

## Top-15 actionnable — organisé en 4 batches parallèles

**Zones d'orchestration** :
- **Zone A** : routes TS `apps/web/src/app/api/pdf/*` + helpers `apps/web/src/lib/api/`
- **Zone B** : Python `app/services/`, `app/core/`, `app/api/v1/`
- **Zone C** : config + security `apps/web/middleware.ts`, `next.config.ts`, `deploy/`
- **Zone D** : pdf-engine `packages/pdf-engine/src/`
- **Zone E** : frontend `apps/web/src/components/`, `apps/web/src/lib/api.ts`, `apps/admin/src/`

---

## BATCH 1 — Hotfix sécurité critique (4 tâches parallèles, zones disjointes)

### P0-01 — Sécuriser les 16 routes `/api/pdf/*` avec requireSession
**Source** : rapports 02, 13, 15 (dédup)
**Problème concret** : Le middleware Next.js exclut `/api/*` de son matcher (`"/((?!api|...).*)"`) et 16 routes handlers n'ont aucune vérification d'auth. Un attaquant non authentifié peut déclencher `/api/pdf/convert` (Playwright 200-500MB RAM/15s CPU par requête) ou `/api/pdf/encrypt` en boucle — DDoS applicatif.
**Fix** :
1. Créer `apps/web/src/lib/api/require-session.ts` avec helper `requireSession()` qui retourne `{ session, response }` — pattern calqué sur `/api/pdf/parse/route.ts` existant.
2. Créer `apps/web/src/lib/api/validate-pdf.ts` avec `validatePdfFile(file)` (taille 100MB max, MIME check).
3. Créer `apps/web/src/lib/api/response.ts` avec `apiSuccess<T>()` / `apiError()` + type `APIResponse<T>`.
4. Appliquer `requireSession()` + `validatePdfFile()` sur les 16 routes handlers en première ligne.
5. Documenter dans un commentaire du middleware.ts : "NOTE : /api/* VOLONTAIREMENT exclus — chaque route appelle requireSession()".
**Fichiers touchés** : 3 nouveaux fichiers + 16 route.ts modifiés + middleware.ts (commentaire)
**Effort** : M (0.5-1j)
**Agent** : `security-specialist` + `frontend-react` en coordination
**Zone orchestration** : A
**Tests à ajouter** : Vitest sur `requireSession()` (mock Better-Auth), tests d'intégration 401 sans session sur 2-3 routes représentatives
**Critères de succès** :
- `curl -X POST .../api/pdf/encrypt` sans Authorization → 401
- Session valide → opération exécutée
- `validatePdfFile` rejette file > 100MB avec 413

---

### P0-04 + P0-05 — Implémenter les 4 opérations PDF no-ops (reorder/add/delete/rotate) via pikepdf
**Source** : rapports 01, 03, 10 (dédup P0-002 + P0-003)
**Problème concret** : `document_service.reorder_pages()`, `engine.add_page()`, `engine.delete_page()`, `engine.rotate_page()` sont des no-ops qui logguent un warning et retournent `success:true` — mais le PDF binaire stocké en Redis reste inchangé. L'UI affiche le bon ordre, mais le PDF téléchargé a l'ordre original. **Data integrity violation silencieuse sur le feature principal d'un éditeur PDF.**
**Fix** :
```python
# app/core/pdf_engine.py — remplacer les no-ops par pikepdf
def reorder_pages(self, document_id, new_order):
    with pikepdf.open(io.BytesIO(self._documents[document_id])) as pdf:
        originals = list(pdf.pages)
        pdf.pages.clear()
        for n in new_order:
            pdf.pages.append(originals[n - 1])
        out = io.BytesIO(); pdf.save(out)
    self._documents[document_id] = out.getvalue()

def add_page(self, document_id, position, width=612, height=792): ...
def delete_page(self, document_id, page_number): ...
def rotate_page(self, document_id, page_number, angle): ...
```
Puis dans `document_service.py`, remplacer `session.pdf_doc.select(...)` par `self.engine.reorder_pages(document_id, new_order)`, et persister le nouveau bytes dans la session Redis.
**Fichiers touchés** : `app/core/pdf_engine.py`, `app/services/document_service.py`, `app/repositories/document_repo.py` (persistence)
**Effort** : M (0.5-1j, ~80 LOC + persistence)
**Agent** : `backend-laravel` (malgré le nom, sous-agent polyvalent backend) ou agent Python dédié
**Zone orchestration** : B
**Tests à ajouter** : `tests/integration/api/test_page_operations.py` — upload PDF 3 pages, reorder [3,1,2], download, `pikepdf.open(result).pages[0] == original.pages[2]`. Même logique pour add/delete/rotate.
**Critères de succès** : Upload PDF N pages → opération → download → pikepdf confirme la modification binaire

---

### P0-09 + P0-10 — Lockdown SSRF + align upload size limits
**Source** : rapports 02, 14, 15 (dédup P0-001 config + P0-001 security + P1-007)
**Problème concret** :
1. `apps/web/next.config.ts` L101 : `images.remotePatterns: [{ protocol: "https", hostname: "**" }]` → SSRF via `/_next/image?url=https://169.254.169.254/` (métadonnées AWS/GCP/Scaleway).
2. `MAX_UPLOAD_SIZE_MB` : 100MB dans `app/config.py` (avec commentaire "Hard cap for PDF-bomb mitigation") mais 500MB dans `.env.production.example` et `client_max_body_size 500M` dans nginx → cap contourné en prod.
**Fix** :
```typescript
// apps/web/next.config.ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "cdn.giga-pdf.com" },
    { protocol: "https", hostname: "lh3.googleusercontent.com" },
    { protocol: "https", hostname: "avatars.githubusercontent.com" },
  ],
}
```
```ini
# deploy/.env.production.example
MAX_UPLOAD_SIZE_MB=100   # Hard cap — voir app/config.py (PDF-bomb mitigation)

# deploy/nginx.conf (2 blocks)
client_max_body_size 110M;   # Marge +10% vs 100MB Python
```
**Fichiers touchés** : `apps/web/next.config.ts`, `deploy/.env.production.example`, `deploy/nginx.conf`
**Effort** : XS (< 30min)
**Agent** : `devops-infra` + `security-specialist`
**Zone orchestration** : C
**Tests à ajouter** : test manuel `curl /_next/image?url=https://169.254.169.254/latest/meta-data/` → 400. Test upload 150MB → 413.
**Critères de succès** : `grep '"**"' next.config.ts` retourne 0. Les 3 couches (python, env, nginx) alignées à 100MB (+10% nginx).

---

### P0-02 + P0-03 + P1-11 + P1-13 — Auth / sessions web + admin (quadruple fix)
**Source** : rapports 15 (P0-002, P0-003, P1-004, P1-006)
**Problème concret** :
1. JWT Better-Auth stocké dans `sessionStorage` (lisible par XSS) — consommé dans 6 fichiers
2. `apps/admin/src/lib/api.ts` envoie fetch Python sans `credentials: 'include'` ni Bearer — soit panel cassé, soit bypass
3. `apps/admin/src/proxy.ts` vérifie `session.user` mais pas `user.role === 'super_admin'` — tout user authentifié entre
4. `requireEmailVerification: false` en prod dans web + admin malgré commentaire "Set to true in production"
**Fix** :
1. Supprimer `setAuthToken`/`getAuthToken` de `apps/web/src/lib/api.ts`. Le JWT Python (pour `/api/v1/*` backend) doit transiter via proxy Next.js côté serveur uniquement.
2. Dans `apps/admin/src/lib/api.ts`, ajouter `credentials: 'include'` + lecture token via `authClient.getSession()` et header `Authorization: Bearer ${token}`.
3. Dans `apps/admin/src/proxy.ts`, ajouter `if (user.role !== 'super_admin') redirect('/login?error=forbidden')`.
4. `requireEmailVerification: true` dans les 2 configs auth.
**Fichiers touchés** : `apps/web/src/lib/api.ts`, `apps/admin/src/lib/api.ts`, `apps/admin/src/proxy.ts`, `apps/web/src/lib/auth.ts`, `apps/admin/src/lib/auth.ts`, + callers directs de `getAuthToken` (4 fichiers web)
**Effort** : M (0.5-1j — le retrait sessionStorage demande refactor des 6 consommateurs)
**Agent** : `security-specialist` + `frontend-react`
**Zone orchestration** : E
**Tests à ajouter** : Test middleware admin avec user non-admin → 302 `/login`. Test login avec email non vérifié → erreur.
**Critères de succès** :
- `grep -rn 'sessionStorage' apps/web/src/lib/api.ts` → 0 résultat
- Admin panel accessible UNIQUEMENT avec `role === 'super_admin'`
- Email verification requise au login

---

## BATCH 2 — API honesty + bug actif (4 tâches parallèles)

### P0-06 — Encrypt endpoint : 501 Not Implemented (ou pikepdf impl)
**Source** : rapports 10 (P1-003), 15 (implicitement)
**Problème concret** : `POST /documents/{id}/security/encrypt` dans `app/api/v1/security.py` (lignes 247-349) appelle `session.pdf_doc.set_metadata(...)` (no-op) et `session.pdf_doc.permissions = perm` (no-op), stocke les paramètres dans un attribut dynamique non persisté Redis, et retourne `{"encrypted": true}`. **Le document n'est jamais chiffré.** L'utilisateur pense avoir protégé son document — le PDF téléchargé est en clair. Risque RGPD si données sensibles.
**Fix** : Option rapide honnête — retourner `501 Not Implemented` :
```python
from fastapi import HTTPException
raise HTTPException(
    status_code=501,
    detail="PDF encryption server-side not implemented. Use client-side encryption via the editor's TS engine."
)
```
Appliquer aussi sur `decrypt_document` et `change_permissions` du même module. Alternative correcte (plus longue) : implémenter via `pikepdf.Encryption(user=..., owner=..., R=6)` — voir rapport 10 P1-003 pour le code complet.
**Fichiers touchés** : `app/api/v1/security.py` (3 endpoints)
**Effort** : S (1-2h option 501) ou M (0.5-1j option pikepdf)
**Agent** : Python backend agent
**Zone orchestration** : B
**Tests à ajouter** : Test 501 sur les 3 endpoints. Si pikepdf implémenté : upload → encrypt password="secret" → download → `pikepdf.open(bytes)` lève `PasswordError`, `pikepdf.open(bytes, password="secret")` réussit.
**Critères de succès** : Aucun endpoint ne retourne `encrypted:true` sans que le PDF soit réellement chiffré.

---

### P0-07 — Migration des 21 endpoints TODO vers 501 Not Implemented
**Source** : rapports 01, 10 (P0-004)
**Problème concret** : 21 endpoints dans `app/api/v1/text.py`, `layers.py`, `bookmarks.py`, `forms.py`, `annotations.py` ont un corps du type `return APIResponse(success=True, data={"id": "placeholder-uuid"})` sans aucune logique métier. Le client reçoit des IDs `placeholder-uuid` et croit que l'opération a réussi.
**Fix** : Remplacer mécaniquement le corps de chaque handler TODO par `raise HTTPException(status_code=501, detail="Not implemented. This feature is under development.")`.
Les 5 plus critiques à fixer en priorité :
1. `POST /documents/{id}/bookmarks`
2. `POST /documents/{id}/pages/{n}/annotations/markup`
3. `PUT /documents/{id}/forms/fill`
4. `POST /documents/{id}/layers`
5. `POST /documents/{id}/text/replace`
**Fichiers touchés** : 5 fichiers Python (text.py, layers.py, bookmarks.py, forms.py, annotations.py)
**Effort** : S (1-2h — remplacement mécanique + test par endpoint)
**Agent** : Python backend agent
**Zone orchestration** : B
**Tests à ajouter** : Test `TestClient` sur les 5 endpoints critiques — vérifier 501 status_code.
**Critères de succès** : `grep -rn 'placeholder-uuid' app/api/v1/` → 0. Tous les endpoints TODO retournent 501.

---

### P0-08 — Suppression ou fix du bug `extract_image` (AttributeError runtime)
**Source** : rapports 03, 10 (P0-001)
**Problème concret** : `app/services/document_service.py:281` appelle `session.pdf_doc.extract_image(image_xref)` mais `LegacyDocumentProxy` n'expose pas cette méthode (confirmé : lines 425-506 de `pdf_engine.py`). À chaque appel `GET /documents/{id}/pages/{n}/images/{xref}`, une `AttributeError` est levée. **Rapport 03 confirme : aucun composant frontend n'utilise `usePageImage`** → la route est inutilisée.
**Fix** :
1. Supprimer la route `@router.get("/{page_number}/images/{image_xref}")` dans `app/api/v1/pages.py`.
2. Supprimer `get_page_image()` dans `document_service.py` (lines 258-307).
3. Supprimer le hook `usePageImage` dans `packages/api/src/hooks/use-pages.ts` et `packages/api/src/services/pages.ts`.
4. Retirer le `except Exception` trop large (P3-74) qui masquait ce bug en 404.
**Fichiers touchés** : `app/api/v1/pages.py`, `app/services/document_service.py`, `packages/api/src/hooks/use-pages.ts`, `packages/api/src/services/pages.ts`
**Effort** : XS (< 30min)
**Agent** : `backend-laravel` (backend Python)
**Zone orchestration** : B
**Tests à ajouter** : Test `TestClient` que `/pages/{n}/images/{xref}` retourne 404 (route supprimée).
**Critères de succès** : `grep -rn 'extract_image' app/` → 0. Aucun caller de `usePageImage` dans le code.

---

### P1-12 — Sanitize Content-Disposition sur les 10 routes PDF retournant un binaire
**Source** : rapports 13, 15 (P1-005, P1-007)
**Problème concret** : `'Content-Disposition': 'attachment; filename="${file.name}"'` avec `file.name` client non-sanitizé dans 10 handlers. Un nom contenant `"`, CRLF, ou caractères de contrôle permet HTTP Header Injection (cache poisoning, XSS selon CDN).
**Fix** : Créer un helper partagé :
```typescript
// apps/web/src/lib/api/content-disposition.ts
export function sanitizedAttachment(filename: string): string {
  const safe = filename.replace(/[^\w.\-]/g, '_').slice(0, 255);
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
```
Remplacer dans les 10 routes : `save`, `encrypt`, `apply-elements`, `annotations`, `text`, `shape`, `image`, `flatten`, `merge`, `split`.
**Fichiers touchés** : 1 nouveau helper + 10 route.ts
**Effort** : S (1-2h)
**Agent** : `frontend-react` + `security-specialist`
**Zone orchestration** : A
**Tests à ajouter** : Vitest sur `sanitizedAttachment('"evil\r\nX-Injected: 1.pdf')` → pas de CRLF dans la sortie.
**Critères de succès** : `grep -rn 'filename="\${file.name}"' apps/web/src/app/api/pdf/` → 0.

---

## BATCH 3 — Observabilité + config infra (3 tâches parallèles)

### P1-14 + P2-41 — File size limit (100MB) + Zod sur les 13 routes `/api/pdf/*` restantes
**Source** : rapports 13 (P1-006, P2-009), 15 (P2-009, P2-010)
**Problème concret** : Seule `/api/pdf/parse` limite à 100MB. Les 13 autres acceptent n'importe quelle taille. Validation Zod présente uniquement sur 2 routes — les 13 autres font `JSON.parse as ElementOperation[]` sans validation runtime. Un attaquant peut envoyer `pageNumber: NaN` ou `pageNumber: -1e100`.
**Fix** :
1. Utiliser le `validatePdfFile()` créé dans P0-01 — déjà prévu avec limite 100MB.
2. Définir un schéma Zod commun pour `operations` / `element` :
```typescript
const ElementOpSchema = z.object({
  action: z.enum(['add', 'update', 'delete']),
  pageNumber: z.number().int().min(1).max(10000),
  element: z.record(z.unknown()),
});
```
3. Appliquer dans les 13 routes après `validatePdfFile()`.
**Fichiers touchés** : 1 fichier `apps/web/src/lib/api/schemas.ts` + 13 route.ts
**Effort** : M (0.5-1j)
**Agent** : `frontend-react`
**Zone orchestration** : A (après P0-01 qui fournit les helpers)
**Tests à ajouter** : Tests Vitest pour chaque schéma Zod (happy path + cas limites).
**Critères de succès** : POST avec `pageNumber: -1` → 422 avec détails Zod. Upload 150MB → 413.

---

### P1-15 + P1-19 + P1-20 — Migration console.log/print → logger structuré
**Source** : rapports 01, 10 (P1-006), 12 (P1-005), 13 (P1-005)
**Problème concret** :
- 16 routes `/api/pdf/*` utilisent `console.error(...)` au lieu de `serverLogger`
- 43 `console.log` dans editor-canvas.tsx + page.tsx exposent IDs éléments et contenu texte édité
- 235 `print()` dans routeurs FastAPI invisibles dans Sentry/Datadog
**Fix** :
1. **TS/Next.js** : remplacer `console.error/log` → `serverLogger.error/info` (importé depuis `@/lib/server-logger`). Ajouter `userId` dans le contexte quand disponible.
2. **React editor** : remplacer `console.log` → `useLogger({ component: 'EditorCanvas' })` + `logger.debug(...)` (pattern déjà en place dans `use-document-save.ts`).
3. **Python** : script sed `print(...)` → `_logger.debug(...)` dans chaque router (ajouter `import logging; _logger = logging.getLogger(__name__)` en tête).
4. Ajouter une règle ESLint `no-console: error` dans `apps/web/.eslintrc` + règle ruff `T201` (print statements) dans `pyproject.toml`.
**Fichiers touchés** : ~16 TS routes + 2 editor files + 15+ fichiers Python api/v1 + 2 fichiers config lint
**Effort** : M (0.5-1j, scriptable partiellement)
**Agent** : 2 agents en parallèle (`frontend-react` pour TS, `backend-laravel` pour Python)
**Zone orchestration** : A (TS routes) + B (Python) + E (editor)
**Tests à ajouter** : Lint rule active — vérifier que la CI bloque un nouveau `console.log` ou `print()`.
**Critères de succès** : `grep -rn 'console\.\(log\|error\)' apps/web/src/app/api/pdf/` → 0. `grep -rn '^\s*print(' app/api/v1/` → 0.

---

### P1-23 + P1-24 + P1-25 — Headers nginx alignés (TLSv1.3 only, HSTS, X-XSS-Protection)
**Source** : rapports 02, 14 (P1-001, P1-002, P1-003)
**Problème concret** :
- `ssl_protocols TLSv1.2 TLSv1.3` — TLSv1.2 expose à BEAST/LUCKY13
- HSTS incohérent : nginx `max-age=63072000` sans `includeSubDomains`, Next.js `max-age=31536000; includeSubDomains`
- `X-XSS-Protection "1; mode=block"` déprécié (dangereux sur IE legacy)
**Fix** :
```nginx
# deploy/nginx.conf (les 2 blocs server www + api)
ssl_protocols TLSv1.3;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-XSS-Protection "0" always;

# Sur le bloc api.giga-pdf.com uniquement
add_header X-Frame-Options "DENY" always;  # remplace SAMEORIGIN
```
Puis **supprimer** le header HSTS du `next.config.ts` (nginx est autoritaire maintenant).
**Fichiers touchés** : `deploy/nginx.conf` + `apps/web/next.config.ts`
**Effort** : XS (< 30min)
**Agent** : `devops-infra`
**Zone orchestration** : C
**Tests à ajouter** : Après deploy staging, `curl -I https://staging.giga-pdf.com` → vérifier HSTS preload + TLSv1.3 only (`testssl.sh` ou `ssllabs`).
**Critères de succès** : 1 seul header HSTS, `testssl.sh` rating A+ en staging.

---

## BATCH 4 — Performance, type safety, packages (4 tâches parallèles)

### P1-16 — Fix RT-02 : text-renderer respecte originalFont (3 tests RED)
**Source** : rapport 11 (P1-002)
**Problème concret** : `packages/pdf-engine/src/render/text-renderer.ts` L50-98 (`resolveFont`) ignore `element.style.originalFont` quand `FONT_EMBED_CUSTOM_ENABLED=false` et fait un fallback silencieux sur Helvetica via `resolveStandardFont()`. Aucun warning émis. 3 tests `text-renderer-original-font.test.ts` RED.
**Fix** :
1. Dans `resolveFont()`, quand `originalFont !== null` et `FONT_EMBED_CUSTOM_ENABLED === false`, émettre `engineLogger.warn('[text-renderer] originalFont ignored (custom font embedding disabled)', { fontFamily, originalFont })`.
2. Dans les tests, corriger le spy : `vi.spyOn(process.stderr, 'write')` (le logger écrit sur stderr, pas console).
**Fichiers touchés** : `packages/pdf-engine/src/render/text-renderer.ts` + `packages/pdf-engine/__tests__/render/text-renderer-original-font.test.ts`
**Effort** : S (1-2h)
**Agent** : pdf-engine specialist
**Zone orchestration** : D
**Tests à ajouter** : Les 3 tests RED doivent passer au GREEN. Ajouter un test : originalFont préservé quand `FONT_EMBED_CUSTOM_ENABLED=true`.
**Critères de succès** : `pnpm -F @giga-pdf/pdf-engine test text-renderer-original-font` → tous verts.

---

### P1-21 + P1-22 — Performance : pikepdf.open unique + async offload
**Source** : rapport 10 (P1-001, P1-002)
**Problème concret** :
- `upload_document` appelle `engine.get_page(document_id, i+1)` dans une boucle → `pikepdf.open(io.BytesIO(pdf_bytes))` N fois pour N pages. PDF 100 pages = 101 ouvertures pikepdf séquentielles.
- Les endpoints `POST /storage/documents` et `POST /storage/documents/{id}/versions` sont `async def` mais `pikepdf.open()` synchrone bloque l'event loop.
**Fix** :
```python
# app/services/document_service.py — passe unique
with pikepdf.open(io.BytesIO(pdf_bytes_for_parsing)) as pdf:
    for i, page in enumerate(pdf.pages):
        mb = page.MediaBox
        w = float(mb[2]) - float(mb[0])
        h = float(mb[3]) - float(mb[1])
        rotation = int(page.get("/Rotate", 0))
        pages.append(PageObject(...))

# app/api/v1/storage.py — offload synchrone
import asyncio
page_count = await asyncio.to_thread(_count_pages_sync, pdf_bytes)
```
Supprimer `PDFEngine.get_page()` (0 caller après ce fix).
**Fichiers touchés** : `app/core/pdf_engine.py`, `app/services/document_service.py`, `app/api/v1/storage.py`, `app/repositories/document_repo.py`
**Effort** : S (1-2h)
**Agent** : Python backend
**Zone orchestration** : B
**Tests à ajouter** : Bench — upload PDF 100 pages doit être < 2× le temps d'un PDF 10 pages. Test httpx AsyncClient 10 uploads simultanés < 10× temps d'un upload seul.
**Critères de succès** : PDF 200 pages upload < 5s (vs estimation actuelle 20-30s).

---

### P1-26 + P1-27 + P2-61 — Systemd hardening (MemoryMax + StartLimit + logrotate)
**Source** : rapport 14 (P1-005, P1-006, P2-002)
**Problème concret** :
- Aucun `MemoryMax` sur les services systemd → PDF-bomb 5000 pages OOM-kill le VPS entier
- `Restart=always` sans `StartLimitBurst` → busy-loop CPU infini si service crashe au boot
- Pas de logrotate → `/var/log/gigapdf/*.log` en append illimité sature le FS
**Fix** :
```ini
# deploy/systemd/gigapdf-api.service (et les 4 autres services)
[Service]
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5
MemoryHigh=4G
MemoryMax=6G         # 2G pour api, 6G pour celery, 4G pour celery-billing, 2G pour web, 2G pour admin
MemorySwapMax=0
```
Créer `deploy/logrotate/gigapdf` avec `daily, rotate 14, compress, delaycompress, missingok, notifempty`.
**Fichiers touchés** : 5 fichiers `.service` + 1 nouveau `deploy/logrotate/gigapdf`
**Effort** : S (1-2h, calibration des MemoryMax requise)
**Agent** : `devops-infra`
**Zone orchestration** : C
**Tests à ajouter** : Simuler OOM sur staging (PDF-bomb) — vérifier que systemd kill uniquement le worker, pas le VPS.
**Critères de succès** : `systemctl show gigapdf-api | grep MemoryMax` retourne 6G. `/etc/logrotate.d/gigapdf` existe.

---

### P1-17 — flattenAnnotations : implémenter réellement ou renommer
**Source** : rapport 11 (P1-003)
**Problème concret** : `packages/pdf-engine/src/render/flatten.ts` — `flattenAnnotations()` appelle uniquement `markDirty()` sans supprimer les annotations natives du document PDF. Un consommateur qui appelle `flattenAnnotations()` avant export pense neutraliser les highlights/notes, mais ils restent présents dans le PDF exporté.
**Fix** : Option A (correcte) — supprimer réellement les annotations natives via pdf-lib :
```typescript
import { PDFName } from 'pdf-lib';

export async function flattenAnnotations(handle: PDFDocumentHandleInternal): Promise<void> {
  const pages = handle._pdfDoc.getPages();
  for (const page of pages) {
    page.node.delete(PDFName.of('Annots'));
  }
  markDirty(handle);
}
```
**Fichiers touchés** : `packages/pdf-engine/src/render/flatten.ts` + ajout d'un test round-trip
**Effort** : S (1-2h)
**Agent** : pdf-engine specialist
**Zone orchestration** : D
**Tests à ajouter** : round-trip — PDF avec annotation highlight → `flattenAnnotations()` → save → re-parse → 0 annotation.
**Critères de succès** : Test round-trip GREEN.

---

## Synthèse — Ordre d'exécution optimal

| Batch | Parallélisable | Durée estimée | Zones |
|-------|----------------|---------------|-------|
| **Batch 1** (P0 security hotfix) | 4 tâches // | 1 jour | A, B, C, E |
| **Batch 2** (API honesty + bug) | 4 tâches // | 0.5-1 jour | A, B (x3) |
| **Batch 3** (observabilité + infra) | 3 tâches // | 0.5-1 jour | A, B, C |
| **Batch 4** (perf + packages) | 4 tâches // | 0.5-1 jour | B, C, D (x2) |

**Total** : 15 tâches en 4 batches parallèles → ~3 jours de travail coordonné.

**Dépendances** :
- P1-14 (Zod + limite taille) dépend de P0-01 (helpers créés)
- P1-21/P1-22 (perf) dépend de P0-04/P0-05 (modifications du même fichier `pdf_engine.py`)
- Tout le reste est indépendant

---

## Validation post-Batch (critères de Done)

- [ ] `curl -X POST .../api/pdf/encrypt` sans auth → 401
- [ ] Upload PDF 150MB → 413 partout (nginx + Python + Next.js)
- [ ] `grep -rn '"**"' apps/web/next.config.ts` → 0
- [ ] `grep -rn 'sessionStorage' apps/web/src/lib/api.ts` → 0
- [ ] Reorder pages + download → `pikepdf.open(result).pages[0].ObjectNumber == expected`
- [ ] 21 endpoints TODO retournent 501
- [ ] `testssl.sh staging.giga-pdf.com` → A+ rating
- [ ] `grep -rn 'console\.log\|^\s*print(' apps/web/src/app/api/pdf/ app/api/v1/` → 0 (hors serverLogger)
- [ ] Admin panel : user standard → 302 `/login?error=forbidden`
- [ ] Les 3 tests `text-renderer-original-font` → GREEN
- [ ] `systemctl show gigapdf-api | grep MemoryMax` → 6G ou valeur définie
