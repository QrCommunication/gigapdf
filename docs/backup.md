# GigaPDF — Sauvegarde et restauration PostgreSQL

## Architecture

| Type | Fréquence | Rétention | Déclencheur |
|------|-----------|-----------|-------------|
| Daily | Tous les jours à 03:00 UTC | 45 jours | `gigapdf-backup.timer` |
| Weekly | Dimanche à 03:00 UTC | 45 jours | Même script, détection du dimanche |

Le script `scripts/backup-postgres.sh` crée un dump SQL compressé, vérifie son
intégrité avec `gzip -t`, l'envoie sur le stockage objet puis supprime les
archives de plus de 45 jours. Le nommage horodaté UTC permet un tri chronologique.

Les sauvegardes utilisent par défaut la configuration iDrive e2 de
l'application et un préfixe isolé des documents utilisateurs :

```
s3://gigapdf/backups/postgres/daily/gigapdf_daily_YYYYMMDD_HHMMSS.sql.gz
s3://gigapdf/backups/postgres/weekly/gigapdf_weekly_YYYYMMDD_HHMMSS.sql.gz
```

Le bucket `gigapdf` a son chiffrement par défaut activé. Les dumps SQL ne sont
pas chiffrés par le script : le chiffrement au repos est assuré par le bucket.
La clé iDrive doit être limitée au bucket et autoriser la lecture, l'écriture
et la suppression (cette dernière uniquement pour appliquer la rétention).

## Configuration

Aucune variable supplémentaire n'est nécessaire si `DATABASE_URL`,
`S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` et
`S3_REGION` sont déjà configurés pour l'application.

Il est possible de dédier d'autres identifiants ou un autre bucket aux backups :

```env
BACKUP_RETENTION_DAYS=45
BACKUP_S3_BUCKET=s3://gigapdf/backups
BACKUP_S3_ENDPOINT_URL=https://s3.eu-west-4.idrivee2.com
BACKUP_S3_ACCESS_KEY=<clé d'accès>
BACKUP_S3_SECRET_KEY=<secret>
BACKUP_S3_REGION=eu-west-4

# Notifications d'échec facultatives
BACKUP_NOTIFY_EMAIL=ops@giga-pdf.com
BACKUP_NOTIFY_WEBHOOK=https://hooks.slack.com/services/xxx
```

`BACKUP_S3_BUCKET` contient le préfixe racine des backups, pas seulement le
nom du bucket. Le chemin `/postgres/{daily,weekly}` est ajouté par les scripts.

## Installation du timer

La CLI AWS et PostgreSQL sont requis sur le serveur :

```bash
sudo apt install awscli postgresql-client
sudo cp deploy/systemd/gigapdf-backup.service /etc/systemd/system/
sudo cp deploy/systemd/gigapdf-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gigapdf-backup.timer
```

Le service fourni utilise l'utilisateur `ploi`, le dépôt
`/home/ploi/giga-pdf.com` et charge `/home/ploi/giga-pdf.com/.env` sans afficher
les secrets. Les sorties sont écrites dans `/var/log/gigapdf/backup.log` et
`backup-error.log`.

## Vérification

```bash
# Lancer immédiatement la même unité que le timer
sudo systemctl start gigapdf-backup.service
systemctl status gigapdf-backup.service --no-pager

# Vérifier la planification et les journaux
systemctl list-timers gigapdf-backup.timer --no-pager
journalctl -u gigapdf-backup.service --since "1 hour ago" --no-pager

# Lister les archives présentes dans iDrive
ENV_FILE=/home/ploi/giga-pdf.com/.env \
  /home/ploi/giga-pdf.com/scripts/restore-postgres.sh --list
```

Après chaque run réussi, télécharger une archive dans un répertoire temporaire
et exécuter `gzip -t` avant de la supprimer. La purge ne doit jamais concerner
d'objets hors du préfixe `backups/postgres`.

## Écran Admin et test hebdomadaire

La page Admin **Sauvegardes** affiche chaque exécution dans `backup_runs` :
type, statut, date, fichier, taille, destination et détails. Elle permet aussi de
lancer une sauvegarde ou un test isolé à la demande.

Le timer `gigapdf-restore-test.timer` exécute le dry-run chaque dimanche à
04:00 UTC. Les succès et échecs sont enregistrés dans la même table, avec les
journaux `/var/log/gigapdf/backup.log` et `restore-test.log` pour le diagnostic.

## Restauration

### Dry-run recommandé

Restaure dans une base temporaire `gigapdf_restore_test`, vérifie le résultat,
puis supprime cette base. Aucune donnée de production n'est modifiée.

```bash
ENV_FILE=/home/ploi/giga-pdf.com/.env \
  /home/ploi/giga-pdf.com/scripts/restore-postgres.sh --dry-run

# Archive spécifique
ENV_FILE=/home/ploi/giga-pdf.com/.env \
  /home/ploi/giga-pdf.com/scripts/restore-postgres.sh --dry-run \
  --file gigapdf_daily_20260421_030000.sql.gz
```

### Base isolée

```bash
ENV_FILE=/home/ploi/giga-pdf.com/.env \
  /home/ploi/giga-pdf.com/scripts/restore-postgres.sh \
  --target-db gigapdf_staging
```

### Restauration production — destructif

```bash
ENV_FILE=/home/ploi/giga-pdf.com/.env \
  /home/ploi/giga-pdf.com/scripts/restore-postgres.sh --list

ENV_FILE=/home/ploi/giga-pdf.com/.env \
  /home/ploi/giga-pdf.com/scripts/restore-postgres.sh \
  --confirm-production \
  --file gigapdf_daily_20260421_030000.sql.gz
```

Cette dernière commande arrête les services, supprime et recrée la base, puis
restaure l'archive. Ne jamais l'utiliser comme simple test : le dry-run et la
base isolée existent pour cela.

## Maintenance

Tester le dry-run chaque mois et vérifier que les tables sont présentes dans le
rapport. Surveiller les échecs du service avec `systemctl status` et les logs.
Conserver la rétention à 45 jours sauf décision explicite d'augmenter le volume
et le coût de stockage.
