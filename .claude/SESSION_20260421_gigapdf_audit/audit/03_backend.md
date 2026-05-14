# Audit Backend GigaPDF — SESSION_20260421

**Date**: 2026-04-21
**Scope**: API Python/FastAPI, Auth, PDF Processing, Storage, DB, Queues, Middleware

---

## 1. Stack Backend

| Composant | Technologie | Version min |
|-----------|-------------|-------------|
| Framework | FastAPI | 0.109+ |
| Serveur ASGI | Uvicorn + standard extras | 0.27+ |
| Langage | Python | 3.12 |
| Validation | Pydantic v2 + pydantic-settings | 2.5+ |
| ORM | SQLAlchemy async | 2.0+ |
| Migrations | Alembic | 1.13+ |
| DB driver | asyncpg (async) + psycopg2-binary (sync) | 0.29+ |
| Base de données | PostgreSQL | (non spécifié, cible 17) |
| Cache / broker | Redis | 5.0+ |
| Queue async | Celery | 5.3+ |
| PDF engine (Python) | pikepdf (MIT) + pdfplumber | 8.0+ / 0.10+ |
| PDF engine (TS) | @giga-pdf/pdf-engine (TypeScript, packages/) | interne |
| OCR | pytesseract + Tesseract 5 | 0.3.10+ |
| Temps réel | python-socketio (Socket.IO) | 5.10+ |
| Paiements | stripe | 7.0+ |
| Stockage objet | boto3 (Scaleway S3 fr-par) | 1.34+ |
| Auth JWT | python-jose[cryptography] | 3.3+ |
| Auth session | Better Auth (service Node.js externe) | — |
| HTTP client | httpx | 0.26+ |
| Chiffrement | cryptography (AES-256-GCM) | 42.0+ |

**Note critique**: Le module `PDFEngine` (app/core/pdf_engine.py) et `PDFParser` (app/core/parser.py) sont tous les deux **marqués DEPRECATED**. La vraie logique PDF est désormais dans le package TypeScript `packages/pdf-engine`. Les workers Python continuent d'importer ces classes comme shim de compatibilité, mais le cœur du traitement est en TypeScript.

---

## 2. API Endpoints — Liste Exhaustive

Préfixe global: `/api/v1`

### Documents (`/documents`)
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/documents/upload` | `documents.upload_document` | Upload PDF, parse, créer session |
| GET | `/documents/{id}` | `documents.get_document` | Récupérer le document parsé |
| DELETE | `/documents/{id}` | `documents.delete_document` | Supprimer session |
| GET | `/documents/{id}/download` | `documents.download_document` | Télécharger le PDF |
| POST | `/documents/{id}/unlock` | `documents.unlock_document` | Déverrouiller PDF chiffré |

### Pages (`/documents/{document_id}/pages`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/pages` | Lister les pages |
| POST | `/pages` | Ajouter une page |
| GET | `/pages/{page_num}` | Récupérer une page |
| PUT | `/pages/{page_num}` | Modifier une page |
| DELETE | `/pages/{page_num}` | Supprimer une page |
| POST | `/pages/reorder` | Réordonner les pages |
| POST | `/pages/{page_num}/rotate` | Rotation de page |
| POST | `/pages/{page_num}/resize` | Redimensionner une page |
| GET | `/pages/{page_num}/preview` | Prévisualisation image |

### Elements (`/documents/{document_id}`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/elements` | Lister les éléments |
| POST | `/elements` | Créer un élément |
| GET | `/elements/{element_id}` | Récupérer un élément |
| PUT | `/elements/{element_id}` | Modifier un élément |
| DELETE | `/elements/{element_id}` | Supprimer un élément |
| POST | `/elements/{element_id}/duplicate` | Dupliquer |
| POST | `/elements/{element_id}/move` | Déplacer |
| POST | `/elements/bulk` | Actions en masse |

### History (`/documents/{document_id}/history`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/history` | Récupérer l'historique undo/redo |
| POST | `/history/undo` | Annuler |
| POST | `/history/redo` | Rétablir |
| DELETE | `/history` | Effacer l'historique |

### Text Operations (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{id}/text/search` | Chercher du texte |
| POST | `/{id}/text/replace` | Remplacer du texte |
| GET | `/{id}/text/extract` | Extraire tout le texte |
| POST | `/{id}/text/ocr` | Lancer OCR |

### Forms (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{id}/forms/fields` | Lister les champs |
| PUT | `/{id}/forms/fields/{field_id}` | Remplir un champ |
| POST | `/{id}/forms/flatten` | Aplatir les formulaires |
| POST | `/{id}/forms/fields` | Créer un champ |

### Annotations (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{id}/annotations` | Lister les annotations |
| POST | `/{id}/annotations` | Créer une annotation |
| PUT | `/{id}/annotations/{ann_id}` | Modifier |
| DELETE | `/{id}/annotations/{ann_id}` | Supprimer |

### Layers (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{id}/layers` | Lister les layers OCG |
| PUT | `/{id}/layers/{layer_id}` | Modifier un layer |
| POST | `/{id}/layers/{layer_id}/toggle` | Afficher/masquer |

### Bookmarks (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{id}/bookmarks` | Arbre des signets |
| POST | `/{id}/bookmarks` | Créer un signet |
| PUT | `/{id}/bookmarks/{bm_id}` | Modifier |
| DELETE | `/{id}/bookmarks/{bm_id}` | Supprimer |

### Export (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/{id}/export/pdf` | Exporter en PDF |
| POST | `/{id}/export/png` | Exporter en PNG |
| POST | `/{id}/export/jpeg` | Exporter en JPEG |
| POST | `/{id}/export/html` | Exporter en HTML |
| POST | `/{id}/export/docx` | Exporter en DOCX |
| GET | `/{id}/export/{job_id}/download` | Télécharger export |

### Security (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/{id}/security/encrypt` | Chiffrer le PDF |
| POST | `/{id}/security/decrypt` | Déchiffrer le PDF |
| PUT | `/{id}/security/permissions` | Modifier les permissions |

### Merge & Split (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/merge` | Fusionner plusieurs PDFs |
| POST | `/{id}/split` | Séparer le PDF |
| POST | `/{id}/split/extract` | Extraire des pages |

### PDF Modification (`/documents`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/{id}/modify/watermark` | Ajouter un watermark |
| POST | `/{id}/modify/header-footer` | En-tête/pied de page |
| POST | `/{id}/modify/background` | Arrière-plan |
| POST | `/{id}/modify/crop` | Rogner une page |

### Jobs (`/jobs`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{job_id}` | Statut d'un job async |
| GET | `/` | Lister mes jobs |
| DELETE | `/{job_id}` | Annuler un job |

### Storage (`/storage`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/save` | Sauvegarder un document |
| GET | `/documents` | Lister mes documents |
| GET | `/documents/{stored_id}` | Charger un document |
| PUT | `/documents/{stored_id}` | Mettre à jour |
| DELETE | `/documents/{stored_id}` | Supprimer |
| GET | `/documents/{stored_id}/versions` | Historique des versions |
| POST | `/documents/{stored_id}/restore/{version}` | Restaurer une version |
| GET | `/folders` | Lister les dossiers |
| POST | `/folders` | Créer un dossier |
| PUT | `/folders/{folder_id}` | Renommer |
| DELETE | `/folders/{folder_id}` | Supprimer |

### Quota (`/quota`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Quotas de l'utilisateur courant |

### Plans (`/plans`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Lister les plans disponibles |

### Billing (`/billing`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Info abonnement courant |
| POST | `/checkout` | Créer session Stripe Checkout |
| POST | `/portal` | Portail client Stripe |
| POST | `/cancel` | Annuler l'abonnement |
| POST | `/trial/start` | Démarrer l'essai |
| POST | `/trial/convert` | Convertir l'essai |

### Public Billing (`/public/billing`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/plans` | Plans publics (no auth) |

### Tenant Documents (`/tenant-documents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Documents partagés dans mon org |
| POST | `/{id}/share` | Partager dans l'org |
| DELETE | `/{id}/share` | Retirer du partage |

### Activity (`/activity`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Journal d'activité de l'utilisateur |
| GET | `/{document_id}` | Activité d'un document |

### Sharing (`/sharing`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/share` | Partager avec un utilisateur par email |
| GET | `/shared-with-me` | Documents partagés avec moi |
| GET | `/my-shares` | Mes partages actifs |
| DELETE | `/shares/{share_id}` | Révoquer un partage |
| PUT | `/shares/{share_id}/permission` | Modifier la permission |
| POST | `/invitations/{token}/accept` | Accepter une invitation |
| POST | `/invitations/{token}/decline` | Décliner |
| POST | `/public-links` | Créer un lien public |
| GET | `/public-links` | Lister les liens publics |
| DELETE | `/public-links/{token}` | Révoquer un lien |

### API Keys (`/api-keys`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Lister mes clés API |
| POST | `/` | Créer une clé API (secret + publishable) |
| PUT | `/{key_id}` | Modifier (name, domains, rate_limit) |
| DELETE | `/{key_id}` | Révoquer |
| POST | `/{key_id}/regenerate` | Régénérer |

### Embed (`/embed`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/sessions` | Créer session embed (pub key requis) |
| GET | `/sessions/{session_id}` | Récupérer session embed |
| POST | `/sessions/{session_id}/complete` | Compléter / récupérer PDF modifié |
| DELETE | `/sessions/{session_id}` | Supprimer session embed |

### Admin (`/admin`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | Stats globales plateforme |
| GET | `/users` | Liste des utilisateurs |
| GET | `/users/{id}` | Détail utilisateur |
| PUT | `/users/{id}` | Modifier un utilisateur |
| DELETE | `/users/{id}` | Supprimer un utilisateur |
| GET | `/documents` | Tous les documents |
| GET | `/jobs` | Tous les jobs |
| GET | `/logs` | Logs d'activité |
| GET/PUT | `/settings` | Paramètres globaux |
| GET | `/tenants` | Tous les tenants |
| GET | `/infrastructure` | Métriques infra |

### Webhooks
| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/stripe` | Réception events Stripe |

### WebSocket
| Protocol | Path | Description |
|----------|------|-------------|
| Socket.IO | `/socket.io` | Collaboration temps réel |

---

## 3. Authentification

### 3.1 Mécanismes

Trois mécanismes d'authentification coexistent:

**JWT (RS256)** — `app/middleware/auth.py:decode_jwt_token()`
- Token Bearer dans l'en-tête `Authorization`
- Clé publique configurée via `AUTH_JWT_PUBLIC_KEY` (valeur PEM ou URL JWKS)
- Si l'URL commence par `http`, fetch JWKS avec cache 5 minutes en mémoire globale
- Algorithme: RS256 configurable
- Verification audience et issuer optionnelles (désactivées si vides)

**Session Better Auth** — `app/middleware/auth.py:validate_session_with_better_auth()`
- Fallback si JWT échoue ou n'est pas configuré
- Appel HTTP à `AUTH_SESSION_URL` (ex: `https://giga-pdf.com/api/auth/get-session`)
- Timeout 10s, pas de retry

**API Key** — `app/middleware/api_key_auth.py`
- En-tête `X-API-Key`
- Deux types: `giga_pk_*` (secret, tous les endpoints) et `giga_pub_*` (publishable, embed uniquement)
- Stocké en SHA-256, jamais en clair
- Validation: is_active, expires_at, allowed_domains
- Rate limiting par clé (sliding window Redis, fenêtre 1 min)

### 3.2 Mode développement — FAILLE CRITIQUE

Fichier: `app/middleware/auth.py:282-307`

```python
if settings.is_development and settings.auth_jwt_public_key == "dev-mode-no-jwt-required":
    # Decode without verification (dev mode only!)
    unverified_claims = jwt.get_unverified_claims(token)
    ...
    # Fallback: use token directly (for simple tokens)
    return CurrentUser(user_id=token[:255], ...)
```

Si `APP_ENV=development` ET `AUTH_JWT_PUBLIC_KEY=dev-mode-no-jwt-required`, n'importe quelle valeur dans le header Authorization est acceptée sans vérification. Ce mode doit être **impossible à activer en production** mais la séparation repose uniquement sur la variable `APP_ENV`.

### 3.3 Clés publiques / privées du widget embed

- Clé secrète: `giga_pk_<32 bytes URL-safe base64>` — stockée en hash SHA-256 dans `api_keys.key_hash`
- Clé publishable: `giga_pub_<32 bytes URL-safe base64>` — stockée en hash SHA-256 dans `api_keys.publishable_key_hash`
- La clé publishable n'est utilisable que sur `/api/v1/embed/*` (enforced dans `ApiKeyAuthMiddleware:195-204`)
- La clé en clair n'est retournée qu'une fois à la création

---

## 4. Authorization

### 4.1 Isolation multi-tenant

- Chaque `StoredDocument` a un `owner_id` (String 255 = user_id du service d'auth externe)
- La vérification de propriété est faite dans les services (ex: `storage_service`, `share_service`)
- Les partages sont dans `document_shares` avec `shared_with_user_id`
- Les accès org passent par `tenant_documents` avec `access_level` (read/write/admin)

### 4.2 Tenant RBAC

Modèle `TenantMember` avec 5 rôles hiérarchiques: `OWNER > ADMIN > MANAGER > MEMBER > VIEWER`

Fichier: `app/models/tenant.py:33-109`

Permissions granulaires (15 valeurs) par rôle, avec override possible via `custom_permissions` (texte CSV).

**Problème**: Le mécanisme `has_permission()` avec `custom_permissions` a un comportement contre-intuitif — si des permissions custom sont définies, les permissions de rôle sont ignorées (pas d'union, c'est un remplacement complet). Cela peut conduire à des configurations d'accès trop restrictives ou trop permissives involontairement.

### 4.3 Endpoints admin sans protection explicite

Les endpoints `/api/v1/admin/*` (users, stats, tenants...) nécessitent une authentification JWT standard. Il n'y a pas de middleware ou guard admin visible dans `app/api/v1/admin/users.py` ou `admin/__init__.py`. La restriction admin repose donc sur ce que le client fournit — aucune vérification de rôle `admin` n'est visible dans le code lu.

### 4.4 Validation de propriété dans les documents partagés

Le partage utilise un token UUID stocké dans `document_shares.share_token` (pour les liens publics). Ce token est de type String(64), généré sans index d'expiration automatique — la vérification de `expires_at` est dans la logique applicative.

---

## 5. Validation des Inputs

### 5.1 Framework

- Pydantic v2 est utilisé pour la validation des corps de requête via des `BaseModel`
- Les paramètres de path/query sont typés (FastAPI les valide automatiquement)
- Les schemas de requêtes sont dans `app/schemas/`

### 5.2 Couverture observée

| Endpoint | Validation |
|----------|-----------|
| Upload PDF | Taille max (config), extension `.pdf` (embed), content-type implicite |
| Save document | `name` min=1 max=255, `folder_id` optionnel |
| Share document | `EmailStr` Pydantic, `permission` Literal["view","edit"], `expires_in_days` ge=1 le=30 |
| Create folder | `name` min=1 max=255 |
| API key create | Pydantic schema avec scopes, rate_limit, domains |
| Auth header | Format `Bearer <token>` vérifié manuellement |

### 5.3 Lacunes

- `document_id` dans les path parameters est accepté comme string sans validation UUID
- Les `tags` dans `SaveDocumentRequest` n'ont pas de limite de nombre ou de longueur par tag
- La validation du `content` du PDF (magic bytes, non seulement l'extension) n'est pas visible dans `embed.py:70-72` — uniquement `.endswith(".pdf")` sur le nom du fichier

---

## 6. PDF Processing

### 6.1 Architecture actuelle (migration en cours)

**Backend Python (DEPRECATED mais actif)**
- `app/core/pdf_engine.py`: shim pikepdf — stocke les bytes bruts, proxy de compatibilité
- `app/core/parser.py`: shim pdfplumber — retourne des scene graphs minimaux avec warnings de dépréciation
- `app/core/ocr.py`: pytesseract — toujours actif

**TypeScript engine (production)**
- `packages/pdf-engine/src/` — le vrai moteur de parsing, rendu, export
- Sous-modules: `parse/`, `render/`, `engine/`, `forms/`, `merge-split/`, `convert/`, `encrypt/`, `preview/`

### 6.2 Librairies PDF

| Lib | Langage | Rôle | Licence |
|-----|---------|------|---------|
| pikepdf | Python | Lecture/écriture PDF bas niveau (ex-PyMuPDF) | MIT |
| pdfplumber | Python | Extraction métadonnées basique (fallback) | MIT |
| pdf2image | Python | Conversion pages en images (OCR) | MIT |
| Pillow | Python | Traitement images | MIT |
| pytesseract | Python | OCR via Tesseract 5 | Apache 2 |
| @giga-pdf/pdf-engine | TypeScript | Moteur principal (parsing, rendu, export) | interne |

**Note**: PyMuPDF (fitz) a été **retiré** (était AGPL — risque copyleft). Transition vers pikepdf (MIT) complétée pour le côté Python.

### 6.3 Opérations asynchrones

Les opérations lourdes (OCR, export, merge) partent en Celery:
- `ocr_tasks.process_ocr` — queue `ocr`, rate limit 10/min
- `export_tasks.export_document` — queue `export`, rate limit 20/min
- `processing_tasks.*` — queue `processing`
- Seuil: `ASYNC_THRESHOLD_MB` (défaut 10 MB)

---

## 7. Storage

### 7.1 Stockage primaire — Scaleway S3

- Région: `fr-par`
- Endpoint: `https://s3.fr-par.scw.cloud`
- Authentification: credentials dans `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)
- Signature: `s3v4`
- SSE activé par défaut (`server_side_encryption=True` dans `upload_file`)

Fichier: `app/services/s3_service.py`

### 7.2 Chiffrement au repos — AES-256-GCM

Fichier: `app/services/encryption_service.py`

Envelope encryption:
1. Génération d'une DEK (Data Encryption Key) unique par document — 256 bits
2. Chiffrement du document avec la DEK (AES-256-GCM)
3. Chiffrement de la DEK avec une KEK (Key Encryption Key) dérivée via PBKDF2 (100 000 itérations)
4. DEK chiffrée stockée dans `document_versions.encryption_key` (base64)

Constantes: `NONCE_SIZE=12`, `TAG_SIZE=16`, `SALT_SIZE=16`, `PBKDF2_ITERATIONS=100_000`

Version byte (`\x01`) pour les upgrades futurs.

### 7.3 Stockage temporaire — Session en mémoire + Redis

- Sessions PDF actives: en mémoire Python (`document_sessions` dict) + Redis pour la persistance cross-worker
- Nommage: UUID v4 généré à l'upload
- Cycle de vie: nettoyé au shutdown (`document_sessions.clear_all()`) ou manuellement

### 7.4 Stockage persistant — Table `stored_documents`

- `file_path` dans `document_versions` pointe vers le chemin S3 ou local
- `file_hash` SHA-256 pour l'intégrité
- Soft delete avec `is_deleted` + `deleted_at`
- Versioning: `current_version` dans `stored_documents`, historique dans `document_versions`

### 7.5 Stockage local (développement)

`STORAGE_PATH=/var/lib/gigapdf/documents` (configurable)

---

## 8. Schéma Base de Données

### Tables principales

| Table | Clé primaire | Relations clés |
|-------|-------------|----------------|
| `stored_documents` | UUID | → `document_versions`, `folders`, `tenant_documents`, `document_shares` |
| `document_versions` | UUID | → `stored_documents` (CASCADE DELETE) |
| `folders` | UUID | → `stored_documents`, self-referential (nested) |
| `user_quotas` | UUID | → `tenant_members` |
| `api_keys` | UUID(String 36) | user_id (String 255, pas de FK vers users) |
| `async_jobs` | UUID | owner_id (String, pas de FK) |
| `collaboration_sessions` | UUID | document_id (UUID, pas de FK vers stored_documents) |
| `element_locks` | UUID | document_id + element_id (unique) |
| `document_shares` | UUID | → `stored_documents`, `document_share_invitations` |
| `document_share_invitations` | UUID | → `stored_documents` |
| `share_notifications` | UUID | → `stored_documents`, `document_share_invitations` |
| `tenants` | UUID(as_uuid=True) | → `plans`, `tenant_members`, `tenant_documents` |
| `tenant_members` | UUID | → `tenants`, `user_quotas` |
| `tenant_documents` | UUID | → `tenants`, `stored_documents` |
| `tenant_invitations` | UUID | → `tenants`, `user_quotas` |
| `plans` | UUID | → `tenants` |
| `activity_logs` | UUID | → `stored_documents` (nullable) |
| `infrastructure_metrics` | Integer (autoincrement) | — |

### Indexes importants

- `api_keys`: idx sur `key_hash` (unique), `publishable_key_hash` (unique), `user_id`, `is_active`
- `stored_documents`: idx sur `owner_id`, `folder_id`, `is_deleted`
- `document_versions`: idx unique sur `(document_id, version_number)`
- `activity_logs`: idx sur `document_id`, `user_id`, `action`, `created_at`, et composite `(document_id, created_at)`
- `element_locks`: idx unique sur `(document_id, element_id)`

### Problèmes de schéma détectés

**UUID inconsistency** — `app/models/tenant.py:234-238`
```python
# Tenant.id : UUID(as_uuid=True)
# TenantMember.user_id : UUID(as_uuid=False) → FK vers user_quotas.id qui est aussi as_uuid=False
```
Les tables `tenants` utilisent `UUID(as_uuid=True)` (retourné comme objet Python `uuid.UUID`) alors que `stored_documents`, `user_quotas`, `api_keys` utilisent `UUID(as_uuid=False)` (string). Mélange qui peut causer des erreurs de comparaison dans les requêtes SQLAlchemy cross-table.

**Absence de FK pour `user_id`** — `async_jobs.owner_id`, `api_keys.user_id`, `collaboration_sessions.user_id` sont tous de type `String(255)` sans FK vers une table `users`. Cohérence assurée uniquement côté applicatif.

---

## 9. Jobs Async / Queues

### 9.1 Celery + Redis

Fichier: `app/tasks/celery_app.py`

| Queue | Tasks | Rate limit |
|-------|-------|-----------|
| `ocr` | `process_ocr` | 10/min |
| `export` | `export_document` | 20/min |
| `processing` | `processing_tasks.*` | — |
| `billing` | `sync_plans_to_stripe`, `process_overdue_payments`, `process_expired_trials`, `send_trial_reminders`, `cleanup_stale_subscriptions` | — |
| `infra` | `collect_metrics`, `cleanup_old_metrics` | — |

### 9.2 Planification Celery Beat

| Tâche | Fréquence |
|-------|-----------|
| `sync-plans-to-stripe` | Toutes les heures |
| `process-overdue-payments` | Toutes les 24h |
| `process-expired-trials` | Toutes les heures |
| `send-trial-reminders` | Toutes les 24h |
| `cleanup-stale-subscriptions` | Toutes les 24h |
| `cleanup-export-files` | Toutes les heures |
| `collect-infrastructure-metrics` | Toutes les 15 min |
| `cleanup-old-metrics` | Toutes les 24h |

### 9.3 Tracking des jobs

Table `async_jobs` avec `celery_task_id`, `status` (pending/processing/completed/failed/cancelled), `progress` (float), `result` (JSON), `error_message`.

Signal handlers `task_postrun` et `task_failure` pour mettre à jour la DB après chaque task.

**Problème**: Le handler `task_postrun` ne traite que les tasks `export_tasks`. Les autres types (OCR, merge, processing) ne mettent pas à jour `async_jobs` via ce signal — il faut vérifier que ces tasks le font explicitement dans leur corps.

---

## 10. Error Handling + Logging

### 10.1 Exception hierarchy

Fichier: `app/middleware/error_handler.py`

Classe de base `GigaPDFException(code, message, status_code, details)` avec sous-classes:
- `PDFParseError` → 400
- `PDFEncryptedError` → 400
- `PDFInvalidPasswordError` → 400
- `PDFCorruptedError` → 400
- `ElementNotFoundError` → 404
- `DocumentNotFoundError` → 404
- `AuthRequiredError` → 401
- `AuthInvalidError` → 401
- `InvalidOperationError` → 400

Handler global installé via `setup_exception_handlers(app)`.

### 10.2 Format de réponse d'erreur

Standardisé:
```json
{
  "success": false,
  "data": null,
  "error": {"code": "...", "message": "...", "details": null},
  "meta": {"request_id": "uuid", "timestamp": "ISO-8601"}
}
```

### 10.3 Logging

- `logging.basicConfig` avec niveau `DEBUG` si `APP_DEBUG=true`, sinon `INFO`
- Pas de log structuré JSON en production (seulement format texte)
- Request ID injecté via `RequestIDMiddleware` et disponible via `get_request_id()`
- Les erreurs sensibles (stack traces) ne sont pas exposées aux clients

---

## 11. Rate Limiting + Quotas

### 11.1 Rate Limiting par endpoint

Fichier: `app/middleware/rate_limiter.py`

Catégories (sliding window Redis):

| Catégorie | Limite | Fenêtre |
|-----------|--------|---------|
| `default` | 100 req | 1 min |
| `upload` | 10 req | 1 min |
| `export` | 20 req | 1 min |
| `ocr` | 5 req | 1 min |
| `auth` | 20 req | 1 min |
| `search` | 30 req | 1 min |

Clé: `user:<user_id>:<category>` si authentifié, sinon `ip:<client_ip>:<category>`

**Problème critique**: Le `RateLimitMiddleware` appelle `check_rate_limit(request, user_id=None)` — le `user_id` est toujours `None` dans le middleware car l'auth n'a pas encore été résolue à ce stade. Cela signifie que le rate limiting est uniquement basé sur l'IP pour **tous les utilisateurs**, même authentifiés.

Fichier: `app/middleware/rate_limiter.py:217`

### 11.2 Quotas mensuels API

Fichier: `app/middleware/api_quota.py`

- Tracking via `quota_service.check_api_quota(user_id)` et `increment_api_calls(user_id)`
- Quota par défaut: 1 000 appels/mois (free), configurable dans `plans`
- **Problème**: Le middleware lit `user_id` depuis `request.state.user_id` (ligne 54), mais l'auth middleware ne peuple pas `request.state.user_id` — l'injection se fait dans `request.state.api_key_user_id` pour les API keys. Pour les JWT, la résolution est faite via `Depends(get_current_user)` dans les routes, pas dans le middleware. Résultat: le quota n'est **jamais vérifié** pour les utilisateurs authentifiés par JWT (uniquement pour ceux authentifiés via API key si le middleware est correctement ordonné).

### 11.3 Rate limiting par API key

Implémenté dans `ApiKeyAuthMiddleware._check_rate_limit()` — sliding window Redis sur `api_key:<key_id>`, limite configurable par clé (défaut: 60 req/min).

---

## 12. Findings

### CRITIQUE

**C1 — Quota middleware non fonctionnel pour les utilisateurs JWT**
- Fichier: `app/middleware/api_quota.py:54`
- `user_id = getattr(request.state, "user_id", None)` est toujours `None` pour les utilisateurs JWT
- Le middleware se résout en no-op pour la majorité des utilisateurs
- Impact: les quotas mensuels ne sont pas enforced pour les utilisateurs JWT
- Correction: peupler `request.state.user_id` dans un middleware d'auth précoce, ou déplacer la logique de quota dans un `Depends()` après résolution de l'auth

**C2 — Rate limiting global basé uniquement sur l'IP**
- Fichier: `app/middleware/rate_limiter.py:217`
- `check_rate_limit(request, user_id=None)` — user_id toujours None
- Contournement trivial: changer d'IP (VPN, rotation proxy) suffit à bypasser
- Impact: aucune protection effective par utilisateur au niveau middleware
- Correction: même correction que C1, ou utiliser un Depends() de rate limit dans chaque route critique

**C3 — Admin endpoints sans vérification de rôle explicite**
- Fichier: `app/api/v1/admin/users.py` (aucun guard dans le code lu)
- Les endpoints `/admin/*` n'ont pas de vérification `is_admin` visible
- Si un attaquant dispose d'un token JWT valide pour un compte non-admin, il peut potentiellement accéder aux endpoints d'administration
- Impact: exposition de toutes les données utilisateurs, modification de plans, suspension de comptes

### HAUT

**H1 — Validation du contenu PDF absente (magic bytes)**
- Fichier: `app/api/v1/embed.py:70-72`
- Seule l'extension du filename est vérifiée (`.endswith(".pdf")`), pas le contenu binaire
- Un fichier malveillant avec l'extension `.pdf` passe la validation
- Impact: risque de polyglot files, attaques via parsers PDF
- Correction: vérifier les magic bytes `%PDF-` dans les premiers 5 bytes

**H2 — Cache JWKS en mémoire globale non thread-safe**
- Fichier: `app/middleware/auth.py:99-129`
- `_jwks_cache` et `_jwks_cache_time` sont des variables globales Python
- Dans un contexte multi-worker Uvicorn, chaque worker a son propre cache — acceptable
- Dans un contexte async avec race conditions, la mise à jour simultanée du cache peut causer des requêtes multiples vers l'endpoint JWKS
- Pas de lock, pas de TTL par clé individuelle
- Correction: utiliser Redis pour le cache JWKS partagé entre workers

**H3 — Mélange UUID(as_uuid=True/False) dans le schéma DB**
- Fichiers: `app/models/tenant.py`, `app/models/database.py`
- Inconsistance systématique entre les tables `tenants` (True) et le reste (False)
- Peut causer des erreurs de comparaison silencieuses dans les jointures SQLAlchemy
- Correction: uniformiser toutes les colonnes UUID vers `as_uuid=False`

**H4 — DEK chiffrée stockée dans la même DB que les données chiffrées**
- Fichier: `app/models/database.py:116-121` (`document_versions.encryption_key`)
- En cas de dump de la DB, l'attaquant a accès aux DEK chiffrées et potentiellement à la KEK (si `APP_SECRET_KEY` est aussi compromise)
- Envelope encryption correcte mais KEK et données dans le même système
- Correction: stocker les DEK dans un KMS séparé (AWS KMS, HashiCorp Vault)

**H5 — `task_postrun` signal couvre uniquement les export tasks**
- Fichier: `app/tasks/celery_app.py:192-197`
- OCR, merge, split ne mettent pas à jour `async_jobs` via le signal
- Risque de jobs bloqués indéfiniment en état `pending` ou `processing`
- Correction: étendre le handler à tous les types ou vérifier que chaque task met à jour son job

### MOYEN

**M1 — SSL verification désactivée en développement**
- Fichier: `app/middleware/auth.py:125`
- `verify_ssl = not settings.is_development`
- Si un développeur pointe sur un endpoint de staging/prod avec `APP_ENV=development`, les certificats ne sont pas vérifiés — MITM possible
- Correction: ne jamais désactiver la vérification SSL, même en dev (utiliser des certificats auto-signés valides)

**M2 — Logs non structurés en production**
- Fichier: `app/main.py:30-33`
- `logging.basicConfig` avec format texte — non parsable par des outils de log management
- Impact: difficile de corréler les logs dans un stack ELK/Datadog
- Correction: utiliser un formatter JSON (python-json-logger, structlog)

**M3 — `custom_permissions` en CSV non typé**
- Fichier: `app/models/tenant.py:249`, `has_permission():267-278`
- Custom permissions stockées en texte CSV, parsées sans validation de type à la lecture
- Une valeur invalide est silencieusement ignorée
- Correction: utiliser un champ JSON ou un Enum SQLAlchemy

**M4 — Token d'invitation en String(255) sans unicité enforced**
- Fichier: `app/models/database.py:282` (`document_share_invitations.token`)
- Marqué `unique=True` en SQLAlchemy mais le token est généré côté applicatif — vérifier que c'est bien un UUID ou token aléatoire

**M5 — `result_expires=3600` Celery — perte de résultats**
- Fichier: `app/tasks/celery_app.py:54`
- Les résultats Celery expirent après 1h
- Si un client poll un job_id plus d'1h après la completion, le résultat est perdu
- Correction: stocker les résultats définitifs dans `async_jobs.result` (DB) et ne pas dépendre du backend Celery pour la persistance

**M6 — CORS en développement: `allow_origin_regex` très permissif**
- Fichier: `app/main.py:343-350`
- `r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"` — accepte tout port sur localhost
- Acceptable pour le dev, mais à s'assurer que `APP_ENV` n'est jamais `development` sur un serveur accessible

### BAS

**B1 — `max_upload_size` dupliqué**
- Config: `MAX_UPLOAD_SIZE_MB=500` (Settings)
- Embed: hard-codé à 100MB (`app/api/v1/embed.py:77`)
- Incohérence entre les deux limites selon le flux d'upload

**B2 — `document_id` non validé en UUID**
- Path parameters `{document_id}` acceptent n'importe quelle string sans validation de format UUID
- Pas d'impact sécurité direct mais peut générer des erreurs DB non traitées proprement

**B3 — `mail_server` par défaut: `smtp.example.com`**
- Fichier: `app/config.py:97`
- Si `MAIL_CONFIGURED` retourne `False`, les emails sont silencieusement ignorés
- Risque: invitations d'organisation et notifications de partage non envoyées sans avertissement visible

**B4 — Infrastructure metrics avec Integer PK (non-UUID)**
- Fichier: `app/models/database.py:682-683`
- `InfrastructureMetric.id` est un Integer autoincrement alors que toutes les autres tables utilisent UUID
- Incohérence mineure, risque de collision si la table est rechargée depuis 0

---

## Synthèse Priorités

| Priorité | Finding | Impact |
|----------|---------|--------|
| CRITIQUE | C1 — Quota bypass JWT | Tous les utilisateurs JWT sans quota enforcement |
| CRITIQUE | C2 — Rate limit IP-only | Protection rate limiting contournable |
| CRITIQUE | C3 — Admin sans guard de rôle | Accès admin avec tout JWT valide |
| HAUT | H1 — Validation PDF magic bytes | Parsing de fichiers malveillants |
| HAUT | H2 — Cache JWKS non thread-safe | Instabilité auth sous charge |
| HAUT | H3 — UUID inconsistency DB | Bugs silencieux sur jointures |
| HAUT | H4 — DEK colocalisée avec données | Compromission chiffrement si dump DB |
| HAUT | H5 — Celery signal partiel | Jobs bloqués indéfiniment |
