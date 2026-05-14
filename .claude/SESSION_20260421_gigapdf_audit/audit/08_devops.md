# Audit DevOps/Infrastructure — GigaPDF
**Session** : SESSION_20260421_gigapdf_audit  
**Date** : 2026-04-21  
**Scope** : CI/CD, Docker, VPS Scaleway, Nginx, systemd, monitoring, backups, sécurité infra, scalabilité, versioning  

---

## Résumé Exécutif

L'infrastructure de GigaPDF repose sur un VPS Scaleway unique (51.159.105.179, 32GB/8CPU, Ubuntu 24.04 LTS), un déploiement par hook git post-receive, des services systemd, et Nginx comme reverse-proxy. L'architecture est fonctionnelle et contient plusieurs bonnes pratiques (TLS 1.2+1.3, headers sécurité, rate limiting, utilisateurs non-root dans Docker). Cependant, des lacunes critiques existent : absence totale de CI/CD automatisée, zéro monitoring/observabilité, aucun backup PostgreSQL automatisé, et plusieurs configurations pointant encore vers l'ancien VPS.

---

## 1. CI/CD

### Constat

Aucun dossier `.github/` n'existe dans le projet. Il n'y a aucun workflow GitHub Actions, aucun pipeline GitLab CI, aucune intégration de CI/CD automatisée.

Le déploiement est exclusivement manuel via :
- `deploy/push-deploy.sh` (script local) — git push vers le remote `production`
- Hook git `post-receive` sur le serveur → exécute `deploy/deploy.sh`

`deploy/push-deploy.sh` (ligne 17) cible encore l'**ancien VPS** (`REMOTE_HOST="51.15.197.29"`, `REMOTE_USER="root"`) — adresse IP obsolète depuis la migration du 2026-03-12.

### Findings

| Sévérité | Finding | Fichier:Ligne |
|----------|---------|--------------|
| **CRITIQUE** | Aucune CI/CD : pas de lint, type-check, tests, security scan avant deploy | N/A |
| **CRITIQUE** | `push-deploy.sh` pointe sur l'ancien VPS IP `51.15.197.29` et user `root` | `deploy/push-deploy.sh:17-18` |
| **HAUT** | Pas de gate de qualité : un commit cassé peut partir directement en prod | N/A |
| **HAUT** | Pas de security scanning automatique (`pnpm audit`, `pip-audit`, Snyk) | N/A |
| **MOYEN** | Pas de staging environment — deploy direct local→prod | N/A |
| **MOYEN** | `package.json` requiert `node >= 20` mais Node 22 LTS est installé sur le serveur (incohérence engines) | `package.json:49` |
| **BAS** | `setup-server.sh` installe Node 20 (`setup_20.x`) alors que la prod utilise Node 22 | `deploy/setup-server.sh:68` |

### Recommandations

1. Créer `.github/workflows/ci.yml` avec les étapes : lint → type-check → tests → build → `pnpm audit` + `pip-audit` → deploy staging (auto sur `develop`) → deploy prod (approbation manuelle sur `main`)
2. Corriger `push-deploy.sh` : `REMOTE_HOST="51.159.105.179"`, `REMOTE_USER="ubuntu"`, SSH key `~/.ssh/id_ed25519`
3. Aligner `package.json` engines : `"node": ">=22.0.0"`, `"pnpm": ">=10.0.0"`
4. Corriger `setup-server.sh` : `setup_22.x` au lieu de `setup_20.x`

---

## 2. Docker

### Constat

Trois Dockerfiles existent (`Dockerfile.api`, `Dockerfile.web`, `Dockerfile.admin`) ainsi que trois docker-compose (`docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`). Un `.dockerignore` complet est présent.

Docker n'est **pas utilisé en production** : le déploiement réel se fait via systemd + virtualenv Python directement sur le VPS. Les Dockerfiles existent pour le développement local et une éventuelle migration future.

### Findings

| Sévérité | Finding | Fichier:Ligne |
|----------|---------|--------------|
| **HAUT** | `docker-compose.yml` : image PostgreSQL `postgres:16-alpine` — règle oblige PostgreSQL 17 | `docker-compose.yml:13` |
| **HAUT** | Port PostgreSQL `5432` exposé publiquement dans docker-compose dev — risque si bind sur 0.0.0.0 | `docker-compose.yml:22-24` |
| **MOYEN** | `Dockerfile.api` : tag `python:3.12-slim-bookworm` sans version patch exacte (ex: `3.12.9`) — non-reproductible | `Dockerfile.api:3` |
| **MOYEN** | `Dockerfile.web/admin` : tag `node:22-alpine` sans version patch (ex: `22.11.0-alpine3.20`) | `Dockerfile.web:4`, `Dockerfile.admin:4` |
| **MOYEN** | `Dockerfile.api` : pas de `dumb-init` — PID 1 sans signal handling approprié | `Dockerfile.api` |
| **MOYEN** | `docker-compose.prod.yml` désactive postgres/redis locaux (bon) mais ne définit pas les connexions externes — incomplet | `docker-compose.prod.yml:87-94` |
| **BAS** | `Dockerfile.web/admin` : pas de `--enable-source-maps` dans le CMD Node.js | `Dockerfile.web:85` |
| **BAS** | `.dockerignore` exclut `tests/` — correct, mais exclut aussi les `*.md` ce qui retire potentiellement des fichiers nécessaires aux build-time | `.dockerignore:76` |

### Éléments positifs

- Multi-stage build correct dans les trois Dockerfiles (deps → builder → production)
- Utilisateur non-root dans les trois images (`gigapdf:gigapdf` pour Python, `nextjs:nodejs` pour Node)
- `corepack enable && corepack prepare pnpm@10.28.0` — version pnpm épinglée
- `--frozen-lockfile` dans les stages deps
- Health checks définis dans Docker et dans docker-compose
- `.dockerignore` complet : `.env`, `*.pem`, `node_modules`, `.next`, `.venv` exclus

---

## 3. VPS Production

### Constat

Déploiement via systemd, 5 services actifs. Nginx configuré avec TLS, rate limiting, headers sécurité. Mise à jour du code via `git push production main` + hook post-receive.

### Findings

| Sévérité | Finding | Fichier:Ligne |
|----------|---------|--------------|
| **CRITIQUE** | Pas de zero-downtime deploy : `deploy.sh` stoppe TOUS les services avant redémarrage (downtime ~1-5 min à chaque déploiement) | `deploy/deploy.sh:230-237` |
| **HAUT** | Services systemd tournent en `User=ubuntu` — l'utilisateur `ubuntu` a `sudo sans mot de passe`, surface d'attaque élevée | `deploy/systemd/gigapdf-api.service:6` |
| **HAUT** | `setup-server.sh` crée un user `gigapdf` mais les services tournent sous `ubuntu` — incohérence, le principe de moindre privilege n'est pas appliqué | `deploy/setup-server.sh:81-83`, `deploy/systemd/gigapdf-api.service:6` |
| **HAUT** | `deploy.sh` ligne 194 : silencing des exceptions SQL (`except Exception as e: pass`) lors de la création des tables Better Auth — une erreur critique pourrait passer inaperçue | `deploy/deploy.sh:194` |
| **MOYEN** | `deploy.sh` installe la Scaleway CLI via `curl | sh` à chaque déploiement si non présente — pratique risquée (supply chain) | `deploy/deploy.sh:76-78` |
| **MOYEN** | Nginx check `if [ -f /etc/letsencrypt/live/giga-pdf.com/fullchain.pem ]` — pas de vérification que le cert couvre `api.giga-pdf.com` (SAN ou wildcard nécessaire) | `deploy/deploy.sh:217` |
| **MOYEN** | `HSTS max-age=63072000` (2 ans) sans `includeSubDomains` ni `preload` — incohérent avec les best practices HSTS | `deploy/nginx.conf:61`, `deploy/nginx.conf:198` |
| **MOYEN** | `X-Frame-Options: SAMEORIGIN` — pour une API publique, `DENY` serait plus approprié | `deploy/nginx.conf:63` |
| **MOYEN** | Nginx production n'a pas de bloc `admin.giga-pdf.com` — l'admin est servi sous `/admin` sur le domaine principal, ce qui est moins isolé | `deploy/nginx.conf:310-319` |
| **BAS** | `client_max_body_size 500M` exposé publiquement — très grand, devrait être restreint aux routes upload uniquement | `deploy/nginx.conf:83` |
| **BAS** | Log rotation configurée sur 14 jours — insuffisant pour RGPD (30 jours minimum recommandé) | `deploy/setup-server.sh:207` |
| **BAS** | `deploy.sh` crée des symlinks `.env` pour apps (ligne 55-56) — les apps web et admin partagent le même `.env` global, risque de fuite de variables backend vers le frontend | `deploy/deploy.sh:55-56` |

### Éléments positifs

- TLS 1.2 + 1.3 uniquement, ciphers modernes, `ssl_session_tickets off`
- `ssl_prefer_server_ciphers off` (correct pour TLS 1.3)
- Rate limiting défini (`api_limit: 30r/s`, `upload_limit: 5r/s`)
- Headers sécurité présents : `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`
- CORS strictement limité à `https://giga-pdf.com` (pas de wildcard)
- Health check endpoint `/health` présent sur API et Nginx
- `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict` dans les unités systemd API et Celery
- Log rotation configurée avec `logrotate`
- `set -e` dans deploy.sh (fail-fast sur erreur)

---

## 4. Monitoring & Observabilité

### Constat

Aucun outil de monitoring, observabilité, ou error tracking n'est configuré. Aucune dépendance Sentry, Datadog, Prometheus, Grafana, OpenTelemetry n'est présente dans `requirements.txt` ni dans `package.json` (seul `pnpm-lock.yaml` contient une référence isolée).

### Findings

| Sévérité | Finding | Fichier |
|----------|---------|---------|
| **CRITIQUE** | Aucun error tracking (Sentry / Rollbar) — les erreurs production sont silencieuses | N/A |
| **CRITIQUE** | Aucune métrique applicative (Prometheus / Datadog) — pas de visibility sur latence, saturation, taux d'erreur | N/A |
| **HAUT** | Aucun uptime monitoring externe (UptimeRobot, BetterStack, Pingdom) | N/A |
| **HAUT** | Logs fichiers plats (`/var/log/gigapdf/*.log`) — pas de centralisation, pas de recherche, pas d'alerting | `deploy/systemd/gigapdf-api.service:17-18` |
| **MOYEN** | Pas d'alerting sur CPU > 80%, mémoire > 85%, disk > 90% | N/A |
| **MOYEN** | Health check de l'API (`/health`) existe en endpoint mais n'est pas consommé par un watchdog externe | `deploy/deploy.sh:267-271` |
| **BAS** | `psutil` est installé (permet monitoring system) mais n'est pas utilisé dans un endpoint `/metrics` | `requirements.txt:44` |

### Recommandations

1. **Sentry** : ajouter `sentry-sdk[fastapi]` dans `requirements.txt` et `@sentry/nextjs` dans les apps — configuration en 30 minutes, ROI maximum
2. **UptimeRobot** (gratuit) ou **BetterStack** : configurer alertes sur `https://giga-pdf.com/health` et `https://api.giga-pdf.com/health`
3. **Logs** : configurer `journald` avec forward vers un service centralisé (Loki + Grafana sur le même VPS, ou Logtail/Betterstack)
4. Exposer un endpoint `/metrics` Prometheus via `prometheus-fastapi-instrumentator` si on veut des métriques fines

---

## 5. Backups

### Constat

Aucun script de backup PostgreSQL automatisé n'existe dans le projet. La documentation `DEPLOYMENT.md` mentionne `pg_dump` dans la section "Backup & Recovery" mais aucun cron, script ou service n'est configuré.

Le stockage S3 Scaleway est utilisé pour les fichiers (PDFs uploadés). Aucune configuration de versioning S3 n'est visible dans le code.

### Findings

| Sévérité | Finding | Fichier |
|----------|---------|---------|
| **CRITIQUE** | Aucun backup PostgreSQL automatisé — perte de données totale possible en cas de crash disque | N/A |
| **CRITIQUE** | Aucun test de restore documenté ou automatisé | N/A |
| **HAUT** | Redis sans persistance AOF dans la config systemd (uniquement en dev Docker avec `--appendonly yes`) — files Celery perdues au redémarrage | `docker-compose.yml:34`, `deploy/systemd/gigapdf-celery.service` |
| **HAUT** | Credentials PostgreSQL en clair dans la mémoire projet : `gigapdf:gigapdf_prod_2026@localhost` | `memory/reference_deployment.md:7` |
| **MOYEN** | Pas de versioning S3 activé explicitement — impossible de récupérer un PDF écrasé | N/A |
| **MOYEN** | Rétention des backups non définie | N/A |
| **BAS** | Pas de backup du répertoire `/var/lib/gigapdf/documents` (stockage local en complément S3) | N/A |

### Recommandations

1. Créer `/opt/gigapdf/scripts/backup-db.sh` avec `pg_dump` compressé vers S3 :
   ```bash
   pg_dump -Fc gigapdf | aws s3 cp - s3://gigapdf-backups/db/$(date +%Y%m%d_%H%M%S).dump
   ```
2. Cron quotidien à 3h, rétention 30 jours
3. Activer versioning S3 sur le bucket `gigapdf`
4. Configurer Redis persistance AOF sur le VPS : `redis-cli CONFIG SET appendonly yes`
5. Tester restore mensuel avec snapshot staging

---

## 6. Sécurité Infrastructure

### Constat

UFW est configuré (ports 22, 80, 443 uniquement). SSH par clé ed25519. Services systemd avec `NoNewPrivileges`, `PrivateTmp`. Fail2ban n'est pas configuré.

### Findings

| Sévérité | Finding | Fichier:Ligne |
|----------|---------|--------------|
| **CRITIQUE** | SSH sur port 22 standard sans fail2ban — brute force non mitigé | `deploy/setup-server.sh:151` |
| **CRITIQUE** | `deploy.sh` expose la clé publique SSH hardcodée dans le code versionné (`ssh-ed25519 AAAAC3...`) | `deploy/setup-server.sh:240` |
| **HAUT** | Services tournent sous `ubuntu` qui a `sudo NOPASSWD` — compromission d'un service = accès root complet | `deploy/systemd/*.service:6` |
| **HAUT** | Pas de `PermitRootLogin no` ni `PasswordAuthentication no` documenté/automatisé dans `setup-server.sh` | `deploy/setup-server.sh` |
| **HAUT** | `.env.production` dans le repo Git (même si gitignored) — template contient des valeurs partiellement renseignées (`DATABASE_URL=postgresql://rlicha:YOUR_PASSWORD_HERE`) | `deploy/.env.production.example:14` |
| **MOYEN** | Credentials PostgreSQL stockés en clair dans la mémoire projet Claude | `memory/reference_deployment.md:7` |
| **MOYEN** | Pas de fail2ban configuré pour Nginx (protection DDoS/scraping limitée au rate limiting) | N/A |
| **MOYEN** | `push-deploy.sh` : `REMOTE_USER="root"` (ancien VPS) — preuve que root SSH était utilisé | `deploy/push-deploy.sh:16` |
| **BAS** | CSP header absent de la config Nginx — uniquement X-Frame-Options, X-Content-Type-Options | `deploy/nginx.conf:63-66` |
| **BAS** | `Permissions-Policy` header absent | `deploy/nginx.conf` |
| **BAS** | `X-XSS-Protection: 1; mode=block` — header obsolète (recommandation : valeur `0`) | `deploy/nginx.conf:65` |

### Recommandations

1. Installer et configurer `fail2ban` avec jail SSH et Nginx
2. Migrer les services vers un utilisateur dédié `gigapdf` (non-sudo) comme prévu dans `setup-server.sh`
3. Ajouter dans `setup-server.sh` :
   ```bash
   sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
   sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
   ```
4. Ajouter en-têtes Nginx : `Content-Security-Policy`, `Permissions-Policy`, corriger `X-XSS-Protection: 0`
5. Changer le mot de passe PostgreSQL prod (valeur `gigapdf_prod_2026` potentiellement compromise)

---

## 7. Scalabilité

### Constat

Architecture single-node sans load balancer. Les uploads de fichiers sont stockés localement (`/var/lib/gigapdf/documents`) en plus de S3. Les sessions utilisateur passent par PostgreSQL (Better Auth). Redis est local.

### Findings

| Sévérité | Finding | Fichier |
|----------|---------|---------|
| **HAUT** | Stockage local des documents (`/var/lib/gigapdf/documents`) — impossible de scaler horizontalement | `deploy/.env.production.example:33` |
| **HAUT** | Pas de load balancer — single point of failure total | N/A |
| **MOYEN** | 4 workers uvicorn sur un seul processus — pas de supervision Gunicorn, crash = downtime | `deploy/systemd/gigapdf-api.service:12` |
| **MOYEN** | `NODE_OPTIONS="--max-old-space-size=1024"` dans deploy.sh (build) vs `1536` pour Next.js — risque OOM si build concurrent | `deploy/deploy.sh:100`, `deploy/deploy.sh:120` |
| **BAS** | Celery concurrency fixe à 4 — pas d'autoscaling selon la charge queue | `deploy/systemd/gigapdf-celery.service:12` |
| **BAS** | Pas de CDN pour les assets statiques Next.js | N/A |

### Recommandations

1. Supprimer le stockage local : utiliser **exclusivement S3** pour tous les documents — préalable au scale-out
2. Ajouter Gunicorn devant uvicorn pour supervision des workers :
   `gunicorn -k uvicorn.workers.UvicornWorker -w 4 app.main:app`
3. Pour scale-out futur : Scaleway Load Balancer + 2 VPS identiques (stateless si S3 exclusif)

---

## 8. Versioning

### Constat

Le projet utilise `version: "1.0.0"` dans `package.json`. Aucun tag Git de release n'est présent dans l'historique récent des commits (les 5 derniers commits sont des `feat/fix`). Aucun `CHANGELOG.md` à la racine du projet. Pas de SemVer respecté en pratique.

### Findings

| Sévérité | Finding | Fichier:Ligne |
|----------|---------|--------------|
| **MOYEN** | Aucun tag Git de release — impossible de rollback rapide vers une version stable connue | N/A |
| **MOYEN** | `package.json` engines `node >= 20` mais le serveur utilise Node 22 — décalage de documentation | `package.json:49` |
| **BAS** | `version: "1.0.0"` figé — ne reflète pas l'état réel du produit | `package.json:3` |
| **BAS** | Pas de `CHANGELOG.md` projet | N/A |

### Recommandations

1. Adopter un workflow de release : à chaque deploy prod, créer un tag `git tag -a vX.Y.Z -m "..."` + push
2. Créer `CHANGELOG.md` à la racine avec le format Keep a Changelog
3. Mettre à jour `engines` : `"node": ">=22.0.0"`, `"pnpm": ">=10.0.0"`

---

## Tableau de Synthèse

| # | Sévérité | Domaine | Finding | Effort Fix |
|---|----------|---------|---------|-----------|
| 1 | CRITIQUE | CI/CD | Aucune pipeline CI/CD automatisée | Moyen (4-8h) |
| 2 | CRITIQUE | CI/CD | `push-deploy.sh` pointe sur ancien VPS (root@51.15.197.29) | Trivial (5 min) |
| 3 | CRITIQUE | Monitoring | Aucun error tracking (Sentry) | Faible (1-2h) |
| 4 | CRITIQUE | Monitoring | Aucune métrique / observabilité | Moyen |
| 5 | CRITIQUE | Backups | Aucun backup PostgreSQL automatisé | Faible (2h) |
| 6 | CRITIQUE | Backups | Aucun test de restore documenté | Moyen |
| 7 | CRITIQUE | Sécurité | SSH sans fail2ban sur port 22 | Faible (1h) |
| 8 | HAUT | CI/CD | Aucun security scanning automatique | Moyen |
| 9 | HAUT | Docker | PostgreSQL 16 dans docker-compose (règle : 17) | Trivial |
| 10 | HAUT | VPS | Downtime à chaque deploy (stop→start sans rolling) | Moyen |
| 11 | HAUT | VPS | Services en user `ubuntu` (sudo NOPASSWD) | Moyen |
| 12 | HAUT | Backups | Redis sans AOF sur VPS (queues perdues au crash) | Trivial |
| 13 | HAUT | Sécurité | Services en `ubuntu` avec sudo NOPASSWD = privesc triviale | Moyen |
| 14 | HAUT | Sécurité | Pas de `PermitRootLogin no` / `PasswordAuthentication no` documenté | Trivial |
| 15 | HAUT | Scalabilité | Stockage local documents bloque le scale-out | Haut |
| 16 | MOYEN | VPS | Deploy via `curl | sh` pour Scaleway CLI | Trivial |
| 17 | MOYEN | VPS | HSTS sans `includeSubDomains` ni `preload` | Trivial |
| 18 | MOYEN | Monitoring | Pas d'uptime monitoring externe | Trivial |
| 19 | MOYEN | Versioning | Pas de tags Git de release | Trivial |

---

## Priorités d'Action (30 jours)

### Semaine 1 — Correctifs critiques sans downtime
1. Corriger `push-deploy.sh` (IP + user + SSH key)
2. Configurer fail2ban SSH + Nginx
3. Intégrer Sentry FastAPI + Next.js (< 2h)
4. Créer script cron backup pg_dump → S3
5. Activer Redis AOF

### Semaine 2 — CI/CD minimal
6. Créer `.github/workflows/ci.yml` : lint + type-check + `pnpm audit` + `pip-audit`
7. Ajouter UptimeRobot sur `/health` endpoints
8. Corriger headers Nginx (CSP, Permissions-Policy, X-XSS-Protection)

### Semaine 3-4 — Hardening
9. Migrer services vers user `gigapdf` (non-sudo)
10. Configurer `PermitRootLogin no` + `PasswordAuthentication no`
11. Implémenter zero-downtime deploy (reload progressif des workers)
12. Tagger les releases Git + créer CHANGELOG.md

### Moyen terme (90 jours)
13. Migrer vers stockage S3 exclusif (supprimer stockage local)
14. Ajouter pipeline de deploy staging avant prod
15. Évaluer Gunicorn + supervision workers uvicorn
