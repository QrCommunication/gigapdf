# Audit Architectural GigaPDF — 02_architecture.md

**Session**: SESSION_20260421_gigapdf_audit  
**Date**: 2026-04-21  
**Auditeur**: system-architect  
**Périmètre**: Monorepo complet — Python FastAPI backend + Next.js web/admin + packages TS + app mobile

---

## 1. Vue d'ensemble

### Type de projet

GigaPDF est une plateforme SaaS de traitement et d'édition de PDF WYSIWYG. L'architecture est un **monorepo hybride** hébergeant deux runtimes distincts :

- **Backend Python** (FastAPI 3.12) : moteur de session PDF, gestion des quotas, Stripe, WebSocket
- **Frontend TypeScript** (Next.js, pnpm/Turborepo) : éditeur WYSIWYG, portail web, admin, mobile Expo

### Structure monorepo

```
gigapdf/
├── app/                    # Python FastAPI — backend principal
│   ├── api/v1/             # 30+ routers REST (25 000 lignes)
│   ├── services/           # 15 services (~7 700 lignes)
│   ├── repositories/       # 2 repositories (document + Redis)
│   ├── models/             # ORM SQLAlchemy + modèles domaine
│   ├── core/               # PDF engine, parser, renderer, cache, OCR
│   ├── middleware/         # Auth JWT, rate-limit, quota, error handler
│   └── tasks/              # Celery workers (billing, export, OCR)
├── apps/
│   ├── web/                # Next.js 15 — SaaS frontend
│   ├── admin/              # Next.js — back-office React Refine
│   └── mobile/             # Expo — app mobile
├── packages/
│   ├── pdf-engine/         # TypeScript PDF engine (@giga-pdf/pdf-engine)
│   ├── editor/             # Zustand state editor
│   ├── canvas/             # Fabric.js + pdfjs
│   ├── api/                # Client HTTP Axios + TanStack Query
│   ├── types/              # Types partagés
│   ├── billing/            # Composants Stripe React
│   ├── s3/                 # AWS S3 client
│   ├── ui/                 # Design system Radix
│   └── ...configs          # eslint, tailwind, typescript configs
```

### Outils de build

| Outil | Usage | Version |
|-------|-------|---------|
| Turborepo | Orchestration build/lint/test | 2.7.4 |
| pnpm | Gestionnaire de paquets | 10.28.0 |
| Python venv | Isolation Python | 3.12 |
| Docker Compose | Dev/Prod containers | — |
| Celery | Tâches asynchrones | — |

---

## 2. Séparation des responsabilités

### 2.1 Architecture backend Python

Le backend suit une structure en couches :

```
HTTP Request
    ↓
Middleware Stack (RequestID → RateLimit → APIQuota → ApiKeyAuth → CORS)
    ↓
Router (app/api/v1/*.py)
    ↓
Service (app/services/*.py)
    ↓
Repository / Core (app/repositories/ + app/core/)
    ↓
Database (SQLAlchemy async) / Redis / S3
```

**Couches bien respectées** : middleware, services, repositories sont des modules distincts. Les services ont des responsabilités claires (document_service, quota_service, stripe_service, etc.).

### 2.2 Violations SOLID identifiées

#### VIOLATION CRITIQUE — Logique métier dans les routers (SRP, DIP)

Le fichier `app/api/v1/billing.py` (1 801 lignes) exécute directement des requêtes SQLAlchemy dans le handler HTTP :

```python
# app/api/v1/billing.py:212
async with get_db_session() as session:
    # Requête directe dans le router, pas dans un service
    plan_result = await session.execute(
        select(Plan).where(Plan.slug == request.plan_id, Plan.is_active == True)
    )
```

Idem dans `app/api/v1/storage.py` (2 764 lignes) — le router `save_document` orchestre : session PDF → quota check → upload S3 → création DB, tout dans le handler HTTP.

**Fichiers concernés** :
- `app/api/v1/billing.py` : 21 appels directs à `get_db_session()` dans les handlers
- `app/api/v1/storage.py` : imports inline dans les handlers (`from app.core.database import get_db_session` ligne 214)
- `app/api/v1/storage.py:267` : appel direct `s3_service.upload_file()` dans le router

#### VIOLATION HAUTE — Imports différés dans les handlers (couplage caché)

`app/api/v1/storage.py` utilise des imports différés à l'intérieur même des handlers pour contourner les dépendances circulaires présumées :

```python
# storage.py:213-227 — imports dans le corps d'un handler async
from app.models.database import StoredDocument, DocumentVersion
from app.core.database import get_db_session
from app.services.quota_service import quota_service
import hashlib
from pathlib import Path
```

Ce pattern masque le couplage réel, empêche l'analyse statique et ralentit les imports au moment de la requête.

#### VIOLATION HAUTE — share_service.py : God Class (1 048 lignes, SRP)

`app/services/share_service.py` (1 048 lignes) gère : création de partages, permissions, liens publics, membres de tenant, notifications — plusieurs responsabilités distinctes non séparées.

#### VIOLATION MOYENNE — Singletons de module non injectables (DIP)

Tous les services sont des singletons de module :

```python
# Pattern répété dans 15 services
document_service = DocumentService()   # app/services/document_service.py:545
quota_service = QuotaService()         # app/services/quota_service.py:691
stripe_service = StripeService()       # app/services/stripe_service.py:716
```

Ces singletons ne passent pas par FastAPI Depends, ce qui rend les tests plus complexes (pas de mock via injection) et couplent le code aux implémentations concrètes plutôt qu'à des abstractions.

---

## 3. Patterns architecturaux

### 3.1 Ce qui est bien fait

- **Middleware stack** : RequestID → RateLimit → APIQuota → ApiKeyAuth → CORS est une chaîne de responsabilité correctement appliquée.
- **Pydantic Settings** : `app/config.py` utilise `pydantic_settings.BaseSettings` avec `@lru_cache`, ce qui est conforme au 12-factor app.
- **Session Manager hybride** : `DocumentSessionManager` tente une stratégie LRU local + Redis pour la persistance cross-worker.
- **Celery** : Les tâches longues (OCR, export, billing) sont bien isolées dans `app/tasks/`.
- **OpenAPI** : Documentation API complète avec exemples curl/Python/JS générée automatiquement.
- **Package `@giga-pdf/types`** : Unique source de vérité des types TypeScript partagés — bonne pratique.

### 3.2 Migration en cours non finalisée (risque majeur)

Une migration de l'engine PDF Python (PyMuPDF/fitz) vers TypeScript (`@giga-pdf/pdf-engine`) est **en cours mais non terminée**. Des marqueurs DEPRECATED présents dans le code de production :

```python
# app/services/document_service.py:1
# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead

# app/api/v1/merge_split.py:1
# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead

# app/api/v1/security.py:1
# DEPRECATED: Use @giga-pdf/pdf-engine via Next.js API routes instead
```

**Conséquence architecturale** : deux systèmes de traitement PDF coexistent en production :
1. `app/api/v1/documents.py` → `document_service` → Python engine
2. `apps/web/src/app/api/pdf/*.ts` → `@giga-pdf/pdf-engine` → TypeScript engine

Les routes `/api/pdf/*` (Next.js) et `/api/v1/documents/*` (FastAPI) traitent les mêmes opérations PDF par des chemins différents.

### 3.3 Absence de Ports & Adapters

Les services accèdent directement aux implémentations concrètes :

```python
# app/services/document_service.py:20
from app.core.pdf_engine import pdf_engine  # import concret, pas une interface

# app/services/stripe_service.py — import direct Stripe SDK
import stripe
```

Il n'existe pas de ports (interfaces abstraites) pour isoler : PDF engine, Stripe, S3, Redis. Impossible de remplacer l'implémentation sans modifier le code appelant.

### 3.4 Architecture frontend Next.js

L'app web (`apps/web`) utilise Next.js App Router mais n'est pas encore sur Next.js 16 — le fichier `middleware.ts` est présent au lieu de `proxy.ts` (requis en Next.js 16). La version utilisée n'est pas Next.js 16 (pas de `"use cache"` directives, `experimental.ppr: false`).

---

## 4. Dépendances entre modules

### 4.1 Graphe de dépendances des packages internes

```
@giga-pdf/types          (aucune dépendance interne — base)
    ↑
@giga-pdf/api            → types
@giga-pdf/s3             → types
@giga-pdf/editor         → types
@giga-pdf/pdf-engine     → types
@giga-pdf/canvas         → types
    ↑
@giga-pdf/billing        → api + types + ui    (couplage !)
@giga-pdf/ui             → (Radix, pas de deps internes)

apps/web                 → api, canvas, editor, pdf-engine, types, ui
apps/admin               → api, types, ui
apps/mobile              → (aucune dep interne !)
```

**Pas de cycles détectés** dans le graphe de dépendances packages.

### 4.2 Couplage problématique dans les packages

#### VIOLATION HAUTE — peerDependencies React 18 sur des packages internes

`@giga-pdf/api` et `@giga-pdf/billing` déclarent `react: "^18.3.1"` et `react: "^18.0.0"` en `peerDependencies` alors que le monorepo force React 19.2.3 via les `overrides` du root `package.json`. Cela crée une friction entre la version déclarée et la version réellement installée, et peut confondre les outils d'analyse de dépendances.

#### VIOLATION MOYENNE — `@giga-pdf/billing` dépend de `@giga-pdf/api`

`@giga-pdf/billing` est un package de composants UI mais dépend de `@giga-pdf/api` (client HTTP). Cela couple la présentation à la couche de transport réseau au niveau du package, rendant `@giga-pdf/billing` non réutilisable sans l'ensemble du client API.

### 4.3 Deux bases de données pour un seul domaine

Le backend Python utilise SQLAlchemy sur PostgreSQL **et** Prisma (pour BetterAuth dans `apps/web`). Les modèles de données utilisateurs sont définis dans deux endroits :

- `app/models/database.py` : `UserQuota`, `Plan`, `StoredDocument`, `CollaborationSession` (SQLAlchemy)
- `apps/web/prisma/schema.prisma` : `User`, `Account`, `Session`, `Jwks` (Prisma/BetterAuth)

Ces deux schémas partagent les données utilisateur mais via des couches différentes, sans source de vérité unique sur le modèle `User`.

### 4.4 App mobile sans dépendances internes

`apps/mobile` (`gigapdf-mobile`) n'importe aucun package `@giga-pdf/*`. Il appelle une API externe avec Axios directement depuis les composants, sans couche d'abstraction partagée avec l'app web.

---

## 5. Configuration et secrets

### 5.1 12-factor app : évaluation

| Facteur | État | Notes |
|---------|------|-------|
| Codebase | Partiellement conforme | Deux runtimes dans le même repo, bonne pratique monorepo |
| Config | Conforme | `pydantic_settings.BaseSettings` + `.env` file |
| Build/Release/Run | Conforme | Docker + systemd |
| Processes | **Non-conforme** | Sessions en mémoire par worker (voir §7) |
| Port binding | Conforme | Ports 8000, 3000, 3001 configurables |
| Concurrency | **Partiellement** | 4 workers uvicorn + 4 workers Celery mais sessions non partageables |
| Disposability | **Partiellement** | `clear_all()` au shutdown, mais états en mémoire perdus |
| Dev/prod parity | Bonne | Docker Compose dev/prod avec overrides |
| Logs | Partiellement | Logs fichiers, pas de structured logging centralisé |
| Admin processes | Conforme | Scripts dédiés, Celery beat pour tâches récurrentes |

### 5.2 Tokens en mémoire côté client (sécurité)

`apps/web/src/lib/api.ts` stocke le token d'auth dans une variable de module JavaScript :

```typescript
// apps/web/src/lib/api.ts:14
let authToken: string | null = null;  // module-level variable

export function setAuthToken(token: string | null) {
  authToken = token;
}
```

Ce pattern est **non sécurisé en SSR** — les variables de module Next.js sont partagées entre les requêtes en Server Components si ce code s'exécute côté serveur. En Client Component, c'est de la mémoire volatile (perdue au refresh).

### 5.3 Secrets sans validation au démarrage

`app/config.py` charge les secrets via Pydantic Settings mais sans validation de présence pour les secrets critiques en production :

```python
stripe_secret_key: str = ""          # Défaut vide acceptable ?
stripe_webhook_secret: str = ""      # Idem
auth_jwt_public_key: str = ""        # Accepte le dev-mode-no-jwt-required
```

Un démarrage en production avec `stripe_secret_key = ""` ou `auth_jwt_public_key = ""` ne lèvera pas d'erreur. La logique de dev-mode dans `auth.py:282` (`if settings.is_development and settings.auth_jwt_public_key == "dev-mode-no-jwt-required"`) est une porte dérobée qui doit être auditée pour s'assurer qu'elle ne peut pas s'activer en production.

### 5.4 JWKS cache global (race condition)

```python
# app/middleware/auth.py:99
_jwks_cache: dict = {}
_jwks_cache_time: float = 0
```

Ce cache JWKS est une variable globale de module sans verrou. Dans un environnement multi-worker (4 workers uvicorn), chaque worker a son propre espace mémoire — le cache est donc dupliqué, non partagé. Avec Uvicorn en mode multi-process, une requête sur chaque worker déclenchera un fetch JWKS séparé à l'expiration du cache. Pas critique mais inefficace.

---

## 6. Testabilité

### État actuel

| Composant | Tests | Type |
|-----------|-------|------|
| `tests/unit/test_helpers.py` | 144 lignes | Unitaire |
| `tests/unit/test_coordinates.py` | 89 lignes | Unitaire |
| `tests/integration/test_api_health.py` | 32 lignes | Intégration |
| `tests/integration/test_api_keys.py` | 764 lignes | Intégration |
| `tests/integration/test_websocket_collaboration.py` | 410 lignes | Intégration |
| **Total** | **~1 440 lignes** | — |

**113 fichiers Python de production pour ~1 440 lignes de tests** — couverture estimée très inférieure au seuil minimum de 80%.

### Obstacles à la testabilité

1. **Singletons non injectables** : `document_service`, `quota_service`, `stripe_service` sont des singletons de module. Pour mocker `stripe_service` dans un test, il faut patcher le module `app.services.stripe_service.stripe_service` — couplage fort à l'implémentation.

2. **Imports différés** : Les imports inline dans les handlers (`from app.services.s3_service import s3_service` en ligne 267 de `storage.py`) sont difficiles à mocker sans `unittest.mock.patch`.

3. **DocumentSessionManager avec `threading.RLock`** : voir §7 — impact sur les tests async.

4. **Absence de couche repository abstraite** : pas d'interface pour `DocumentSessionManager`, impossible de substituer une implémentation in-memory pour les tests.

---

## 7. Scalabilité — bottlenecks architecturaux

### 7.1 CRITIQUE — Sessions PDF en mémoire avec 4 workers Uvicorn

**C'est le bottleneck architectural le plus sévère de l'ensemble du système.**

Le `DocumentSessionManager` maintient un dictionnaire en mémoire (`OrderedDict`) protégé par un `threading.RLock` :

```python
# app/repositories/document_repo.py:140
self._lock = threading.RLock()  # Verrou threading (bloquant) dans un contexte async

# Déployé avec 4 workers Uvicorn indépendants
# ExecStart=.../uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

**Problème** : avec 4 workers Uvicorn (`--workers 4`), chaque worker est un **processus séparé** avec son propre espace mémoire. Une session créée par le worker A sur `POST /documents/upload` peut ne **jamais être trouvée** par le worker B qui reçoit la requête suivante `GET /documents/{id}`. Nginx ne configure **aucune affinité de session** (`ip_hash` absent, round-robin pur).

Le `DocumentSessionManager._get_redis()` tente de pallier cela en chargeant depuis Redis, mais :
- `get_session()` (synchrone) ne charge pas depuis Redis — uniquement le cache local
- `get_session_async()` charge depuis Redis mais exige d'être attendu
- Plusieurs routers appellent `document_sessions.get_session()` (sync) directement

Résultat : des requêtes de type "document non trouvé" sont déterministiquement reproductibles sous charge avec plusieurs workers.

**Le `threading.RLock` dans un contexte asyncio bloque l'event loop** si un coroutine acquiert le verrou pendant qu'une autre l'attend — c'est une erreur de conception fondamentale pour un serveur async.

### 7.2 HAUT — Traitement PDF sans limite de ressources par requête

`app/services/document_service.py:upload_document` charge l'intégralité du PDF en mémoire (jusqu'à 500 MB par la configuration `max_upload_size_mb: 500`). Avec 4 workers et des uploads simultanés, la RAM requise peut atteindre 4 × 500 MB = 2 GB uniquement pour les uploads — la limite mémoire container de production est fixée à 2 GB.

`app/repositories/document_repo.py` stocke également les bytes PDF complets dans `DocumentSession._pdf_bytes` pour la sérialisation Redis. Un document de 100 MB stocké dans 100 sessions actives représente 10 GB de Redis.

### 7.3 HAUT — Dual PDF processing path non coordonné

Deux systèmes traitent les PDFs en production :
- **Path A** : `POST /api/v1/documents/upload` → Python `document_service` → `pdf_engine` Python
- **Path B** : `POST /api/pdf/open` → Next.js route → `@giga-pdf/pdf-engine` TypeScript

Les paths A et B produisent des représentations différentes du même document (scène graph Python vs structure TypeScript). Il n'existe pas de mécanisme de synchronisation entre les deux états.

### 7.4 MOYEN — Max 100 sessions actives par worker

```python
# app/repositories/document_repo.py:141
max_sessions: int = 100
```

Avec 4 workers, le système peut gérer au maximum 400 sessions actives simultanées en mémoire locale (si le fallback Redis fonctionne). Pour un SaaS avec une base d'utilisateurs croissante, cette limite est contraignante.

### 7.5 MOYEN — PostgreSQL 16 en production (règle = PostgreSQL 17+)

Le `docker-compose.yml` utilise `postgres:16-alpine` alors que les règles du projet imposent PostgreSQL 17 minimum (support MERGE, GROUP BY ALL, incremental backup).

### 7.6 BAS — Node.js engine >= 20.0.0 (règle = Node.js 22 LTS)

Le `package.json` root requiert `node >= 20.0.0` alors que les règles imposent Node.js 22 LTS minimum.

---

## 8. Findings priorisés

### CRITIQUE

| ID | Finding | Localisation | Impact |
|----|---------|-------------|--------|
| C-01 | **Sessions PDF en mémoire incompatibles avec multi-workers** — `threading.RLock` bloquant dans asyncio + dict local non partagé entre workers Uvicorn | `app/repositories/document_repo.py:140-144`, `deploy/systemd/*.service:ExecStart --workers 4` | Race condition production, perte de sessions, erreurs 404 déterministiques sous charge |
| C-02 | **Migration PDF engine Python→TypeScript partiellement déployée** — code DEPRECATED actif en production, deux paths de traitement divergents | `app/services/document_service.py:1`, `app/api/v1/merge_split.py:1`, `app/api/v1/security.py:1`, `apps/web/src/app/api/pdf/*.ts` | Comportements inconsistants selon le chemin d'appel, dette impossible à rembourser sans migration complète |
| C-03 | **Token auth en variable de module JS côté web** — `let authToken: string | null = null` risque de fuite inter-requête en SSR | `apps/web/src/lib/api.ts:14` | Fuite de token entre utilisateurs en mode Server-Side Rendering |

### HAUT

| ID | Finding | Localisation | Impact |
|----|---------|-------------|--------|
| H-01 | **Logique métier DB dans les routers** — 21 `get_db_session()` directs + requêtes SQLAlchemy dans les handlers HTTP | `app/api/v1/billing.py:81,212,322,468,592,696,803,934,1010,1096,1201,1287`, `app/api/v1/storage.py:214,251,268` | Violation SRP, code non testable par injection, duplication de logique |
| H-02 | **Traitement PDF jusqu'à 500 MB en RAM par requête** — 4 workers × 500 MB uploads simultanés = 2 GB RAM (= limite container prod) | `app/config.py:83`, `app/services/document_service.py:71-74`, `docker-compose.prod.yml` | OOM Kill du container API sous charge moyenne |
| H-03 | **peerDependencies React 18 sur packages internes** — `@giga-pdf/api` et `@giga-pdf/billing` déclarent React 18 en peerDep alors que le monorepo force React 19.2 | `packages/api/package.json:33`, `packages/billing/package.json:43` | Turbo ignore les peerDeps internes pour le build order, faux positifs d'audit de dépendances |
| H-04 | **Dual schéma de données utilisateur** — SQLAlchemy Python et Prisma Next.js gèrent des modèles `User` différents sur la même DB | `app/models/database.py`, `apps/web/prisma/schema.prisma` | Incohérence des données, migrations conflictuelles, ownership flou |
| H-05 | **share_service.py God Class** — 1 048 lignes gérant partages, permissions, liens publics, membres tenant, notifications | `app/services/share_service.py:1-1048` | Violation SRP, impossible à tester atomiquement, régression à chaque modification |

### MOYEN

| ID | Finding | Localisation | Impact |
|----|---------|-------------|--------|
| M-01 | **Imports différés dans les handlers** — `from app.x import y` à l'intérieur des fonctions handler | `app/api/v1/storage.py:213-227` | Cache d'imports non actif, couplage caché à l'analyse statique, performance marginalement impactée |
| M-02 | **Singletons non injectables** — 15 singletons de module bypass FastAPI DI | `app/services/*.py` (15 fichiers, lignes finales) | Difficultés de test par mock, couplage à l'implémentation concrète |
| M-03 | **App mobile sans packages partagés** — Expo app appelle l'API sans `@giga-pdf/api` ni types | `apps/mobile/package.json` | Duplication des types API côté mobile, divergence silencieuse |
| M-04 | **JWKS cache global par worker** — cache mémoire non synchronisé entre workers | `app/middleware/auth.py:99-100` | Inefficacité (N fetches JWKS simultanés au redémarrage), pas de single source of truth |
| M-05 | **Secrets critiques sans validation production** — `stripe_secret_key`, `auth_jwt_public_key` acceptent chaîne vide | `app/config.py:115,50` | Démarrage silencieux en production sans Stripe/auth configuré |
| M-06 | **Max 100 sessions/worker** — limite LRU locale insuffisante pour la croissance | `app/repositories/document_repo.py:141` | Éviction prématurée de sessions actives sous charge |
| M-07 | **`@giga-pdf/billing` couple UI et transport réseau** — dépend de `@giga-pdf/api` (Axios + TanStack Query) | `packages/billing/package.json:7-9` | Package UI non réutilisable sans client API complet |

### BAS

| ID | Finding | Localisation | Impact |
|----|---------|-------------|--------|
| B-01 | **PostgreSQL 16 en production** — règle impose PostgreSQL 17+ | `docker-compose.yml:12` | Manque de MERGE, incremental backup, GROUP BY ALL |
| B-02 | **Node.js engine >= 20 déclaré** — règle impose Node.js 22 LTS | `package.json:49` | Manque native TS stripping, permissions model v22 |
| B-03 | **middleware.ts au lieu de proxy.ts** — règle Next.js 16 impose proxy.ts | `apps/web/middleware.ts` | Non-conformité Next.js 16, confusion lors de la migration |
| B-04 | **Couverture de tests < 80%** — 9 fichiers de tests pour 113 fichiers Python | `tests/` | Risque de régression non détectée |
| B-05 | **TODO non résolu dans le repository** — `# TODO: after full TS-engine migration, store/retrieve doc_id only` | `app/repositories/document_repo.py:381` | Migration bloquée, dette technique documentée non adressée |

---

## 9. Recommandations architecturales prioritaires

### 1. Résoudre C-01 : Stratégie de session stateless ou sticky

**Option A (recommandée à court terme)** : Forcer tous les accès session via Redis — remplacer `get_session()` synchrone par `get_session_async()` dans tous les callers, ou passer en single-worker avec Gunicorn + gevent.

**Option B (moyen terme)** : Migrer vers un modèle stateless — ne pas stocker l'état PDF binaire en mémoire. Charger depuis Redis ou S3 à chaque requête, libérer après réponse.

**Option C (long terme)** : Compléter la migration TypeScript (C-02), le Next.js API Route engine n'a pas ce problème car chaque requête recrée le contexte.

### 2. Compléter C-02 : Finaliser la migration PDF engine

Établir une date de fin pour la migration. Toutes les routes FastAPI marquées `DEPRECATED` doivent être soit retirées (si la route TS équivalente existe), soit dé-dépréciées (si la route TS n'est pas encore en production).

### 3. Résoudre H-01 : Extraire la logique DB des routers

Créer des services dédiés (`BillingService`, `StorageService`) qui encapsulent les requêtes SQLAlchemy. Les routers ne doivent qu'appeler les services et formater les réponses.

### 4. Résoudre C-03 : Supprimer le token en variable de module

Utiliser les cookies HttpOnly (BetterAuth gère déjà cela via `better-auth.session_token`) plutôt qu'un token stocké en mémoire JS. Le client API doit lire le cookie automatiquement ou passer par les Server Actions Next.js.

---

*Audit basé sur l'analyse statique du code source — aucune modification de fichier effectuée.*
