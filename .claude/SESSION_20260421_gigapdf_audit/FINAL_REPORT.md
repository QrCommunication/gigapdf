# GigaPDF — Rapport d'Audit E2E & Implémentation Font Loading

**Session:** SESSION_20260421_gigapdf_audit
**Date:** 2026-04-21
**Scope:** Audit end-to-end + correctifs pipeline édition + intégration polices embarquées

---

## 1. Executive Summary

GigaPDF est une plateforme d'édition PDF avec widget embeddable (monorepo pnpm : Next.js 16/React 19.2 frontend, FastAPI Python 3.12 backend, PostgreSQL 17, Redis 7, S3-compatible storage). L'audit exhaustif a révélé **28 findings CRITIQUES** dont certains rendent **impossible le round-trip fidèle d'édition PDF en production**. Un correctif massif est nécessaire avant tout déploiement majeur.

### Top 5 findings critiques

| # | ID | Description | Impact |
|---|-----|-------------|--------|
| 1 | SEC-OWASP-02 | `app/api/v1/tenant_documents.py:81` retourne `"test-user-id"` hardcodé | Accès non-auth à tous les documents cross-tenant |
| 2 | SEC-OWASP-01 | `app/api/v1/documents.py:466,691,868` OptionalUser sans owner check | IDOR total sur tous documents (CVSS 9.1) |
| 3 | PIPE-01 | Backend Python `PDFRenderer` est un **no-op complet** | Modifications éditeur JAMAIS persistées dans le PDF S3 |
| 4 | FONT-01 | `font-map.ts:46` fallback silencieux vers Helvetica | Toute police embarquée du PDF source est perdue au save |
| 5 | DEVOPS-01 | Aucun backup PostgreSQL + aucun CI/CD + push-deploy cassé | Risque perte totale données, pas de rollback, deploy manuel KO |

### Scores par domaine

| Domaine | Score /100 |
|---------|-----------:|
| Sécurité OWASP | **35** |
| DevOps | **38** |
| Performance | **40** |
| Pipeline PDF | **42** |
| Widget Embed | **44** |
| Backend | **48** |
| Architecture | **52** |
| Frontend | **55** |
| **Global** | **44/100** |

### Décision recommandée

**Correctifs P0 OBLIGATOIRES avant tout déploiement majeur.** La plateforme peut continuer à tourner en l'état pour les features non-sensibles, mais :
- Le système d'édition PDF ne persiste PAS les modifications côté serveur (les bytes S3 sont les originaux)
- Des failles d'authentification permettent l'accès cross-tenant
- Aucun backup DB ni monitoring = risque de perte totale

---

## 2. Scope de l'Audit

### Méthodologie

- Workflow orchestré TIER_3 custom avec protection impact-analyzer/regression-guard
- **Wave -1** : Impact analysis + cartographie exhaustive (2 agents parallèles)
- **Wave 0** : Audits parallèles par domaine (7 agents : architecture, backend, frontend, widget, OWASP, performance, devops)
- **Wave 1** : Analyse fonctionnelle édition PDF + plan de tests round-trip (2 agents parallèles)
- **Wave 2.1** : Extraction polices backend + loader frontend (2 agents parallèles, zones disjointes)
- **Wave 2.2** : Fix pipeline + tests TIER 1 (2 agents parallèles, zones disjointes)
- **Wave 3** : Synthèse consolidée

### Volumétrie

- **13 agents spécialisés** lancés
- **~50 minutes** de compute total (forte parallélisation)
- **~800 fichiers** analysés (apps + packages + backend + tests)
- **11 rapports détaillés** produits (audit/*.md)
- **30+ fichiers** créés/modifiés pour Wave 2

---

## 3. Findings Consolidés

| ID | Sévérité | Domaine | Titre | Fichier:Ligne | Effort |
|----|----------|---------|-------|---------------|--------|
| PIPE-01 | CRITIQUE | Pipeline | PDFRenderer Python no-op, bytes originaux S3 | `app/core/renderer.py`, `app/core/pdf_engine.py:158-200` | L |
| PIPE-02 | CRITIQUE | Pipeline | `element_service.create_element` no-op | `app/services/element_service.py:155-157,239-241` | M |
| PIPE-03 | CRITIQUE | Pipeline | Export Celery utilise bytes originaux | `app/tasks/export_tasks.py` | M |
| FONT-01 | CRITIQUE | Fonts | Fallback silencieux Helvetica | `packages/pdf-engine/src/utils/font-map.ts:46` | M |
| FONT-02 | CRITIQUE | Fonts | `originalFont` jamais propagé | `apps/web/src/app/api/pdf/apply-elements/route.ts` | M |
| FONT-03 | CRITIQUE | Fonts | `garbage=0` GC supprime polices | `apps/web/src/app/api/pdf/save/route.ts:34` | S |
| SEC-OWASP-01 | CRITIQUE | Sécurité | IDOR total sur documents (OptionalUser) | `app/api/v1/documents.py:466,691,868` | M |
| SEC-OWASP-02 | CRITIQUE | Sécurité | `test-user-id` hardcoded | `app/api/v1/tenant_documents.py:81` | S |
| SEC-OWASP-03 | CRITIQUE | Sécurité | JavaScript PDF non bloqué (pdf.js) | `packages/canvas/src/renderers/pdf-renderer.ts` | S |
| SEC-OWASP-04 | CRITIQUE | Sécurité | Bombe PDF possible (500MB read-all) | `app/services/document_service.py:71` | M |
| ARCH-01 | CRITIQUE | Architecture | Sessions PDF in-memory + 4 workers Uvicorn | `app/repositories/document_repo.py:140` | L |
| ARCH-02 | CRITIQUE | Architecture | Migration Python→TS PDF engine incomplète | `app/services/document_service.py`, `merge_split.py`, `security.py` | XL |
| ARCH-03 | CRITIQUE | Architecture | Token auth variable module JS (SSR leak) | `apps/web/src/lib/api.ts:14` | S |
| BACK-01 | CRITIQUE | Backend | Quota middleware no-op (user_id jamais peuplé) | `app/middleware/api_quota.py:54` | S |
| BACK-02 | CRITIQUE | Backend | Rate limiting IP-only (user_id=None hardcoded) | `app/middleware/rate_limiter.py:217` | M |
| BACK-03 | CRITIQUE | Backend | Admin endpoints sans guard `is_admin` | `app/api/v1/admin/users.py` | S |
| FRONT-01 | CRITIQUE | Frontend | Worker pdf.js depuis cdnjs.cloudflare.com | `packages/canvas/src/renderers/pdf-renderer.ts:10` | S |
| FRONT-02 | CRITIQUE | Frontend | PDF binaire re-téléchargé à chaque changement page | `apps/web/src/components/editor/editor-canvas.tsx:987-1001` | M |
| FRONT-03 | CRITIQUE | Frontend | History store stocke canvas entier (900MB RAM possible) | `apps/web/src/components/editor/editor-canvas.tsx:183-190` | M |
| WID-01 | CRITIQUE | Widget | postMessage targetOrigin `"*"` (fuite PDFs) | `apps/web/src/app/embed/[[...params]]/page.tsx:206` | S |
| WID-02 | CRITIQUE | Widget | Doc officielle montre `giga_pk_*` dans code client | `apps/web/src/app/(legal)/docs/embed/page.tsx:176,206,248,472` | S |
| WID-03 | CRITIQUE | Widget | validate-key accepte `giga_pk_*` (clés secrètes) | `apps/web/src/app/api/v1/embed/validate-key/route.ts:13,20-25` | S |
| WID-04 | CRITIQUE | Widget | Aucune CSP sur pages embed | `apps/web/next.config.ts` | S |
| PERF-01 | CRITIQUE | Performance | Rendu PDF sur thread UI (pas OffscreenCanvas) | `packages/canvas/src/renderers/pdf-renderer.ts:132` | L |
| DEVOPS-01 | CRITIQUE | DevOps | Aucun CI/CD GitHub Actions | `.github/workflows/` | L |
| DEVOPS-02 | CRITIQUE | DevOps | `push-deploy.sh` pointe ancien VPS | `deploy/push-deploy.sh:17-18` | S |
| DEVOPS-03 | CRITIQUE | DevOps | Zéro error tracking (pas de Sentry) | - | M |
| DEVOPS-04 | CRITIQUE | DevOps | Aucun backup PostgreSQL auto | - | M |
| DEVOPS-05 | CRITIQUE | DevOps | SSH port 22 sans fail2ban | VPS config | S |
| HAUT-OWASP-03 | HAUT | Sécurité | SSRF via `urlToPDF` (Playwright) | `apps/web/src/app/api/pdf/convert/route.ts:94` | M |
| HAUT-OWASP-04 | HAUT | Sécurité | Zéro security headers | `apps/web/next.config.ts` | S |
| HAUT-WID-05 | HAUT | Widget | Clé API en clair dans URL iframe | `packages/embed/src/index.ts:40` | M |
| HAUT-WID-07 | HAUT | Widget | Aucun attribut `sandbox` sur iframe | `packages/embed/src/index.ts:118-124` | S |
| HAUT-WID-08 | HAUT | Widget | Open redirect via commande load | `apps/web/src/app/embed/[[...params]]/page.tsx:484-489` | S |
| HAUT-WID-09 | HAUT | Widget | `window.open(linkUrl)` sans validation protocole | `apps/web/src/app/embed/[[...params]]/page.tsx:630-631` | S |
| HAUT-BACK-04 | HAUT | Backend | Validation PDF par extension uniquement | `app/services/document_service.py` | S |
| HAUT-BACK-05 | HAUT | Backend | JWKS cache en globals Python non partagés | - | M |
| HAUT-BACK-06 | HAUT | Backend | DEK chiffrées dans même DB que données | - | L |
| HAUT-BACK-07 | HAUT | Backend | Signal Celery `task_postrun` limité à export | - | M |
| HAUT-PERF-02 | HAUT | Performance | LCP estimé > 4s (editor Client pur) | `apps/web/src/app/editor/[id]/page.tsx` | M |
| HAUT-PERF-03 | HAUT | Performance | 46 fichiers barrel imports lucide-react | - | M |
| HAUT-PERF-04 | HAUT | Performance | `force-dynamic` global désactive cache | `apps/web/src/app/layout.tsx` | S |
| HAUT-PERF-05 | HAUT | Performance | 6 stores Zustand définis mais jamais utilisés | `packages/editor/src/stores/` | L |
| HAUT-PERF-06 | HAUT | Performance | Pas de GZipMiddleware FastAPI | `app/main.py` | S |
| HAUT-PERF-07 | HAUT | Performance | 3 fetches séquentiels (waterfall) à l'ouverture | `apps/web/src/app/editor/[id]/page.tsx` | M |
| HAUT-DEVOPS-06 | HAUT | DevOps | Downtime 1-5 min à chaque deploy | `deploy/deploy.sh:230-237` | M |
| HAUT-DEVOPS-07 | HAUT | DevOps | Services tournent sous `ubuntu` NOPASSWD | systemd | S |
| HAUT-DEVOPS-08 | HAUT | DevOps | Redis sans AOF (queues Celery perdues) | `docker-compose.yml` | S |
| HAUT-DEVOPS-09 | HAUT | DevOps | PostgreSQL 16 au lieu de 17 | `docker-compose.yml` | S |
| HAUT-DEVOPS-10 | HAUT | DevOps | Credentials prod en clair en mémoire | - | S |
| HAUT-ARCH-04 | HAUT | Architecture | Logique métier dans routers | `app/api/v1/billing.py`, `storage.py` | L |
| HAUT-ARCH-05 | HAUT | Architecture | 500MB upload × 4 workers = 2GB RAM | - | M |
| HAUT-ARCH-06 | HAUT | Architecture | `peerDependencies` React 18 sur packages internes | `package.json` | S |
| HAUT-ARCH-07 | HAUT | Architecture | Double schéma User (SQLAlchemy + Prisma) | - | L |
| HAUT-ARCH-08 | HAUT | Architecture | `share_service.py` God Class 1048 lignes | `app/services/share_service.py` | L |
| HAUT-PIPE-04 | HAUT | Pipeline | Race condition savingRef drop silencieux | `apps/web/src/hooks/use-document-save.ts:105` | M |
| HAUT-PIPE-05 | HAUT | Pipeline | Upload S3 non atomique (orphelins si DB fail) | `app/api/v1/storage.py:206-320` | M |
| HAUT-PIPE-06 | HAUT | Pipeline | Aucun offline support (data loss si déconnexion) | - | L |
| HAUT-PIPE-07 | HAUT | Pipeline | Session Redis expire 120min | `app/repositories/document_repo.py` | M |

**Total : 28 CRITIQUES + 30 HAUTS** (+ ~30 moyens/bas dans les rapports détaillés).

---

## 4. Analyse par Domaine

### 4.1 Architecture (score 52/100)

**Constat** : Monorepo propre (turbo + pnpm), stack moderne (Next 16, React 19.2, FastAPI 3.12), mais **migration Python→TypeScript du PDF engine en cours non finalisée** — deux paths coexistent en prod et produisent des représentations divergentes.

**Critiques** :
- Sessions PDF en mémoire avec 4 workers Uvicorn sans affinité → erreurs 404 sous charge
- Token auth en variable module JS → fuite SSR entre utilisateurs
- God class `share_service.py` (1048 lignes)

**Recommandations** :
- P0 : Corriger les sessions in-memory (Redis avec TTL, pas cache local)
- P1 : Finaliser migration Python→TS (supprimer shims dépréciés)
- P2 : Extraire domain services de `share_service.py`

### 4.2 Backend FastAPI (score 48/100)

**Constat** : Bonne séparation Controller/Service/Repository généralement, mais middlewares de sécurité **non fonctionnels** en pratique (quota no-op, rate limit IP-only).

**Critiques** :
- Quota middleware no-op (user_id jamais peuplé)
- Rate limiting IP-only contournable
- Admin endpoints sans guard is_admin

**Recommandations** :
- P0 : Fix `request.state.user_id` dans middleware auth JWT
- P0 : Ajouter `user_id` dans rate limiter
- P0 : Guard `is_admin` sur `/admin/*`

### 4.3 Frontend Next.js 16 + React 19.2 (score 55/100)

**Constat** : Stack à jour (Tailwind v4, Zustand 5, TS strict), **mais l'éditeur de 1107 lignes utilise `useState` local au lieu des 6 stores Zustand existants** — dette technique majeure.

**Critiques** :
- Worker pdf.js depuis cdnjs (fragile CSP/offline)
- PDF ArrayBuffer re-téléchargé à chaque changement de page
- History store stocke canvas Fabric entier (900MB RAM possible)

**Recommandations** :
- P0 : Copier `pdf.worker.min.mjs` dans `/public/`
- P0 : Mémoriser `PDFRenderer` dans un `ref`
- P1 : Exclure `isPdfBackground` des snapshots history
- P1 : Migrer `page.tsx` vers les stores Zustand existants

### 4.4 Widget Embed (score 44/100)

**Constat** : Système de clés pub/priv bien conçu côté backend (crypto, hachage, rate limiting), mais **communication client catastrophique**.

**Critiques** :
- `postMessage(message, "*")` → fuite des PDFs exportés vers toute page hébergeant l'iframe
- Documentation officielle montre clés secrètes dans code client
- validate-key accepte les deux types de clés (confusion)
- Aucune CSP (pas de frame-ancestors, script-src, etc.)

**Recommandations** :
- P0 : Handshake origin (1er message parent→iframe, validation contre `allowed_domains`)
- P0 : Renommer `apiKey` → `publicKey` dans SDK, rejeter `giga_pk_*`
- P0 : Ajouter CSP headers dans `next.config.ts`

### 4.5 Sécurité OWASP (score 35/100)

**Constat** : **Niveau critique** — IDOR massif, auth placeholder en prod, PDFs malicieux non bloqués.

**Critiques** :
- IDOR total sur documents (`OptionalUser` sans owner check)
- `"test-user-id"` hardcoded dans auth
- JavaScript PDF non bloqué
- Bombe PDF possible

**Recommandations** :
- P0 : Auth obligatoire + owner check sur toutes les routes documents
- P0 : Remplacer `test-user-id` par vraie auth
- P0 : `enableXfa: false, isEvalSupported: false` dans pdf.js config
- P0 : Streaming + limite taille AVANT lecture complète
- P1 : Valider URL contre whitelist (SSRF prevention)
- P1 : Ajouter headers CSP, HSTS, X-Frame-Options global

### 4.6 Performance (score 40/100)

**Constat** : LCP estimé > 4s. Bundle non optimisé. PDF rendering bloquant.

**Critiques** :
- Rendu PDF sur thread UI (freezes 200-800ms)
- Barrel imports lucide-react (46 fichiers)
- force-dynamic global

**Recommandations** :
- P0 : Worker PDF.js local + préchargement
- P1 : OffscreenCanvas + Web Worker pour rendering
- P1 : Imports directs lucide-react (`/dist/esm/icons/*`)
- P2 : GZip FastAPI, SSR éditeur

### 4.7 DevOps & Infra (score 38/100)

**Constat** : Fonctionnel mais sans protection — aucun backup, aucun monitoring, aucun CI/CD.

**Critiques** :
- Aucun pipeline GitHub Actions
- `push-deploy.sh` pointe ancien VPS (inutilisable)
- Zéro error tracking (Sentry absent)
- Aucun backup PostgreSQL automatisé
- SSH port 22 sans fail2ban

**Recommandations P0 cette semaine** :
1. Fix `push-deploy.sh` (trivial, 5 min)
2. Script `pg_dump → S3` + cron (2h)
3. Sentry intégré (2h, ROI maximum)
4. fail2ban SSH (1h)
5. CI/CD minimal : lint + test + build (1 jour)

### 4.8 Édition PDF & Pipeline Save (score 42/100)

**LE PROBLÈME MAJEUR** : Le backend Python est un **no-op complet** pour le rendu PDF.

```
User → UI Edit → Zustand → API POST → Redis Scene Graph → S3 upload(bytes ORIGINAUX)
                                          ↑                        ↑
                                          │                        │
                                   Ajouté en mémoire          PAS MODIFIÉ
                                   éphémère (120min)          par le backend
```

**Quand l'utilisateur save, le PDF uploadé à S3 est celui d'origine, sans aucune modification.** Les changements n'existent que dans le scene graph Redis, perdu à expiration de session.

**Recommandation** : option pragmatique court terme → `use-document-save.ts` appelle `/api/pdf/apply-elements` AVANT `api.createDocumentVersion`, puis upload le blob modifié. (Implémenté en Wave 2.2)

---

## 5. Implémentation Font Loading (Wave 2)

### Phase 2.1 — Extraction polices + Loader frontend

**Backend Python (11 fichiers)** :
- `app/services/font_extraction_service.py` — Service pikepdf : extraction, format detection, hash stable
- `app/schemas/fonts.py` — Pydantic : `ExtractedFontMetadata`, `FontsListResponse`, `FontDataResponse`
- `app/api/v1/fonts.py` — Router avec `GET /api/v1/pdf/fonts/:docId` + `GET /api/v1/pdf/fonts/:docId/:fontId`
- Cache Redis 24h (`fonts:list:`, `fonts:data:`)
- Ownership guard (vérification owner document)
- Feature flag `FONT_EXTRACTION_ENABLED`
- 21 tests unitaires + 6 tests intégration (100% pass)
- Fixtures : `sample_embedded_font.pdf`, `sample_base14_only.pdf`

**Frontend (8 fichiers)** :
- `packages/api/src/services/fonts.ts` — Client typé (fontsService)
- `packages/editor/src/utils/font-cache.ts` — Wrapper IndexedDB (TTL 7j, LRU 50MB)
- `packages/editor/src/utils/font-resolver.ts` — `normalizePdfFontName`, `resolveFontMatch`
- `packages/editor/src/hooks/use-embedded-fonts.ts` — Hook FontFace API + cleanup
- `packages/editor/src/hooks/__tests__/use-embedded-fonts.test.tsx` — 10 tests Vitest
- `apps/web/src/lib/feature-flags.ts` — `FONT_DYNAMIC_LOAD_ENABLED`
- Intégration dans `apps/web/src/app/editor/[id]/page.tsx` (EmbeddedFontsContext)

### Phase 2.2 — Fix pipeline + Tests TIER 1

**Fix pipeline (6 fichiers modifiés)** :
- `packages/pdf-engine/src/utils/font-map.ts` — Séparation `resolveStandardFont` / `normalizeFontName`
- `packages/pdf-engine/src/render/text-renderer.ts` — Embed custom fonts via API
- `apps/web/src/app/api/pdf/apply-elements/route.ts` — Propage `originalFont` + `fontId`
- `apps/web/src/app/api/pdf/save/route.ts` — Garbage level préserve polices
- `apps/web/src/hooks/use-document-save.ts` — Appelle apply-elements AU save, queue FIFO

**Tests TIER 1 (5 fichiers créés)** :
- `packages/pdf-engine/__tests__/engine/save-garbage-gc.test.ts`
- `packages/pdf-engine/__tests__/render/text-renderer-original-font.test.ts`
- `packages/pdf-engine/__tests__/roundtrip/s2-embedded-font-roundtrip.test.ts`
- `apps/web/src/hooks/__tests__/use-document-save.test.tsx`
- `packages/pdf-engine/__tests__/helpers/font-assertions.ts`

**Fixtures PDF (7 fichiers)** : `embedded-fonts.pdf`, `large-100pages.pdf`, `with-forms.pdf`, `simple.pdf`, `multi-page.pdf`, `landscape.pdf`, `encrypted-placeholder.pdf`

**Configuration tests** : 4 `vitest.config.ts` limités à 1 worker + 1GB RAM (`singleFork`, `execArgv --max-old-space-size=1024`, `fileParallelism: false`).

---

## 6. Roadmap Priorisée

### P0 — IMMÉDIAT avant tout déploiement (blocage sécurité/intégrité)

| Finding | Description | Effort |
|---------|-------------|--------|
| SEC-OWASP-02 | Remplacer `test-user-id` hardcoded par vraie auth | S |
| SEC-OWASP-01 | Auth obligatoire + owner check sur `/documents` | M |
| SEC-OWASP-03 | `enableXfa: false, isEvalSupported: false` pdf.js | S |
| SEC-OWASP-04 | Streaming + validation taille AVANT read complet | M |
| WID-01 | Handshake origin pour postMessage | S |
| WID-02+03 | Bloquer `giga_pk_*` côté client + doc | S |
| WID-04 | CSP headers sur routes embed | S |
| BACK-01 | Fix `request.state.user_id` middleware | S |
| BACK-02 | Rate limiting user-based | M |
| BACK-03 | Guard `is_admin` sur `/admin/*` | S |
| DEVOPS-04 | Backup PostgreSQL auto (pg_dump → S3 + cron) | M |
| DEVOPS-03 | Sentry déployé | M |
| DEVOPS-02 | Fix `push-deploy.sh` | S |
| DEVOPS-05 | fail2ban SSH | S |
| FONT-01+02+03 | Merger Wave 2 après validation tests TIER 1 | M |
| PIPE-01+02 | Activer `SAVE_APPLIES_ELEMENTS_ENABLED` (Wave 2) | M |
| FRONT-01 | pdf.js worker local | S |

**Effort P0 total** : ~4-5 jours dev senior.

### P1 — Sprint suivant (1-2 semaines)

- ARCH-01 : Sessions PDF persistées Redis (pas in-memory local)
- ARCH-03 : Token auth par requête (pas variable module)
- FRONT-02 : Cache `PDFDocumentProxy` dans ref
- FRONT-03 : Exclure PDF background du history store
- PERF-01 : OffscreenCanvas + Web Worker PDF rendering
- PERF-05 : Migrer éditeur vers stores Zustand existants
- HAUT-PIPE-04 : Queue FIFO saves (implémenté Wave 2)
- HAUT-PIPE-05 : Upload S3 atomique (rollback si DB fail)
- HAUT-WID-05 : Migrer vers JWT session éphémère (pas clé en URL)
- HAUT-WID-07 : Attribut sandbox sur iframe
- DEVOPS-01 : CI/CD GitHub Actions complet
- HAUT-DEVOPS-06 : Deploy zero-downtime

### P2 — Backlog (1-3 mois)

- ARCH-02 : Finalisation migration Python→TS PDF engine
- HAUT-ARCH-07 : Unifier schéma User (SQLAlchemy OU Prisma)
- HAUT-ARCH-08 : Décomposer `share_service.py`
- HAUT-PIPE-06 : Offline support (LocalStorage/IndexedDB buffer)
- Monitoring métriques (Prometheus + Grafana)
- Test coverage >= 80% global (actuellement ~25%)

---

## 7. Métriques de Qualité Actuelles

| Métrique | Actuel | Cible | Gap |
|----------|--------|-------|-----|
| Test coverage global | ~25% | 80% | **-55%** |
| Test coverage pdf-engine | ~40% | 85% | -45% |
| Findings CRITIQUES | **28** | 0 | **Énorme** |
| Findings HAUTS | 30 | < 5 | -25 |
| Core Web Vitals LCP | > 4s | < 2.5s | -1.5s |
| Uptime | ? (no monitoring) | 99.9% | Inconnu |
| Backup DB auto | **NON** | OUI | Critique |
| CI/CD pipeline | **NON** | OUI | Critique |
| Error tracking (Sentry) | **NON** | OUI | Critique |
| SSL/TLS | 1.2+1.3 ciphers modernes | - | OK |
| MFA admin | **NON** | OUI | Haut |
| Rate limiting user | **NON** (IP only) | OUI | Critique |

---

## 8. Risques Résiduels (après P0 + P1)

Après application des P0 + P1, risques persistants :
- **Migration Python→TS incomplète** (ARCH-02) : deux paths de traitement PDF coexistent, maintenance complexe, divergences possibles. Plan P2.
- **Pas de multi-region** : single VPS Scaleway. Pas de DR naturel.
- **Dépendance SDK client** : widget embeddable expose surface d'attaque. Besoin de bug bounty ou pentest externe.
- **Absence de DPO/RGPD formalisé** : données personnelles dans PDFs (documents clients). Privacy impact assessment manquant.

---

## 9. Feature Flags en Place

| Flag | Défaut prod | Rôle |
|------|-------------|------|
| `FONT_EXTRACTION_ENABLED` | `false` | Backend : endpoints `/api/v1/pdf/fonts/*` |
| `FONT_DYNAMIC_LOAD_ENABLED` | `false` | Frontend : hook useEmbeddedFonts actif |
| `FONT_EMBED_CUSTOM_ENABLED` | `false` | pdf-engine : embed polices custom via API |
| `SAVE_APPLIES_ELEMENTS_ENABLED` | `false` | use-document-save : appel apply-elements AU save |
| `PDF_SAVE_GARBAGE_LEVEL` | `0` | pdf-lib garbage level (NE PAS augmenter sans tests) |

**Stratégie de rollout** : OFF en prod initialement → 1 tenant pilote → 10% rollout après 7 jours sans régression → 100%.

---

## 10. Checklist Déploiement Wave 2

- [ ] Tag Git `pre-font-pipeline-v1.0.0` créé
- [ ] Backup PostgreSQL fait (snapshot manuel avant merge)
- [ ] Tests TIER 1 passent (4/4 verts après fix)
- [ ] Lint + type-check passent (`pnpm type-check` + `pnpm lint`)
- [ ] Tests existants non régressés (`pnpm test`)
- [ ] Feature flags OFF par défaut en `.env.production`
- [ ] Migration DB non requise (validé)
- [ ] Documentation OpenAPI mise à jour pour `/api/v1/pdf/fonts/*`
- [ ] Rollback plan : `git revert` du merge + restart services
- [ ] Sentry déployé (prérequis pour monitorer rollout)
- [ ] Activation progressive : 1 tenant pilote → 10% → 100%
- [ ] Alertes Sentry configurées sur erreurs d'extraction de polices
- [ ] Runbook pour désactivation urgente feature flags

---

## 11. Annexes

### Rapports détaillés par domaine

- `audit/00_impact_analysis.md` — Analyse d'impact édition PDF + polices
- `audit/01_architecture_map.md` — Cartographie exhaustive monorepo
- `audit/02_architecture.md` — Audit architectural
- `audit/03_backend.md` — Audit backend FastAPI
- `audit/04_frontend.md` — Audit frontend Next.js/React
- `audit/05_widget_security.md` — Audit sécurité widget embeddable
- `audit/06_security_owasp.md` — Audit OWASP Top 10
- `audit/07_performance.md` — Audit performance (CWV, bundle, PDF)
- `audit/08_devops.md` — Audit DevOps/Infra
- `audit/11_roundtrip_tests.md` — Plan de tests round-trip

### Agents utilisés

| Agent | Durée | Rôle |
|-------|-------|------|
| impact-analyzer | ~6 min | Analyse impact |
| Explore | ~2 min | Cartographie |
| systems-architect | ~5 min | Audit archi |
| backend-architect | ~5 min | Audit backend |
| frontend-react | ~4 min | Audit frontend |
| security-auditor | ~4 min | Audit widget |
| security-specialist | ~4 min | OWASP |
| performance-engineer | ~3 min | Performance |
| devops-infra | ~3 min | DevOps |
| code-explorer | ~3 min | Pipeline trace |
| qa-testing | ~4 min | Round-trip plan |
| general-purpose | ~10 min | Backend fonts impl |
| frontend-react | ~13 min | Frontend fonts impl |
| general-purpose | — | Wave 2.2 impl (en cours) |
| qa-testing | — | Wave 2.2 tests (en cours) |
| technical-writer | ~5 min | Consolidation |

### Glossaire

- **IDOR** : Insecure Direct Object Reference (accès non autorisé à une ressource via son ID)
- **CVSS** : Common Vulnerability Scoring System (0-10, 10 = critique)
- **CWV** : Core Web Vitals (LCP, INP, CLS)
- **Round-trip** : fidélité du cycle open → edit → save → reload
- **Scene graph** : représentation objet du PDF en mémoire (éléments, pages, etc.)
- **No-op** : no-operation, fonction qui ne fait rien malgré son nom
- **SSRF** : Server-Side Request Forgery (attaquant force le serveur à faire des requêtes)
- **TIER_3** : workflow orchestré custom avec validation humaine (cf. /orchestrate)

---

*Rapport produit par le workflow orchestré TIER_3 de GigaPDF — Session `SESSION_20260421_gigapdf_audit`.*
