# GigaPDF — Backup & Restore PostgreSQL

## Architecture de backup

| Type | Fréquence | Rétention | Déclencheur |
|------|-----------|-----------|-------------|
| Daily | Tous les jours à 03:00 UTC | 7 jours | cron |
| Weekly | Dimanche à 03:00 UTC (Sunday = day 7) | 4 semaines | même script, détecte le jour |

Le script `scripts/backup-postgres.sh` détecte automatiquement le jour de la semaine : un run du dimanche produit un backup `weekly`, tous les autres produisent un backup `daily`.

Les backups sont stockés sur Scaleway Object Storage (bucket dédié) :

```
s3://<BACKUP_S3_BUCKET>/postgres/daily/gigapdf_daily_YYYYMMDD_HHMMSS.sql.gz
s3://<BACKUP_S3_BUCKET>/postgres/weekly/gigapdf_weekly_YYYYMMDD_HHMMSS.sql.gz
```

## Variables d'environnement requises

Ajouter à `/opt/gigapdf/.env` :

```env
# Backup S3 (Scaleway Object Storage)
BACKUP_S3_BUCKET=s3://gigapdf-backups
BACKUP_S3_ENDPOINT_URL=https://s3.fr-par.scw.cloud
BACKUP_S3_ACCESS_KEY=<clé Scaleway>
BACKUP_S3_SECRET_KEY=<secret Scaleway>
BACKUP_S3_REGION=fr-par

# Notifications en cas d'échec (optionnel)
BACKUP_NOTIFY_EMAIL=ops@giga-pdf.com
BACKUP_NOTIFY_WEBHOOK=https://hooks.slack.com/services/xxx
```

Créer un bucket Scaleway dédié (ne pas réutiliser le bucket documents) :

```bash
scw object bucket create name=gigapdf-backups region=fr-par
```

## Setup cron (une seule fois sur le VPS)

SSH sur le serveur puis :

```bash
sudo -u ubuntu crontab -e
```

Ajouter la ligne suivante :

```
0 3 * * * /opt/gigapdf/scripts/backup-postgres.sh >> /var/log/gigapdf/backup.log 2>&1
```

Créer le fichier de log et appliquer la rotation :

```bash
sudo touch /var/log/gigapdf/backup.log
sudo chown ubuntu:ubuntu /var/log/gigapdf/backup.log
```

La rotation de `/var/log/gigapdf/*.log` est déjà configurée dans `/etc/logrotate.d/gigapdf` (14 jours, compression).

## Vérifier que le cron fonctionne

```bash
# Lancer manuellement (sans attendre 03:00)
/opt/gigapdf/scripts/backup-postgres.sh

# Vérifier les logs
tail -f /var/log/gigapdf/backup.log

# Lister les backups dans S3
./scripts/restore-postgres.sh --list

# Vérifier dans syslog
journalctl -t gigapdf-backup --since "1 hour ago"
```

## Procédure de restore

### 1. Dry-run (recommandé avant tout restore prod)

Restaure dans une base de données temporaire `gigapdf_restore_test`, vérifie l'intégrité, puis supprime la base test. Aucune donnée de production n'est touchée.

```bash
# Latest daily (par défaut)
/opt/gigapdf/scripts/restore-postgres.sh --dry-run

# Fichier spécifique
/opt/gigapdf/scripts/restore-postgres.sh --dry-run \
  --file gigapdf_daily_20260421_030000.sql.gz
```

### 2. Restore vers une base isolée (test complet)

```bash
# Crée gigapdf_staging et restaure dedans
/opt/gigapdf/scripts/restore-postgres.sh \
  --file gigapdf_weekly_20260420_030000.sql.gz \
  --target-db gigapdf_staging
```

### 3. Restore production (DESTRUCTIF)

```bash
# Liste les backups disponibles
/opt/gigapdf/scripts/restore-postgres.sh --list

# Restore du backup sélectionné — arrête les services, drop la DB, restaure, redémarre
/opt/gigapdf/scripts/restore-postgres.sh \
  --confirm-production \
  --file gigapdf_daily_20260421_030000.sql.gz
```

Le script demande de saisir le nom de la base de données pour confirmer. Il arrête tous les services `gigapdf-*` avant le restore et les redémarre ensuite.

### Temps estimés (base ~500 MB compressée)

| Opération | Durée estimée |
|-----------|--------------|
| pg_dump + gzip | 2-5 min |
| Upload S3 | 1-2 min |
| Download S3 | 1-2 min |
| Restore psql | 3-8 min |

## Test de la procédure (à réaliser mensuellement)

1. Lister les backups : `--list`
2. Dry-run sur le dernier daily : `--dry-run`
3. Vérifier dans les logs que `tables found > 0`
4. Documenter la date et le résultat

## Scripts

| Script | Rôle |
|--------|------|
| `/opt/gigapdf/scripts/backup-postgres.sh` | Dump + upload S3 + retention |
| `/opt/gigapdf/scripts/restore-postgres.sh` | Download S3 + restore + vérification |
