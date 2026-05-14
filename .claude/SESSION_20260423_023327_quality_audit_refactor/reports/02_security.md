# 02 — Security Inventory

## Dependabot — résumé

> Note: `pnpm audit` local remonte uniquement 3 vulnérabilités modérées (2 advisories distincts sur 1838 dépendances).
> Les 46 alertes Dependabot mentionnées dans le brief correspondent probablement à des dépendances transitives
> dans d'autres workspaces (apps/admin, apps/mobile) non couverts par ce pnpm audit ou à l'historique des alerts.

| Severity | Count | Fix available |
|----------|-------|---------------|
| Critical | 0 | — |
| High | 0 | — |
| Moderate | 3 | 2 yes (fast-xml-parser → 5.7.0, uuid → 14.0.0 indirect) |
| Low | 0 | — |

**Python (pip-audit):** 0 vulnérabilités connues sur 91 packages audités.

---

## Top 10 vulnérabilités par exploitability × impact

### TypeScript / Node.js

1. **fast-xml-parser@5.5.8** — CVE-2026-41650 — Moderate — CVSS 6.1 (AV:N/AC:L/PR:N/UI:R)
   - XML Comment et CDATA Injection via délimiteurs non-échappés dans XMLBuilder
   - Vecteur: XSS en contexte SVG/HTML, injection SOAP, empoisonnement flux RSS
   - Chemin: `packages__s3 > @aws-sdk/client-s3 > @aws-sdk/core > @aws-sdk/xml-builder > fast-xml-parser`
   - Fix: Upgrade `@aws-sdk/client-s3` (qui embarque fast-xml-parser ≥ 5.7.0)
   - Advisory: https://github.com/advisories/GHSA-gh4j-gqv2-49f6
   - Impact sur GigaPDF: indirect (AWS SDK XML builder) — exploitable uniquement si du contenu utilisateur alimente les commentaires/CDATA XML AWS

2. **uuid@7.0.3** — GHSA-w5hq-g745-h8pq — Moderate — CVSS N/A
   - Buffer bounds check absent sur v3/v5/v6 — écriture partielle silencieuse dans les buffers caller-provided
   - Chemins: `apps__mobile > expo > @expo/config-plugins > xcode > uuid` ET `apps__web > @sentry/nextjs > @sentry/webpack-plugin > uuid`
   - Fix: Upgrade vers uuid ≥ 14.0.0 (transitif, via mise à jour expo / @sentry/nextjs)
   - Advisory: https://github.com/advisories/GHSA-w5hq-g745-h8pq
   - Impact sur GigaPDF: très faible (build-time uniquement, pas runtime production)

3. **uuid@9.0.1** — même advisory GHSA-w5hq-g745-h8pq — Moderate
   - Chemin: `apps__web > @sentry/nextjs > @sentry/webpack-plugin > uuid`
   - Fix: Identique, transitif via @sentry/nextjs

### Python

4. **python-jose@3.5.0** — Pas dans pip-audit CVE DB actuellement mais classe à haut risque
   - python-jose est unmaintained (dernière release 2022) ; alternatives recommandées : `PyJWT` ou `python-jwt`
   - Utilisé pour la vérification JWT dans `app/middleware/auth.py` et `app/api/v1/embed.py`
   - Le package `ecdsa` (0.19.2) utilisé en dépendance de python-jose a des problèmes historiques de timing attacks
   - Risque: medium — utilisé dans le chemin critique d'authentification

5. **ecdsa@0.19.2** — Risque timing attack
   - Dépendance de python-jose, utilisé pour les opérations cryptographiques ECDSA
   - Connu pour avoir des vulnérabilités de canal latéral (timing) sur les vérifications de signature
   - Lié aux CVEs historiques CVE-2024-23342 (timing attack sur ecdsa)

---

## Secrets accidentels détectés

**Aucun secret réel commité.** Les occurrences trouvées sont des exemples/templates documentaires :

| Fichier | Ligne | Type | Nature |
|---------|-------|------|--------|
| `docs/guides/DEPLOYMENT.md` | 675 | `sk_live_your-live-key` | Placeholder, pas un vrai secret |
| `docs/security/SECRETS_ROTATION_PLAYBOOK.md` | 225 | `sk_live_...` | Documentation d'exemple |
| `docs/security/secrets-management.md` | 22, 134, 168, 278 | `sk_live_...` | Exemples dans doc |
| `README.md` | 248 | `sk_live_xxx` | Placeholder template |

**Aucun token AWS (AKIA...), GitHub (ghp_), ni JWT entier codé en dur détecté.**

**Fichiers .env committés:** Uniquement des `.env.example` (5 fichiers) — correct, pas de secrets réels.

---

## Routes sans authentification

### Routes PDF Next.js — ARCHITECTURE A ANALYSER

Les routes suivantes dans `apps/web/src/app/api/pdf/` **ne contiennent aucune vérification d'auth** explicite dans les 30 premières lignes :

| Route | Risque | Commentaire |
|-------|--------|-------------|
| `/api/pdf/annotations` | Moyen | Traitement PDF côté serveur sans auth — abus potentiel CPU/bandwidth |
| `/api/pdf/text` | Moyen | Même problème |
| `/api/pdf/apply-elements` | Moyen | Même problème |
| `/api/pdf/shape` | Moyen | Même problème |
| `/api/pdf/encrypt` | Haut | Opérations de chiffrement/déchiffrement PDF sans auth = service gratuit pour attaquants |
| `/api/pdf/save` | Moyen | Garbage collection PDF sans auth |
| `/api/pdf/preview` | Moyen | Sans auth |
| `/api/pdf/image` | Moyen | Sans auth |
| `/api/pdf/flatten` | Moyen | Sans auth |
| `/api/pdf/convert` | Moyen | Conversion PDF sans auth = risque de DDoS via tâches lourdes |
| `/api/pdf/split` | Moyen | Sans auth |
| `/api/pdf/pages` | Moyen | Sans auth |
| `/api/pdf/forms` | Moyen | Sans auth |
| `/api/pdf/merge` | Moyen | Merge sans auth |
| `/api/pdf/open` | Moyen | Sans auth |

**Note importante:** Ces routes sont peut-être protégées au niveau middleware Next.js (middleware.ts / proxy.ts). Vérifier si un middleware global intercepte ces routes avant d'élever en CRITIQUE.

La route `/api/pdf/parse-from-s3` utilise `import 'server-only'` et documente `Authorization: Bearer <JWT>` — correctement protégée.

---

## Configurations à risque

### 1. CSP avec `unsafe-inline` et `unsafe-eval` (OWASP A05)

Dans `apps/web/next.config.ts` :

```
script-src 'self' 'unsafe-inline' 'unsafe-eval'   ← invalide la protection XSS du CSP
style-src 'self' 'unsafe-inline'
```

- `unsafe-eval` requis par PDF.js WASM — mais annule la protection contre XSS par injection de script
- `unsafe-inline` sur script-src — annule la protection anti-XSS dans les navigateurs modernes
- Recommandation: migrer vers `nonce-{aléatoire}` + `strict-dynamic` pour les scripts légitimes

### 2. X-XSS-Protection déprécié dans nginx

Nginx utilise `X-XSS-Protection "1; mode=block"` (lignes 69, 216 de `deploy/nginx.conf`).
Ce header est **obsolète** et peut créer des vecteurs d'attaque sur IE. Supprimer ou remplacer par `0`.

### 3. HSTS sans preload et sans includeSubDomains dans nginx

`deploy/nginx.conf` : `Strict-Transport-Security "max-age=63072000"` — manque `includeSubDomains` et `preload`.
La config Next.js a `includeSubDomains` mais pas nginx — incohérence double-protection.

### 4. CSP manquant sur API nginx (api.giga-pdf.com)

`deploy/nginx.conf` : Le bloc `api.giga-pdf.com` (serveur API FastAPI) n'a **pas de Content-Security-Policy**.
Le bloc web principal non plus — CSP est uniquement appliqué via Next.js headers.

### 5. WebSocket CORS ouvert en développement

`app/api/websocket.py` ligne 68 :
```python
cors_allowed_origins="*" if settings.is_development else []
```
En production, `cors_allowed_origins=[]` signifie que les WebSockets **refusent toutes les origines**.
Vérifier que l'app gère correctement ce cas (pas de fallback silencieux vers `*`).

### 6. Image remotePatterns trop permissif

`apps/web/next.config.ts` :
```typescript
hostname: "**"   // Toutes les images HTTPS sont autorisées
```
Cela permet le SSRF via le service d'optimisation d'images Next.js — un attaquant peut déclencher des requêtes vers des URLs internes via `/_next/image?url=http://internal-service`.

### 7. python-jose maintenu par personne — JWT critique

`app/middleware/auth.py` : python-jose utilisé pour valider les JWT. Le projet est unmaintained depuis 2022.
Risque: vulnérabilités futures non patchées dans le composant qui valide l'identité des utilisateurs.

### 8. Permissions-Policy absent de nginx

Nginx ne définit pas de `Permissions-Policy`. Uniquement dans Next.js headers — non protégé pour les appels directs à l'API.

---

## Plan d'action prioritaire

### P0 — Immédiat (avant prochain déploiement)

- **Vérifier l'absence d'auth sur les routes PDF Next.js** : Confirmer si un middleware global protège `/api/pdf/*`. Si non, ajouter auth sur toutes les routes — en particulier `/api/pdf/encrypt` et `/api/pdf/convert` (opérations lourdes exploitables en DDoS).
- **Restreindre `images.remotePatterns`** dans `next.config.ts` : remplacer `hostname: "**"` par une whitelist des domaines réels (CDN giga-pdf.com, avatars providers OAuth). Le wildcard `**` ouvre un SSRF via Next.js image optimization.

### P1 — Cette semaine

- **Migrer python-jose vers PyJWT** : python-jose est unmaintained. Remplacer dans `app/middleware/auth.py` et `app/api/v1/embed.py` par `PyJWT>=2.8.0` qui est activement maintenu et support les mêmes algorithmes HMAC/RSA.
- **Supprimer `X-XSS-Protection` de nginx** : header déprécié et contre-productif. Remplacer par `X-XSS-Protection: 0` ou simplement supprimer.
- **Corriger HSTS nginx** : ajouter `includeSubDomains` au header HSTS du bloc nginx pour correspondre à la config Next.js.
- **Mettre à jour `@aws-sdk/client-s3`** : embarque fast-xml-parser@5.5.8 (CVE-2026-41650). Mise à jour vers version incluant fast-xml-parser ≥ 5.7.0.

### P2 — Backlog sécurité (sprint suivant)

- **Remplacer `unsafe-eval` et `unsafe-inline` dans CSP** : Migrer vers `nonce-{random}` généré par middleware Next.js. PDF.js peut utiliser un worker WASM avec une politique plus stricte via `worker-src blob:` + nonce.
- **Ajouter `Permissions-Policy` à nginx** pour les appels directs à l'API backend.
- **Restreindre WebSocket CORS en production** : `cors_allowed_origins=[]` sur python-socketio en prod — vérifier si les connexions WS réelles fonctionnent (risque de régression).
- **Installer pip-audit en CI** : déjà disponible dans le venv, l'intégrer dans le pipeline CI pour audit continu des dépendances Python.
- **Ajouter CSP au bloc nginx API** : même minimal (`default-src 'none'; frame-ancestors 'none'`) pour l'API REST.
- **Rate limiting sur routes PDF sans auth** (si elles restent publiques) : appliquer `limit_req zone=upload_limit` nginx sur `/api/pdf/*` pour éviter abus ressources.

---

## Bilan global

| Domaine | Statut | Priorité |
|---------|--------|----------|
| Secrets committés | Aucun détecté | OK |
| Dépendances Python | 0 CVE (pip-audit clean) | OK |
| Dépendances TS | 3 modérées, 0 critiques | P1 |
| Authentification routes PDF | Non confirmée (vérifier middleware) | P0 |
| Configuration CORS | Correcte en prod (whitelist stricte) | OK |
| Headers sécurité nginx | Incomplètes (HSTS, XSS-Protection déprécié) | P1 |
| CSP Next.js | Présente mais affaiblie par unsafe-eval/inline | P2 |
| python-jose (JWT) | Unmaintained, risque futur | P1 |
| Image wildcard SSRF | Ouvert (hostname: **) | P0 |
| Systemd user | gigapdf (non-root) | OK |
| .env dans git | Uniquement .env.example | OK |
