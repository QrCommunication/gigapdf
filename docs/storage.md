# Stockage objet (documents, versions, miniatures)

Le stockage des fichiers passe par une couche d'abstraction
(`app/storage_backends/`). Le code métier appelle uniquement
`app.services.s3_service.s3_service` (alias `object_storage`), qui délègue
au backend choisi par la variable `STORAGE_PROVIDER`. Changer de fournisseur
ne demande **aucune modification de code**.

## Fournisseurs intégrés

| `STORAGE_PROVIDER` | Service | `S3_ENDPOINT` | Région par défaut | SSE |
|---|---|---|---|---|
| `idrive` (défaut) | iDrive e2 | **obligatoire** (console e2) | `us-east-1` | non |
| `scaleway` | Scaleway Object Storage | optionnel (`https://s3.{region}.scw.cloud`) | `fr-par` | non |
| `aws` | Amazon S3 | optionnel (résolu par le SDK) | `us-east-1` | oui |
| `minio` | MinIO | **obligatoire** | `us-east-1` | non |
| `s3` | Tout service compatible S3 | **obligatoire** | `us-east-1` | non |
| `local` | Disque local (dev/tests) | — | — | — |

Variables communes : `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`.
Surcharges facultatives : `S3_ADDRESSING_STYLE` (`path`/`virtual`/`auto`),
`S3_SERVER_SIDE_ENCRYPTION` (`true`/`false`), `STORAGE_LOCAL_ROOT`.

Le backend `local` ne fournit pas d'URL présignée : les miniatures n'y sont
donc pas exposées (`thumbnail_url = null`). Il sert au dev et aux tests.

Les documents sont de toute façon chiffrés côté application
(AES-256-GCM, enveloppe) avant l'envoi, quel que soit le fournisseur.

### iDrive e2

```bash
STORAGE_PROVIDER=idrive
S3_ENDPOINT=https://xxxx.par.idrivee2-NN.com   # endpoint affiché dans la console e2
S3_REGION=                                     # code région affiché à côté de l'endpoint (optionnel)
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=gigapdf
```

## Ajouter un autre service

Trois options, de la plus simple à la plus libre :

1. **Service compatible S3** : ajouter une entrée dans
   `S3_PROVIDER_PRESETS` (`app/storage_backends/s3.py`) avec son endpoint,
   sa région et ses particularités. Côté TypeScript, même chose dans
   `STORAGE_PROVIDER_PRESETS` (`packages/s3/src/client.ts`).
2. **Backend enregistré** : implémenter `StorageBackend`
   (`app/storage_backends/base.py`) puis appeler
   `register_storage_provider("nom", factory)` au démarrage.
3. **Backend externe sans toucher au dépôt** :
   `STORAGE_PROVIDER=mon_paquet.module:create_backend` — une fonction qui
   reçoit les `Settings` et renvoie un `StorageBackend`.

```python
from app.storage_backends import StorageBackend

class AzureBlobBackend(StorageBackend):
    provider = "azure"
    def put_object(self, key, data, content_type="application/octet-stream", metadata=None): ...
    def get_object(self, key): ...           # None si absent
    def head_object(self, key): ...          # None si absent
    def delete_object(self, key): ...
    def copy_object(self, source_key, dest_key, content_type=None, metadata=None): ...
    def iter_objects(self, prefix=""): ...
    def presigned_url(self, key, expires_in=3600, method="get"): ...
    def check_connection(self): ...

def create_backend(settings):
    return AzureBlobBackend(...)
```

## Migrer de Scaleway vers iDrive e2

Les clés d'objet, contenus, types et métadonnées sont copiés à l'identique :
la base de données (chemins, clés de chiffrement) reste valable.

```bash
export MIGRATE_SRC_PROVIDER=scaleway MIGRATE_SRC_REGION=fr-par \
       MIGRATE_SRC_ACCESS_KEY_ID=SCW... MIGRATE_SRC_SECRET_ACCESS_KEY=... \
       MIGRATE_SRC_BUCKET_NAME=gigapdf
export MIGRATE_DST_PROVIDER=idrive \
       MIGRATE_DST_ENDPOINT=https://xxxx.par.idrivee2-NN.com \
       MIGRATE_DST_ACCESS_KEY_ID=... MIGRATE_DST_SECRET_ACCESS_KEY=... \
       MIGRATE_DST_BUCKET_NAME=gigapdf

venv/bin/python scripts/migrate_storage.py --dry-run   # inventaire
venv/bin/python scripts/migrate_storage.py             # copie (relançable)
```

Procédure conseillée :

1. Lancer la copie une première fois (le site reste sur Scaleway).
2. Passer en maintenance, relancer la copie (seuls les nouveaux objets sont copiés).
3. Mettre `STORAGE_PROVIDER=idrive` + les variables `S3_*` iDrive dans `.env`,
   redémarrer l'API et les workers Celery.
4. Vérifier via l'admin : *Paramètres → Tester le stockage*.
5. Garder le bucket Scaleway quelques jours avant de le supprimer.
