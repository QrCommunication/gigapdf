# Audit Sécurité OWASP Top 10 — GigaPDF

**Session:** SESSION_20260421_gigapdf_audit  
**Date:** 2026-04-21  
**Auditeur:** security-specialist  
**Stack:** FastAPI Python + Next.js 16 + PostgreSQL + Redis + S3

---

## Résumé Exécutif

| Sévérité | Nombre |
|----------|--------|
| CRITIQUE  | 4      |
| HAUT      | 6      |
| MOYEN     | 7      |
| BAS       | 4      |
| **Total** | **21** |

---

## A01 — Broken Access Control

### CRITIQUE-01 : Absence totale de vérification d'ownership sur les documents
**CVSS:** 9.1 (AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N)  
**Fichier:** `app/api/v1/documents.py` (lignes 466–495, 691–716, 868–876)

Les endpoints `GET /{document_id}`, `GET /{document_id}/download` et `DELETE /{document_id}` utilisent `OptionalUser` (utilisateur facultatif) et ne vérifient jamais que le `user_id` de la session correspond au `owner_id` du document.

```python
# app/api/v1/documents.py:466
async def get_document(
    document_id: str,
    ...
    user: OptionalUser = None,   # Auth optionnelle
) -> APIResponse[dict]:
    # Aucun check owner_id == user.user_id
    document = document_service.get_document(document_id=document_id, ...)
```

Conséquence : tout utilisateur authentifié (ou non authentifié) peut lire, télécharger et supprimer n'importe quel document en devinant l'UUID. IDOR complet sur l'ensemble des documents.

**Remédiation :** Remplacer `OptionalUser` par `AuthenticatedUser` et vérifier `session.owner_id == user.user_id` avant de retourner les données.

---

### CRITIQUE-02 : `tenant_documents.py` — Authentification hard-codée en placeholder
**CVSS:** 9.8 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N)  
**Fichier:** `app/api/v1/tenant_documents.py` (lignes 81–88)

La fonction `get_current_user_id()` retourne systématiquement `"test-user-id"` sans aucune vérification d'identité réelle.

```python
# app/api/v1/tenant_documents.py:81-88
async def get_current_user_id() -> str:
    """Get current authenticated user ID.
    Replace this with your actual authentication mechanism.
    """
    # This is a placeholder - integrate with your auth system
    return "test-user-id"   # CRITIQUE : toutes les requêtes sont "authentifiées"
```

Conséquence : n'importe qui peut partager, modifier ou supprimer les documents de n'importe quel tenant sans authentification. Ce code est clairement non terminé mais exposé en production si `APP_ENV=production` n'est pas correctement vérifié.

**Remédiation :** Supprimer immédiatement ce placeholder. Injecter `AuthenticatedUser` via le système Depends FastAPI existant.

---

### HAUT-01 : Rate limiter ne s'applique qu'avec `user_id=None` (IP uniquement pour les anonymes)
**CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)  
**Fichier:** `app/middleware/rate_limiter.py` (ligne 217)

```python
# app/middleware/rate_limiter.py:217
is_allowed, info = await check_rate_limit(request, user_id=None)
```

Le middleware global passe toujours `user_id=None`, donc le rate limiting s'applique par IP et non par utilisateur. Un attaquant authentifié peut contourner les limites en changeant d'IP (VPN, proxies). Les routes sensibles (upload, export) sont ainsi exploitables indéfiniment par un utilisateur malveillant avec des IPs rotatives.

**Remédiation :** Extraire le `user_id` depuis `request.state` (déjà injecté par `ApiKeyAuthMiddleware`) avant d'appeler `check_rate_limit`.

---

### MOYEN-01 : `user_id` passé en query parameter dans tenant_documents
**CVSS:** 6.5 (AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N)  
**Fichier:** `app/api/v1/tenant_documents.py` (endpoints `/my-tenants`, `/can-access/{documentId}`)

L'URL de documentation indique que `user_id` est passé en query param (`?user_id={userId}`). Même si validé, les query params apparaissent dans les logs serveur, les proxy logs, et l'historique du navigateur — ce qui expose les identifiants utilisateur.

**Remédiation :** L'identité de l'utilisateur doit provenir uniquement du token JWT (header Authorization), jamais d'un paramètre HTTP.

---

## A02 — Cryptographic Failures

### HAUT-02 : SHA-256 sans sel pour le hachage des API keys
**CVSS:** 7.4 (AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N)  
**Fichier:** `app/middleware/api_key_auth.py` (lignes 30–32)

```python
def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()
```

SHA-256 sans sel est vulnérable aux attaques par table arc-en-ciel et dictionnaire. Si la base de données est compromise, les clés API (qui sont des secrets à haute entropie par construction `giga_sk_*`) peuvent être retrouvées plus rapidement via des tables précalculées ou du GPU cracking.

**Remédiation :** Utiliser `hashlib.scrypt` ou `bcrypt` / `argon2` pour les secrets à durée de vie longue, ou à défaut `HMAC-SHA256` avec un secret applicatif distinct stocké en variable d'environnement.

---

### MOYEN-02 : SSL désactivé en développement pour les appels JWKS/BetterAuth
**CVSS:** 5.9 (AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N)  
**Fichier:** `app/middleware/auth.py` (lignes 123–125, 226–227)

```python
verify_ssl = not settings.is_development
async with httpx.AsyncClient(verify=verify_ssl) as client:
```

Si `APP_ENV` n'est pas correctement configuré en production, la vérification SSL est désactivée, ouvrant la porte à des attaques MITM sur la validation des tokens JWT.

**Remédiation :** Forcer `verify=True` inconditionnellement. Utiliser des certificats valides en développement ou configurer un CA de confiance local.

---

### MOYEN-03 : Clés DB en clair dans les valeurs par défaut de `config.py`
**CVSS:** 5.5 (AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N)  
**Fichier:** `app/config.py` (lignes 39, 74–76)

```python
database_url: str = "postgresql://gigapdf:gigapdf@localhost:5432/gigapdf"
celery_result_backend: str = "db+postgresql://gigapdf:gigapdf@localhost:5432/gigapdf_celery"
```

Ces valeurs par défaut avec des credentials hardcodés sont dangereuses si un déploiement oublie de définir les variables d'environnement. La même valeur est reprise dans `.env.example` sans avertissement explicite.

**Remédiation :** Remplacer les valeurs par défaut par `Field(...)` (obligatoire) ou une sentinelle qui lève une exception au démarrage.

---

### BAS-01 : JWT décodé sans vérification en mode dev avec fallback dangereux
**CVSS:** 3.7 (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N)  
**Fichier:** `app/middleware/auth.py` (lignes 282–307)

En mode `dev-mode-no-jwt-required`, n'importe quel token est accepté comme identité sans vérification de signature. Le fallback final utilise le token brut comme `user_id` (tronqué à 255 chars). Risque faible en production mais révèle une surface de risque si `APP_ENV` n'est pas correctement positionné.

**Remédiation :** Documenter clairement que ce code path ne doit jamais atteindre la production. Ajouter une assertion `assert not settings.is_production` dans ce bloc.

---

## A03 — Injection

### MOYEN-04 : XSS potentiel via `htmlToPDF` — HTML non sanitisé passé à Playwright
**CVSS:** 6.1 (AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N)  
**Fichier:** `packages/pdf-engine/src/convert/html-to-pdf.ts` (ligne 53)  
**Fichier:** `apps/web/src/app/api/pdf/convert/route.ts` (lignes 67–75)

```typescript
// route.ts:75
pdfBuffer = await htmlToPDF(html, options);  // html vient directement du body HTTP

// html-to-pdf.ts:53
await page.setContent(html, { waitUntil: 'networkidle' });
```

Le HTML fourni par le client est passé directement à `page.setContent()` dans un contexte Playwright. Bien que Playwright génère un PDF côté serveur, cette exécution du HTML arbitraire dans un navigateur headless peut :
1. Déclencher des requêtes vers des ressources externes (exfiltration d'informations)
2. Exploiter des failles dans Chromium si la version n'est pas à jour
3. Lire des fichiers via `file://` si le contexte Playwright n'est pas correctement isolé

L'endpoint `/api/pdf/convert` ne requiert pas d'authentification d'après le code analysé.

**Remédiation :** Sanitiser le HTML avec DOMPurify (côté serveur via jsdom) avant de le passer à Playwright. Configurer le browser context avec `--disable-file-access-from-files`, `--no-sandbox` désactivé. Ajouter l'authentification sur cet endpoint.

---

### BAS-02 : SQLAlchemy ORM utilisé correctement — Injection SQL non identifiée
**CVSS:** 0.0  
**Fichier:** Ensemble des repositories

L'ORM SQLAlchemy 2.0 avec requêtes paramétrées est correctement utilisé. Aucune injection SQL `raw()` non paramétré détectée dans les fichiers audités. Point positif.

---

## A04 — Insecure Design

### HAUT-03 : SSRF via `urlToPDF` — Absence de filtrage des plages IP privées
**CVSS:** 8.6 (AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:L/A:N)  
**Fichier:** `packages/pdf-engine/src/convert/html-to-pdf.ts` (lignes 71–99)  
**Fichier:** `apps/web/src/app/api/pdf/convert/route.ts` (lignes 76–100)

```typescript
// route.ts:94 — Seul le protocole est vérifié, pas l'adresse cible
if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
  return NextResponse.json({ error: 'url must use http or https protocol.' }, { status: 400 });
}
pdfBuffer = await urlToPDF(url, options);  // Accès à 169.254.x.x, 10.x.x.x, 192.168.x.x, etc.
```

Un attaquant peut soumettre `url: "http://169.254.169.254/latest/meta-data/"` (metadata AWS/Scaleway) ou `url: "http://localhost:6379"` (Redis) ou `url: "http://10.0.0.1/admin"`. Playwright va charger l'URL et en générer un PDF — exfiltrant les données internes dans le document retourné.

Scaleway est l'hébergeur de production (cf. mémoire projet). L'endpoint de métadonnées Scaleway est accessible depuis les instances à `http://169.254.169.254/`.

**Remédiation :**
```typescript
const BLOCKED_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/
];
const hostname = parsedUrl.hostname;
if (BLOCKED_RANGES.some(r => r.test(hostname))) {
  return error('URL points to a private network address');
}
```
Ajouter une whitelist de domaines autorisés si l'usage est connu à l'avance.

---

### MOYEN-05 : Absence de quota/limite sur le Playwright HTML→PDF
**CVSS:** 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L)  
**Fichier:** `apps/web/src/app/api/pdf/convert/route.ts`

Aucune authentification, aucun rate limiting identifié sur cet endpoint. Un attaquant peut envoyer des milliers de requêtes avec du HTML lourd pour épuiser les ressources Playwright (CPU/mémoire).

**Remédiation :** Ajouter l'authentification `AuthenticatedUser`, limiter la taille du body HTML, et appliquer un rate limiting spécifique.

---

## A05 — Security Misconfiguration

### HAUT-04 : Absence de security headers HTTP sur le frontend Next.js
**CVSS:** 7.4 (AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N)  
**Fichier:** `apps/web/next.config.ts`

Le fichier `next.config.ts` ne définit aucun header de sécurité :
- Pas de `Content-Security-Policy`
- Pas de `X-Frame-Options`
- Pas de `X-Content-Type-Options`
- Pas de `Strict-Transport-Security`
- Pas de `Referrer-Policy`
- Pas de `Permissions-Policy`

L'éditeur PDF est un candidat idéal pour le clickjacking (iframe malveillante) sans `X-Frame-Options: DENY` ou `frame-ancestors 'self'`.

**Remédiation :**
```typescript
// next.config.ts
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'nonce-{NONCE}'" },
    ],
  }];
},
```

---

### MOYEN-06 : `images.remotePatterns` avec wildcard `hostname: "**"` dans Next.js
**CVSS:** 4.3 (AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N)  
**Fichier:** `apps/web/next.config.ts` (ligne 29)

```typescript
images: {
  remotePatterns: [{ protocol: "https", hostname: "**" }],
},
```

Cette configuration autorise Next.js Image Optimization à proxifier n'importe quelle image HTTPS d'Internet, y compris des sites malveillants, des images de tracking ou des ressources internes. Peut servir de proxy open pour du hotlinking ou de la fuite d'informations via les métadonnées d'images.

**Remédiation :** Restreindre à la liste des domaines utilisés : S3 Scaleway (`s3.fr-par.scw.cloud`), CDN propre, avatars.

---

### BAS-03 : Docs OpenAPI accessibles sans authentification en production
**CVSS:** 2.7 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)  
**Fichier:** `app/main.py` (lignes 292–293)

```python
docs_url="/api/docs",
redoc_url="/api/redoc",
```

Ces URLs sont exemptées de l'authentification (voir `EXEMPT_PATHS` dans tous les middlewares). En production, exposer la documentation complète de l'API permet à un attaquant de comprendre précisément la surface d'attaque.

**Remédiation :** Désactiver ou protéger par IP/authentification en production : `docs_url=None if settings.is_production else "/api/docs"`.

---

## A06 — Vulnerable Components

### MOYEN-07 : Aucun audit automatique de dépendances dans le pipeline
**CVSS:** N/A (Risque opérationnel)  
**Fichier:** Configuration CI/CD non auditée dans ce scope

Aucun fichier `.github/workflows/` ou équivalent n'a été trouvé pour les scans de dépendances (`pnpm audit`, `pip-audit` / `safety`). Les dépendances critiques méritent une surveillance active :

| Package | Version | Risque |
|---------|---------|--------|
| `playwright` | 1.50.1 | Chromium embarqué — CVEs réguliers sur le moteur de rendu |
| `pdfjs-dist` | 4.10.38 | Parsing PDF — surface XSS dans le viewer |
| `node-forge` | 1.3.1 | Cryptographie — vérifier CVE-2022-24771 (corrigé dans 1.3.0, ok) |
| `python-jose` | inconnu | JWT — CVE-2024-33663 (HS256 avec clé publique RSA) |

**Remédiation :** Ajouter en CI :
```bash
pnpm audit --audit-level=high
pip-audit -r requirements.txt
```

---

## A07 — Authentication Failures

### HAUT-05 : `JWTAuthMiddleware.dispatch()` ne fait rien — Auth uniquement par dependency injection
**CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)  
**Fichier:** `app/middleware/auth.py` (lignes 67–89)

```python
async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
    # Tous les checks sont présents...
    # ...mais le middleware se contente de passer call_next()
    return await call_next(request)   # Pas de vérification effective ici
```

Le middleware JWT est enregistré mais ne fait rien. L'authentification repose entièrement sur les dépendances `AuthenticatedUser` / `OptionalUser` injectées dans chaque route. Or, comme démontré en A01, de nombreuses routes utilisent `OptionalUser` (auth facultative), rendant ces routes accessibles sans token.

Conséquence : le modèle de sécurité est "opt-in par route" plutôt que "opt-out par exception". Une route oubliée avec `OptionalUser` est une route non protégée.

**Remédiation :** Implémenter une liste blanche de routes publiques dans le middleware JWT et bloquer toutes les autres requêtes sans token valide, avec une exception explicite pour les routes embed (publishable key).

---

### MOYEN-08 : Logs des claims JWT complets en DEBUG (données PII)
**CVSS:** 5.5 (AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N)  
**Fichier:** `app/middleware/auth.py` (ligne 198)

```python
logger.debug(f"JWT decoded successfully, claims: {claims}")
```

Le payload JWT complet (incluant email, nom, rôles) est logué en DEBUG. Si le niveau de logs est `DEBUG` en production (ce qui peut arriver via `APP_DEBUG=true`), ces informations PII apparaissent dans les logs système.

**Remédiation :**
```python
logger.debug(f"JWT decoded successfully for sub: {claims.get('sub')}")
```

---

### BAS-04 : Absence de MFA pour les comptes admin
**CVSS:** N/A (architectural)  
**Fichier:** Configuration better-auth non auditée dans ce scope

L'architecture indique que better-auth gère l'authentification. Aucun MFA n'a été identifié dans le scope audité. Pour une application SaaS manipulant des documents potentiellement confidentiels, le MFA pour les comptes admin est fortement recommandé.

---

## A08 — Software and Data Integrity Failures

### HAUT-06 : Validation du type de fichier uniquement par extension dans embed sessions
**CVSS:** 7.8 (AV:L/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N)  
**Fichier:** `app/api/v1/embed.py` (lignes 69–73)

```python
if not file.filename or not file.filename.lower().endswith(".pdf"):
    raise InvalidOperationError("Only PDF files are supported")
```

La validation du type repose uniquement sur l'extension du filename, qui est contrôlée par l'attaquant. Un fichier renommé `malware.pdf` mais contenant du JavaScript embedé, un XML malformé (XFA attack), ou une bombe de décompression passera cette vérification.

Le endpoint de téléchargement principal (`/documents/upload`) ne montre pas non plus de vérification des magic bytes.

**Remédiation :**
```python
# Vérifier le magic number PDF (%PDF-)
if not content[:5] == b'%PDF-':
    raise InvalidOperationError("File is not a valid PDF")
# Limiter la taille
if len(content) > 100 * 1024 * 1024:
    raise InvalidOperationError("File too large")
```
Utiliser également `python-magic` pour la détection MIME basée sur le contenu.

---

## A09 — Security Logging and Monitoring Failures

### MOYEN-09 : Absence d'audit trail pour les accès aux documents
**CVSS:** 5.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N)  
**Fichier:** `app/api/v1/documents.py`, `app/api/v1/storage.py`

Aucun log d'audit n'est émis lors des accès aux documents (lecture, téléchargement, suppression). Seuls les logs applicatifs standard sont présents. Il est impossible de déterminer a posteriori qui a accédé à quel document, ce qui est problématique pour la conformité RGPD (droit d'accès, traçabilité).

Le service `activity_service` est importé dans `storage.py` mais pas dans `documents.py`.

**Remédiation :** Étendre `activity_service` pour logger : `{user_id, document_id, action, ip_address, timestamp}` sur tous les accès aux documents.

---

## A10 — Server-Side Request Forgery (SSRF)

*(Voir HAUT-03 ci-dessus — finding principal sur SSRF via `urlToPDF`)*

### MOYEN-10 : Absence de vérification DNS rebinding dans `urlToPDF`
**CVSS:** 6.5 (AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N)  
**Fichier:** `packages/pdf-engine/src/convert/html-to-pdf.ts`

Même avec un filtrage des plages IP ajouté (remédiation de HAUT-03), une attaque DNS rebinding peut contourner la vérification : le domaine résout d'abord vers une IP publique valide pour passer la validation, puis rebind vers `127.0.0.1` au moment où Playwright charge la page.

**Remédiation :** Configurer Playwright pour utiliser un DNS resolver strict qui refuse la résolution d'hostnames publics vers des IPs privées. Alternativement, utiliser un proxy réseau dédié pour les requêtes Playwright avec des ACLs réseau.

---

## Spécifique PDF — Vecteurs d'Attaque PDF

### CRITIQUE-03 : PDF avec JavaScript embarqué non bloqué
**CVSS:** 8.8 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N)  
**Fichier:** `app/core/parser.py`, `packages/pdf-engine/src/`

Le code de parsing ne désactive pas l'exécution JavaScript dans les PDFs. Les PDFs peuvent contenir du JavaScript (PDF JavaScript API) qui est exécuté par les lecteurs PDF et potentiellement par pdf.js côté client. Un PDF malveillant pourrait :
1. Exécuter du code JavaScript via pdf.js dans le navigateur de la victime (XSS)
2. Effectuer des appels réseau depuis le contexte pdf.js
3. Accéder aux propriétés du DOM si pdf.js n'est pas sandboxé

pdf.js 4.x désactive le JavaScript PDF par défaut, mais il faut vérifier la configuration de rendu.

**Remédiation :** S'assurer que `enableXfa: false` et `isEvalSupported: false` sont configurés dans les options de chargement pdf.js. Implémenter un scan des PDFs uploadés pour détecter les payloads JavaScript.

---

### CRITIQUE-04 : Validation de taille insuffisante — Bombe PDF possible
**CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)  
**Fichier:** `app/config.py` (ligne 83), `app/services/document_service.py` (ligne 71)

```python
max_upload_size_mb: int = 500   # config.py:83
max_pages_per_document: int = 5000  # config.py:85
```

Une limite à 500 Mo et 5 000 pages est vérifiée, mais ces checks n'empêchent pas les PDF "zip bomb" ou les PDFs avec des graphiques vectoriels récursifs qui se décompressent en gigaoctets en mémoire lors du parsing. Un PDF de quelques Mo peut générer plusieurs Go en mémoire (attaque par bombe de décompression PDF / nested stream).

La vérification est faite **après** avoir lu l'intégralité du fichier en mémoire (`file_data = await file.read()` ligne 241 de documents.py).

**Remédiation :**
1. Limiter la taille du fichier **avant** lecture complète via `UploadFile.size` ou lecture par chunks
2. Implémenter un timeout sur le parsing (Celery task timeout existant : `job_timeout_seconds=3600` — trop long)
3. Utiliser des limites de mémoire pour les workers de parsing via cgroups/ulimit

---

## Tableau Récapitulatif

| ID | Catégorie | Sévérité | CVSS | Fichier Principal | Ligne |
|----|-----------|----------|------|-------------------|-------|
| CRITIQUE-01 | A01 Broken Access Control | CRITIQUE | 9.1 | `app/api/v1/documents.py` | 466, 691, 868 |
| CRITIQUE-02 | A01 Broken Access Control | CRITIQUE | 9.8 | `app/api/v1/tenant_documents.py` | 81-88 |
| CRITIQUE-03 | PDF Specific | CRITIQUE | 8.8 | `packages/pdf-engine/src/` | — |
| CRITIQUE-04 | PDF Specific | CRITIQUE | 7.5 | `app/services/document_service.py` | 71 |
| HAUT-01 | A01 Broken Access Control | HAUT | 7.5 | `app/middleware/rate_limiter.py` | 217 |
| HAUT-02 | A02 Cryptographic Failures | HAUT | 7.4 | `app/middleware/api_key_auth.py` | 30-32 |
| HAUT-03 | A10 SSRF | HAUT | 8.6 | `apps/web/src/app/api/pdf/convert/route.ts` | 84-100 |
| HAUT-04 | A05 Security Misconfiguration | HAUT | 7.4 | `apps/web/next.config.ts` | — |
| HAUT-05 | A07 Auth Failures | HAUT | 7.5 | `app/middleware/auth.py` | 67-89 |
| HAUT-06 | A08 Data Integrity | HAUT | 7.8 | `app/api/v1/embed.py` | 69-73 |
| MOYEN-01 | A01 Broken Access Control | MOYEN | 6.5 | `app/api/v1/tenant_documents.py` | query params |
| MOYEN-02 | A02 Cryptographic Failures | MOYEN | 5.9 | `app/middleware/auth.py` | 123, 226 |
| MOYEN-03 | A02 Cryptographic Failures | MOYEN | 5.5 | `app/config.py` | 39, 74-76 |
| MOYEN-04 | A03 Injection | MOYEN | 6.1 | `packages/pdf-engine/src/convert/html-to-pdf.ts` | 53 |
| MOYEN-05 | A04 Insecure Design | MOYEN | 5.3 | `apps/web/src/app/api/pdf/convert/route.ts` | — |
| MOYEN-06 | A05 Security Misconfiguration | MOYEN | 4.3 | `apps/web/next.config.ts` | 29 |
| MOYEN-07 | A06 Vulnerable Components | MOYEN | N/A | CI/CD pipeline | — |
| MOYEN-08 | A07 Auth Failures | MOYEN | 5.5 | `app/middleware/auth.py` | 198 |
| MOYEN-09 | A09 Logging/Monitoring | MOYEN | 5.3 | `app/api/v1/documents.py` | — |
| MOYEN-10 | A10 SSRF | MOYEN | 6.5 | `packages/pdf-engine/src/convert/html-to-pdf.ts` | — |
| BAS-01 | A02 Cryptographic Failures | BAS | 3.7 | `app/middleware/auth.py` | 282-307 |
| BAS-02 | A03 Injection | BAS | 0.0 | Repositories SQLAlchemy | — |
| BAS-03 | A05 Security Misconfiguration | BAS | 2.7 | `app/main.py` | 292-293 |
| BAS-04 | A07 Auth Failures | BAS | N/A | Architecture | — |

---

## Priorité de Remédiation

### Immédiat (avant prochaine mise en production)
1. **CRITIQUE-02** — Supprimer le placeholder `"test-user-id"` dans `tenant_documents.py`
2. **CRITIQUE-01** — Ajouter la vérification d'ownership sur tous les endpoints document
3. **HAUT-03** — Filtrer les IPs privées dans `urlToPDF` (protection SSRF)
4. **HAUT-06** — Valider les magic bytes PDF à l'upload

### Court terme (sprint suivant)
5. **HAUT-04** — Ajouter les security headers dans `next.config.ts`
6. **HAUT-05** — Implémenter l'auth middleware de façon bloquante ou adopter une politique "secure by default"
7. **CRITIQUE-04** — Limiter la mémoire allouée au parsing PDF, lecture par chunks
8. **CRITIQUE-03** — Vérifier la configuration pdf.js (XFA/JavaScript disabled)

### Moyen terme
9. **HAUT-02** — Remplacer SHA-256 nu par HMAC-SHA256 pour les API keys
10. **MOYEN-04** — Sanitiser le HTML avant passage à Playwright
11. **MOYEN-09** — Audit trail sur tous les accès documents
12. **MOYEN-07** — Intégrer `pnpm audit` et `pip-audit` au CI/CD
