# GigaPDF — Procédure de déploiement zero-downtime

> Infrastructure : VPS Scaleway x86_64 32 GB — `<your-vps-ip>`
> Stack : FastAPI (uvicorn 4 workers) + Next.js standalone + Celery, derrière Nginx + systemd

---

## Architecture de déploiement

```
git push origin main
        |
        v
   [deploy.sh]
        |
   1. git pull (code à jour, services toujours UP)
   2. pip install / pnpm install
   3. Build packages → Next.js web → Next.js admin
   4. Prisma generate + migrations Alembic
   5. Snapshot des artefacts → /opt/gigapdf-snapshots/<timestamp>/
   6. Nginx: copie conf + maintenance page
        |
        v
   [Restart séquentiel — services UP tout le long]
        |
   9a. systemctl reload gigapdf-api  ← SIGHUP, graceful, 0 connexion droppée
   9b. wait_healthy API (60s max)
   9c. systemctl restart gigapdf-celery + gigapdf-celery-billing
   9d. systemctl restart gigapdf-web   (downtime ~3-5s, nginx → maintenance.html)
   9e. systemctl restart gigapdf-admin
        |
   10. Health checks finaux → rollback automatique si échec
```

**Downtime effectif :**

| Service | Avant | Après |
|---------|-------|-------|
| FastAPI API | ~60-90 s (stop+start) | **0 s** (SIGHUP graceful reload) |
| Next.js Web | ~60-90 s | **~3-5 s** (restart rapide, nginx maintenance page) |
| Next.js Admin | ~60-90 s | **~3-5 s** (après web healthy) |
| Celery | ~5 s (tasks dans broker) | **~5 s** (inchangé, tâches survivent) |

---

## Déploiement standard

```bash
# Depuis la machine locale (ou CI)
git push origin main

# Sur le serveur (post-receive hook ou manuellement)
ssh ubuntu@<your-vps-ip>
cd /opt/gigapdf
git pull
bash deploy/deploy.sh
```

Le script sort avec code `0` si tout est sain, `1` si un service échoue (rollback déclenché automatiquement).

---

## Rollback

### Rollback automatique

Si un service ne répond pas dans les 60 s après restart, `deploy.sh` appelle automatiquement `scripts/rollback.sh --non-interactive`.

### Rollback manuel

```bash
ssh ubuntu@<your-vps-ip>

# Lister les snapshots disponibles
sudo bash /opt/gigapdf/scripts/rollback.sh --list

# Rollback vers le dernier snapshot connu-bon
sudo bash /opt/gigapdf/scripts/rollback.sh

# Rollback vers un snapshot spécifique
sudo bash /opt/gigapdf/scripts/rollback.sh 20260421_143022
```

**Ce que fait rollback.sh :**

1. Arrête tous les services
2. Restaure les artefacts de build (`.next/`, `packages/*/dist/`) depuis le snapshot
3. Redémarre tous les services
4. Valide que l'API répond sur `/health`

**Ce que rollback.sh ne touche PAS :**

- `.env` (reste en place)
- `.venv` Python (reste en place)
- `node_modules` (reste en place)
- Base de données (pas de down-migration automatique — à gérer manuellement si breaking)

### Rollback base de données (si migration breaking)

```bash
ssh ubuntu@<your-vps-ip>
cd /opt/gigapdf
source .venv/bin/activate
source .env

# Voir l'historique Alembic
alembic history

# Revenir à la révision précédente
alembic downgrade -1

# Revenir à une révision spécifique
alembic downgrade <revision_id>
```

---

## Snapshots

Les artefacts de chaque déploiement réussi sont sauvegardés dans `/opt/gigapdf-snapshots/<timestamp>/`.

- **Rétention** : 5 derniers snapshots (les plus anciens sont supprimés automatiquement)
- **Contenu** : `apps/web/.next/`, `apps/admin/.next/`, `packages/*/dist/`
- **Symlink** : `/opt/gigapdf-snapshots/latest` pointe toujours vers le plus récent

```bash
# Voir la taille des snapshots
du -sh /opt/gigapdf-snapshots/*

# Voir le snapshot courant
readlink /opt/gigapdf-snapshots/latest
```

---

## Page maintenance Nginx

Nginx sert `/var/www/gigapdf-maintenance/maintenance.html` automatiquement quand un upstream retourne 502/503/504.

- **API** (`api.giga-pdf.com`) : répond JSON `503` avec `Retry-After: 30`
- **Web** (`giga-pdf.com`) : sert la page HTML de maintenance (branded)

Le fichier source est `deploy/nginx/maintenance.html` — copié par `deploy.sh` à chaque déploiement.

---

## Reload graceful de l'API (FastAPI / uvicorn)

La configuration systemd (`deploy/systemd/gigapdf-api.service`) contient :

```ini
ExecReload=/bin/kill -HUP $MAINPID
```

`systemctl reload gigapdf-api` envoie `SIGHUP` au processus maître uvicorn. Avec 4 workers (`--workers 4`) :

1. Le maître envoie `SIGWINCH` aux workers actifs (graceful shutdown après fin des requêtes en cours)
2. Le maître fork de nouveaux workers qui chargent le nouveau code
3. Les anciens workers se terminent proprement une fois leurs requêtes finies

Résultat : **zéro connexion droppée** pendant le reload de l'API.

---

## Surveillance post-déploiement

```bash
# Statut global
sudo systemctl status gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing

# Logs en temps réel
tail -f /var/log/gigapdf/api.log
tail -f /var/log/gigapdf/web.log
journalctl -u gigapdf-api -f

# Health checks manuels
curl -s http://localhost:8000/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001

# Snapshots disponibles
sudo bash /opt/gigapdf/scripts/rollback.sh --list
```

---

## Checklist de déploiement

- [ ] Tests CI passent (lint, type-check, tests unitaires)
- [ ] Pas de vendredi soir
- [ ] Migrations backward-compatible (pas de DROP COLUMN sans feature flag)
- [ ] `git push origin main`
- [ ] Vérifier les logs en temps réel pendant le déploiement
- [ ] Valider API : `curl https://api.giga-pdf.com/health`
- [ ] Valider Web : `curl -I https://giga-pdf.com`
- [ ] En cas d'anomalie : `sudo bash /opt/gigapdf/scripts/rollback.sh`

---

## Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `deploy/deploy.sh` | Script de déploiement principal |
| `scripts/rollback.sh` | Rollback vers un snapshot |
| `deploy/nginx/maintenance.html` | Page de maintenance Nginx |
| `deploy/nginx.conf` | Configuration Nginx (upstreams + error_page) |
| `deploy/systemd/gigapdf-api.service` | Systemd unit (ExecReload=SIGHUP) |
