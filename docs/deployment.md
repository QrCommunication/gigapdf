# GigaPDF — Procédure de déploiement (installation native Ploi)

> Infrastructure : VPS giga-pdf.com (Ploi) — Ubuntu 24.04, Node 24, Python 3.14, PostgreSQL 18, Redis
> Stack : FastAPI (uvicorn 4 workers) + Next.js standalone + Celery, derrière Nginx + systemd
> Utilisateur : `ploi` (sudo passwordless)
> Chemin repo : `/home/ploi/giga-pdf.com`

---

## Architecture

```
giga-pdf.com      → Next.js Web  (port 3000) → systemd gigapdf-web
admin.giga-pdf.com → Next.js Admin (port 3001) → systemd gigapdf-admin
api.giga-pdf.com   → FastAPI      (port 8000) → systemd gigapdf-api
Celery workers     → systemd gigapdf-celery, gigapdf-celery-billing
```

Nginx (géré par Ploi) proxy vers les ports locaux. Les certificats SSL sont
gérés par Ploi via Let's Encrypt dans `/etc/nginx/ssl/<domain>`.

### Sous-domaine API

Le fichier `/etc/nginx/sites-available/api.giga-pdf.com` est configuré pour
proxyer vers `127.0.0.1:8000`. Le bloc `listen 443 ssl` et les certificats
sont inclus via `/etc/nginx/ssl/api.giga-pdf.com` (géré par Ploi) — ne pas
ajouter de directive `listen 443` dans le site pour éviter les conflits.

---

## Installation initiale (première mise en place)

### Prérequis système

```bash
sudo apt update && sudo apt install -y \
  python3.14-venv postgresql-18-pgvector redis-server nginx curl git
sudo corepack enable
sudo corepack prepare pnpm@9 --activate
```

### Base de données

```bash
sudo -u postgres psql -c "CREATE USER gigapdf WITH PASSWORD 'gigapdf';"
sudo -u postgres psql -c "CREATE DATABASE gigapdf OWNER gigapdf;"
sudo -u postgres psql -c "CREATE DATABASE gigapdf_celery OWNER gigapdf;"
sudo -u postgres psql -d gigapdf -c "GRANT ALL PRIVILEGES ON DATABASE gigapdf TO gigapdf;"
sudo -u postgres psql -d gigapdf -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Variables d'environnement

```bash
cd /home/ploi/giga-pdf.com
cp .env.example .env
# Éditer : APP_SECRET_KEY, INTERNAL_API_SECRET, S3_*, STRIPE_*, RESEND_*, etc.
```

**Stockage objet (iDrive e2)** :

```ini
STORAGE_PROVIDER=idrive
S3_ENDPOINT=https://s3.eu-west-4.idrivee2.com
S3_REGION=eu-west-4
S3_ACCESS_KEY_ID=<from console e2>
S3_SECRET_ACCESS_KEY=<from console e2>
S3_BUCKET_NAME=gigapdf
```

### Environnement Python

```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install psycopg[binary]
```

### Environnement Node.js

```bash
pnpm install --frozen-lockfile
ln -sf /home/ploi/giga-pdf.com/.env apps/web/.env
ln -sf /home/ploi/giga-pdf.com/.env apps/admin/.env
pnpm --filter "!web" --filter "!admin" --filter "!mobile" build
pnpm --filter web build
pnpm --filter admin build
```

### Copie des artefacts standalone

```bash
for app in web admin; do
  STANDALONE="apps/$app/.next/standalone/apps/$app"
  mkdir -p "$STANDALONE/.next"
  rsync -a --delete "apps/$app/.next/static/" "$STANDALONE/.next/static/"
  [ -d "apps/$app/public" ] && rsync -a --delete "apps/$app/public/" "$STANDALONE/public/"
done
```

### Migrations base de données

```bash
.venv/bin/alembic upgrade head
sudo -u postgres psql -d gigapdf -f deploy/init-betterauth-tables.sql
```

### Services systemd

```bash
sudo cp deploy/systemd/gigapdf-*.service /etc/systemd/system/
sudo sed -i "s|/opt/gigapdf|/home/ploi/giga-pdf.com|g" /etc/systemd/system/gigapdf-*.service
sudo sed -i "s|User=gigapdf|User=ploi|g" /etc/systemd/system/gigapdf-*.service
sudo sed -i "s|Group=gigapdf|Group=ploi|g" /etc/systemd/system/gigapdf-*.service
sudo systemctl daemon-reload
sudo systemctl enable --now gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing
```

> ⚠️ Les directives `ProtectSystem=strict`, `PrivateTmp=true`, `ReadWritePaths`
> ont été retirées car elles bloquaient le démarrage sur cet hôte Ploi.
> La sécurité repose sur UFW + l'utilisateur dédié `ploi`.

### Répertoires runtime

```bash
sudo mkdir -p /var/lib/gigapdf/documents/exports /var/lib/gigapdf/fastembed-cache /var/lib/gigapdf/rten-models
sudo chown -R ploi:ploi /var/lib/gigapdf
sudo chmod -R 2775 /var/lib/gigapdf
sudo mkdir -p /var/log/gigapdf
sudo chown ploi:ploi /var/log/gigapdf
```

---

## Mise à jour (déploiements suivants)

```bash
ssh ploi@giga-pdf.com
cd /home/ploi/giga-pdf.com
git pull origin main
.venv/bin/pip install -r requirements.txt -q
pnpm install --frozen-lockfile
pnpm --filter "!web" --filter "!admin" --filter "!mobile" build
pnpm --filter web build
pnpm --filter admin build
for app in web admin; do
  STANDALONE="apps/$app/.next/standalone/apps/$app"
  mkdir -p "$STANDALONE/.next"
  rsync -a --delete "apps/$app/.next/static/" "$STANDALONE/.next/static/"
  [ -d "apps/$app/public" ] && rsync -a --delete "apps/$app/public/" "$STANDALONE/public/"
done
.venv/bin/alembic upgrade head
sudo systemctl restart gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing
sleep 5
systemctl is-active gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing
```

---

## Surveillance

```bash
systemctl is-active gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing
sudo journalctl -u gigapdf-api -f --no-pager -n 50
sudo journalctl -u gigapdf-web -f --no-pager -n 50
curl -s http://localhost:8000/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
curl -s -o /dev/null -w "%{http_code}" https://api.giga-pdf.com/health
```

---

## Vérification post-installation

| Check        | Commande                                                          | Attendu              |
|--------------|-------------------------------------------------------------------|----------------------|
| API locale   | `curl http://localhost:8000/health`                               | `200`                |
| Web local    | `curl http://localhost:3000`                                      | `200`                |
| Admin local  | `curl http://localhost:3001/login`                                | `200`                |
| API publique | `curl https://api.giga-pdf.com/health`                            | `200`                |
| Celery       | `journalctl -u gigapdf-celery --no-pager -n 3`                   | `celery@gigapdf ready` |
| DB           | `sudo -u postgres psql -d gigapdf -c "SELECT count(*) FROM alembic_version"` | ≥ 1          |
| S3           | Admin → Paramètres → Tester le stockage                           | connexion OK         |

---

## Fichiers concernés

| Fichier                              | Rôle                          |
|--------------------------------------|-------------------------------|
| `deploy/systemd/gigapdf-*.service`   | Unités systemd (5 services)   |
| `deploy/init-betterauth-tables.sql`  | Tables Better Auth (idempotent) |
| `deploy/nginx.conf`                  | Config nginx complète         |
| `docs/storage.md`                    | Configuration stockage objet  |
| `.env`                               | Variables d'environnement     |