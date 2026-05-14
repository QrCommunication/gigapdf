# Security Audit — GigaPDF Embeddable Widget

**Session:** SESSION_20260421_gigapdf_audit
**Date:** 2026-04-21
**Scope:** Commit `2d3d65c` — "feat: add embeddable PDF editor widget with public/private key system"

## Résumé

| Sévérité | Count |
|----------|-------|
| CRITIQUE | 4 |
| HAUT | 5 |
| MOYEN | 5 |
| BAS | 3 |

## Tableau des Findings

| # | Sévérité | Titre | Fichier:Ligne |
|---|----------|-------|---------------|
| F-01 | CRITIQUE | `window.parent.postMessage` avec targetOrigin `"*"` — fuite PDFs | `apps/web/src/app/embed/[[...params]]/page.tsx:206` |
| F-02 | CRITIQUE | Doc montre clé secrète `giga_pk_*` dans code frontend | `apps/web/src/app/(legal)/docs/embed/page.tsx:176,206,248,472` |
| F-03 | CRITIQUE | validate-key accepte et valide les clés secrètes `giga_pk_*` | `apps/web/src/app/api/v1/embed/validate-key/route.ts:13,20-25` |
| F-04 | CRITIQUE | Aucune CSP sur pages embed (ni `frame-ancestors`) | `apps/web/next.config.ts`, `apps/web/src/app/embed/layout.tsx` |
| F-05 | HAUT | Clé API dans URL iframe (`?apiKey=`) — visible logs/history/Referer | `packages/embed/src/index.ts:40` |
| F-06 | HAUT | CORS prod bloque appels SDK directs depuis sites clients | `app/main.py:311-341`, `packages/embed/src/index.ts:68` |
| F-07 | HAUT | Aucun attribut `sandbox` sur iframe générée par SDK | `packages/embed/src/index.ts:118-124` |
| F-08 | HAUT | Open redirect via commande `load` sans validation documentId | `apps/web/src/app/embed/[[...params]]/page.tsx:484-489` |
| F-09 | HAUT | `window.open(linkUrl)` sans validation protocole (javascript:, data:) | `apps/web/src/app/embed/[[...params]]/page.tsx:630-631` |
| F-10 | MOYEN | SHA-256 sans salt pour clés API (HMAC recommandé) | `app/api/v1/api_keys.py:71-73`, `app/middleware/api_key_auth.py:30-32` |
| F-11 | MOYEN | `NEXT_PUBLIC_API_URL` utilisé côté serveur | `apps/web/src/app/api/v1/embed/validate-key/route.ts:3` |
| F-12 | MOYEN | IP spoofable via X-Forwarded-For non validé | `app/middleware/rate_limiter.py:51-53` |
| F-13 | MOYEN | Embed sessions en mémoire sans TTL/cleanup | `app/repositories/document_repo.py:654-675` |
| F-14 | MOYEN | Pas de validation type runtime sur postMessage | `apps/web/src/app/embed/[[...params]]/page.tsx:465-501` |
| F-15 | BAS | `poweredByHeader: true` expose stack technique | `apps/web/server.js` |
| F-16 | BAS | Absence champ `key_hash_algorithm` pour migration future | `app/models/api_key.py` |
| F-17 | BAS | Rate limiter failopen si Redis indisponible | `app/middleware/api_key_auth.py:352-357` |

## Détails Critiques

### F-01 — postMessage targetOrigin `"*"`
```ts
window.parent.postMessage(message, "*"); // page.tsx:206
```
L'iframe envoie TOUS ses events (`complete` avec blob PDF, `save` documentId, `export` blob) vers `"*"`. Une page malveillante embedant l'iframe peut intercepter les PDFs.

**Fix:** Handshake — parent envoie `origin` au 1er message, iframe valide contre `allowed_domains` de la clé, stocke l'origine, l'utilise comme targetOrigin.

### F-02 + F-03 — Clé secrète dans frontend
La doc officielle utilise `giga_pk_your_api_key` dans des exemples CDN/ESM/React client. validate-key accepte et valide les deux préfixes.

**Fix:**
- Renommer param `apiKey` → `publicKey` (alias déprécié)
- SDK valide que la clé commence par `giga_pub_` sinon erreur
- validate-key REJETTE `giga_pk_*`
- Doc réécrite avec `giga_pub_*`

### F-04 — CSP manquante
`next.config.ts` sans `headers()` CSP. Pas de frame-ancestors, script-src, connect-src.

**Fix:**
```ts
async headers() {
  return [{
    source: '/embed/:path*',
    headers: [{
      key: 'Content-Security-Policy',
      value: "frame-ancestors *; script-src 'self'; connect-src 'self' https://api.giga-pdf.com;"
    }]
  }];
}
```

## Ce qui est bien fait

- Génération clés: `secrets.token_urlsafe(32)` (crypto-sûr)
- Stockage: SHA-256 de la clé, jamais en clair
- Rotation: endpoints dédiés `regenerate-publishable` / `regenerate-secret`
- Per-key rate limiting sliding window Redis
- CORS prod: whitelist stricte 4 origines, pas de `"*"`
- CORS dev: regex `localhost`/`127.0.0.1`

## Recommandations Prioritaires

### P0 — Immédiat avant prod
- F-01: Handshake origin
- F-02+F-03: Renommer `apiKey`→`publicKey` + rejeter `giga_pk_*` dans validate-key + maj doc
- F-04: CSP `frame-ancestors` + `script-src`

### P1 — Sprint suivant
- F-05: Token session JWT éphémère au lieu de clé en URL
- F-07: Attribut sandbox sur iframe
- F-08: Validation UUID v4 pour documentId
- F-09: Validation protocole URL dans window.open
- F-13: Redis TTL embed sessions (2h)

### P2 — Planifier
- F-10: HMAC-SHA256 avec clé serveur
- F-11: `API_URL` sans préfixe NEXT_PUBLIC_
- F-12: Nginx force X-Forwarded-For
- F-06: Décider architecture CORS (proxy via giga-pdf.com recommandé)

## Atouts

Le système de clés pub/priv est bien conçu côté backend (crypto, hachage, scope, rate limiting par clé, allowed_domains). Les vulnérabilités sont principalement dans la **couche communication** (postMessage wildcard, URL exposure) et la **DX/docs** (confusion clé secrète vs publique).
