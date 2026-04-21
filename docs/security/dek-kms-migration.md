# DEK Isolation — Plan d'Architecture & Migration KMS

**Date** : 2026-04-21  
**Statut** : PLAN (non implémenté)  
**Criticité** : HAUTE — les DEKs chiffrées sont dans la même DB que les données

---

## 1. État Actuel (Analyse)

### Architecture d'envelope encryption

```
APP_SECRET_KEY (ENV)
       │
       ▼ PBKDF2-SHA256 (100 000 itérations, sel dérivé du secret)
      KEK (en mémoire RAM du process)
       │
       ▼ AES-256-GCM
encrypted_dek  ────────────────────────────────┐
(colonne TEXT dans document_versions)          │
                                               │ MÊME BASE DE DONNÉES
document chiffré ──────────────────────────────┤
(fichier binaire dans Scaleway S3)             │
                                               ▼
                                       Si DB compromise :
                                       encrypted_dek EXPOSÉ
```

### Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `app/services/encryption_service.py` | Génère/chiffre/déchiffre les DEK via KEK |
| `app/services/s3_service.py` | Upload/download chiffré, encode le DEK pour la DB |
| `app/services/storage_service.py` | Orchestre le chiffrement lors des save/load |
| `app/models/database.py` | Modèle `DocumentVersion` avec `encryption_key` (TEXT) |
| `migrations/versions/012_add_encryption_key_column.py` | Migration qui a ajouté la colonne |
| `app/config.py` | `app_secret_key` — source unique de la KEK |

### Le problème exact

Le KEK (Key Encryption Key) est **dérivé déterministiquement** de `APP_SECRET_KEY` :

```python
# app/services/encryption_service.py, ligne 76-86
kek_salt = hashlib.sha256(b"gigapdf-kek-salt-" + master_secret).digest()[:SALT_SIZE]
kdf = PBKDF2HMAC(algorithm=SHA256, length=32, salt=kek_salt, iterations=100_000)
self._master_key = kdf.derive(master_secret)
```

Les DEKs chiffrées sont stockées dans la colonne `document_versions.encryption_key` (TEXT, nullable, base64).

**Conséquences si la base de données est compromise** :

1. L'attaquant récupère tous les `encrypted_dek` de la table `document_versions`
2. Il lui manque uniquement le `APP_SECRET_KEY` (ENV du serveur)
3. Si le serveur est aussi compromis (ce qui est souvent le cas dans une attaque DB directe via shell/RCE), il accède au `.env` et dérive la KEK
4. Résultat : **tous les documents sont déchiffrables**

**Situation actuelle par rapport aux options** :

L'architecture actuelle est l'**Option C partielle** : la KEK n'est pas en DB (bien), mais elle est uniquement dans l'ENV du même serveur (risque car `.env` = même filesystem).

---

## 2. Comparaison des Options

### Option A — KMS Externe (Scaleway Secret Manager ou AWS KMS)

**Principe** : Le `APP_SECRET_KEY` ne dérive plus la KEK. La KEK **n'existe jamais en clair** sur le serveur. À la place, on appelle une API KMS pour chiffrer/déchiffrer les DEK.

```
[Générer DEK]
  dek = secrets.token_bytes(32)           # DEK en clair (RAM uniquement)
  
  encrypted_dek = KMS.encrypt(            # Appel réseau KMS
      key_id="kms-key-id",
      plaintext=dek
  )
  
  → stocker encrypted_dek en DB
  → utiliser dek pour chiffrer le document S3

[Déchiffrer]
  dek = KMS.decrypt(                      # Appel réseau KMS
      ciphertext_blob=encrypted_dek
  )
  → déchiffrer le document S3
```

**Avantages** :
- KEK jamais sur le serveur (ni en RAM prolongée, ni sur disque)
- Audit trail KMS : chaque decrypt est loggé côté KMS
- Rotation de KEK sans re-chiffrement des documents (juste des DEK)
- Respect du principe de séparation des responsabilités

**Inconvénients** :
- Latence : +10-30ms par opération de déchiffrement (appel réseau)
- Dépendance réseau : si KMS inaccessible → documents illisibles
- Coût : Scaleway Secret Manager ~0.04€/10 000 opérations
- Complexité de migration des DEKs existantes (phase de migration requise)

**Options KMS concrètes** :
- Scaleway Secret Manager (même région fr-par, latence minimale)
- AWS KMS (si compte AWS disponible)
- HashiCorp Vault self-hosted (Option B)

---

### Option B — HashiCorp Vault (Transit Backend)

**Principe** : Vault gère un moteur de chiffrement dédié (Transit). Il ne stocke pas les données, il chiffre/déchiffre à la demande via une API REST.

```
vault.write("transit/encrypt/gigapdf-kek", plaintext=base64(dek))
→ ciphertext: vault:v1:XXXXXX  (stocké en DB)

vault.write("transit/decrypt/gigapdf-kek", ciphertext=...)
→ plaintext: dek (déchiffré en RAM)
```

**Avantages** :
- Control total (self-hosted)
- Rotation automatique des clés de transit
- Audit log intégré
- Pas de coût par opération

**Inconvénients** :
- Infrastructure supplémentaire à maintenir (Vault cluster)
- Single point of failure si Vault down
- Complexité opérationnelle (HA, snapshots Vault, unseal)
- Pas adapté à un VPS unique (sans cluster)

---

### Option C — Séparation KEK dans ENV Durci (Actuel + Hardening)

**Principe** : Maintenir l'architecture actuelle mais durcir l'isolation du KEK :
- KEK dérivée de `APP_SECRET_KEY` (ENV) — inchangé
- Renforcer le fait que `APP_SECRET_KEY` est un secret de premier ordre
- Scrubbing des backups DB (exclure ou anonymiser `encryption_key`)
- Rotation du `APP_SECRET_KEY` planifiée avec re-chiffrement des DEK

**Avantages** :
- Zéro migration requise
- Pas de latence supplémentaire
- Pas de dépendance externe

**Inconvénients** :
- Si le serveur est compromis (RCE + accès filesystem), tout est exposé
- Pas de séparation forte des responsabilités
- Pas d'audit trail des opérations de déchiffrement
- Limite aux contrôles de sécurité disponibles

---

## 3. Recommandation

**Court terme (maintenant) : Option C Durcie — Quick Wins**  
**Moyen terme (3-6 mois) : Option A — Scaleway Secret Manager**

### Justification

GigaPDF est hébergé sur un VPS Scaleway. Scaleway propose un **Secret Manager** natif, dans la même région (fr-par), avec une latence de l'ordre de 5-15ms. L'Option A avec Scaleway Secret Manager est la cible architecturale correcte.

L'Option B (Vault) requiert un cluster dédié — surdimensionné pour la situation actuelle.

L'Option C est l'état actuel, suffisant si les quick wins sont appliqués immédiatement.

---

## 4. Quick Wins (Applicables Immédiatement, Sans Migration)

### QW-1 : Backup — Exclure la colonne `encryption_key` des dumps

**Risque** : Le dump PostgreSQL `pg_dump --format=plain` exporte toutes les colonnes, y compris `encryption_key`. Un backup S3 compromis expose les DEK chiffrées.

**Action** : Modifier `scripts/backup-postgres.sh` pour utiliser `--exclude-table-data` ou un dump avec colonne anonymisée.

**Solution retenue** : Utiliser pg_dump avec une vue ou exclure la colonne via `--column-inserts` et filtrage n'est pas trivial. La vraie solution est de chiffrer le backup avec une clé distincte (GPG) avant upload S3.

**Modification du script backup** :
```bash
# AJOUTER dans backup-postgres.sh après la génération du dump :
# Chiffrer le backup avec une clé GPG dédiée aux backups (distincte de APP_SECRET_KEY)
# gpg --batch --yes --recipient backup@gigapdf --output "$BACKUP_FILE.gpg" --encrypt "$BACKUP_FILE"
# → Upload le .gpg uniquement, supprimer le .gz en clair
```

**Note** : Cela nécessite de générer une paire de clés GPG dédiée aux backups et de stocker la clé privée hors du serveur. Plan détaillé dans la section 5.

### QW-2 : Vérifier que `APP_SECRET_KEY` n'est pas en clair dans les logs

**Action** : Vérifier que le script de déploiement ne logge pas les variables d'environnement.

```bash
# Dans deploy.sh et push-deploy.sh, chercher :
grep -n "printenv\|env\|APP_SECRET\|SECRET_KEY" /home/rony/Projets/gigapdf/deploy/deploy.sh
grep -n "printenv\|env\|APP_SECRET\|SECRET_KEY" /home/rony/Projets/gigapdf/deploy/push-deploy.sh
```

### QW-3 : Rotation périodique planifiée de `APP_SECRET_KEY`

**Problème** : Aucune rotation de la KEK n'est planifiée. Si la KEK est compromise, tous les documents le sont indéfiniment.

**Plan rotation** :
1. Générer un nouveau `APP_SECRET_KEY`
2. Charger l'ancien en mémoire
3. Pour chaque document chiffré : `decrypt_dek(ancien_kek)` → `encrypt_dek(nouveau_kek)`
4. Mettre à jour `document_versions.encryption_key` en DB (transaction par batch)
5. Redémarrer le service avec le nouveau `APP_SECRET_KEY`

**Note** : Ce processus doit être implémenté comme une commande CLI (script Python) avant d'être planifiable. Il n'existe pas encore.

### QW-4 : Ajouter `APP_SECRET_KEY` au script `audit-secrets.sh`

Vérifier que le script d'audit signale bien si `APP_SECRET_KEY` a une entropie insuffisante.

### QW-5 : Permissions filesystem du `.env`

```bash
# Sur le serveur, vérifier :
ls -la /opt/gigapdf/.env
# Doit être : -rw------- (600) appartenant à l'utilisateur du service, pas root
chmod 600 /opt/gigapdf/.env
```

---

## 5. Roadmap Migration vers KMS Externe (Option A)

### Phase 0 — Préparation (Semaine 1-2)

**Objectif** : Préparer l'infrastructure sans toucher le code de production.

- [ ] Créer un Scaleway Secret Manager namespace `gigapdf-prod`
- [ ] Générer une KEK KMS (clé symétrique AES-256 dans Scaleway SM)
- [ ] Créer un compte de service avec permissions minimales (`secret:read`, `secret:decrypt`)
- [ ] Documenter les credentials KMS dans un secret séparé (hors .env applicatif)
- [ ] Écrire un wrapper Python `KMSKeyProvider` (port/adapter pattern) avec interface :
  ```python
  class KeyProvider(Protocol):
      def encrypt_key(self, plaintext_key: bytes) -> bytes: ...
      def decrypt_key(self, encrypted_key: bytes) -> bytes: ...
  ```
- [ ] Implémenter `EnvKeyProvider` (actuel) et `ScalewayKMSKeyProvider` (nouveau)
- [ ] Tests unitaires sur les deux providers avec mock KMS

**Effort estimé** : 3-5 jours développeur

---

### Phase 1 — Dual-Write (Semaine 3-4)

**Objectif** : Nouveaux documents chiffrés avec KMS, anciens inchangés.

**Modification de la colonne DB** :
```sql
-- Migration : ajouter une colonne pour tracker la source du chiffrement
ALTER TABLE document_versions 
  ADD COLUMN encryption_provider VARCHAR(20) DEFAULT 'env_kek' NOT NULL;
-- Valeurs : 'env_kek' (actuel), 'scaleway_kms' (nouveau), 'none'
```

**Modification du code** :
```python
# encryption_service.py : injection du KeyProvider
class EncryptionService:
    def __init__(self, key_provider: KeyProvider):
        self._key_provider = key_provider
    
    def _encrypt_key(self, key: bytes) -> bytes:
        return self._key_provider.encrypt_key(key)
    
    def _decrypt_key(self, encrypted_key: bytes) -> bytes:
        return self._key_provider.decrypt_key(encrypted_key)
```

**Rollout** : Activer `ScalewayKMSKeyProvider` en production pour les nouveaux documents uniquement.

**Effort estimé** : 5-8 jours développeur

---

### Phase 2 — Migration des DEK Existantes (Semaine 5-8)

**Objectif** : Re-chiffrer toutes les DEK existantes depuis `env_kek` vers `scaleway_kms`.

**Stratégie** : Script de migration par batch (pas de downtime).

```python
# scripts/migrate_deks_to_kms.py (à créer)
async def migrate_batch(db: AsyncSession, batch_size: int = 100):
    """
    Pour chaque DocumentVersion avec encryption_provider='env_kek' :
    1. Lire encrypted_dek (base64)
    2. Déchiffrer avec l'ancien KEK (env)
    3. Re-chiffrer avec le KMS
    4. Mettre à jour la colonne + encryption_provider='scaleway_kms'
    5. Commit
    """
```

**Points d'attention** :
- Exécuter sur un environnement de staging d'abord
- Backup complet AVANT la migration
- Migration idempotente (relançable si interruption)
- Pas de fenêtre de maintenance requise (les deux providers coexistent)

**Rollback** : En cas d'incident, réactiver `EnvKeyProvider` via flag d'ENV — les DEK non encore migrées continuent à fonctionner.

**Effort estimé** : 3-5 jours développeur + validation en staging

---

### Phase 3 — Suppression de l'Ancien Provider (Semaine 9-10)

**Objectif** : Retirer `EnvKeyProvider` et supprimer `APP_SECRET_KEY` comme source de KEK.

- [ ] Vérifier que 0 document a `encryption_provider='env_kek'`
- [ ] Supprimer `EnvKeyProvider` du code
- [ ] Supprimer la logique de dérivation KEK de `encryption_service.py`
- [ ] Retirer la dépendance de `encryption_service` sur `app_secret_key`
- [ ] Documenter la nouvelle architecture

**Effort estimé** : 2-3 jours développeur

---

### Résumé de l'effort total

| Phase | Durée | Risque | Downtime |
|-------|-------|--------|----------|
| 0 — Préparation | 1-2 semaines | Faible | Aucun |
| 1 — Dual-Write | 1-2 semaines | Moyen | Aucun |
| 2 — Migration DEK | 2-4 semaines | Moyen | Aucun |
| 3 — Cleanup | 1 semaine | Faible | Aucun |
| **Total** | **5-9 semaines** | **Moyen** | **Zéro** |

---

## 6. Plan de Rotation Périodique des Clés (Cible KMS)

Une fois sur Scaleway KMS, la rotation de la KEK est simplifiée :

```
Tous les 90 jours :
  1. Scaleway SM : activer la rotation automatique de la KEK
     → La nouvelle KEK chiffre les nouvelles DEK
     → L'ancienne KEK reste disponible pour déchiffrer les anciennes DEK
     → Pas de re-chiffrement des DEK requis (KMS gère le versioning)
  
  2. Audit : vérifier les métriques d'utilisation KMS
     (si decrypt avec ancienne version de KEK → anomalie à investiguer)
```

**Pour l'Option C actuelle (KEK dérivée de APP_SECRET_KEY)** :
- Rotation manuelle requise (script à créer — QW-3)
- Fréquence recommandée : tous les 90 jours
- Procédure : voir section 4 QW-3

---

## 7. Matrice de Risque

| Scénario | Option C actuelle | Option C Durcie | Option A (KMS) |
|----------|------------------|-----------------|----------------|
| Backup DB volé | CRITIQUE | ÉLEVÉ (si backup GPG) | MOYEN |
| RCE sur le serveur | CRITIQUE | CRITIQUE | ÉLEVÉ |
| Accès direct S3 | FAIBLE (données chiffrées) | FAIBLE | FAIBLE |
| Violation memoire/swap | ÉLEVÉ | ÉLEVÉ | MOYEN |
| Attaque supply chain sur deps | ÉLEVÉ | ÉLEVÉ | MOYEN |
| Compromission KMS | N/A | N/A | CRITIQUE |

**Légende** :
- CRITIQUE : données en clair récupérables automatiquement
- ÉLEVÉ : données récupérables avec effort supplémentaire
- MOYEN : données partiellement protégées
- FAIBLE : données protégées

---

## 8. Références

| Sujet | Référence |
|-------|-----------|
| Scaleway Secret Manager | https://www.scaleway.com/en/secret-manager/ |
| Envelope Encryption pattern | NIST SP 800-57 |
| PBKDF2 iteration count | OWASP Password Storage Cheat Sheet |
| AES-256-GCM | NIST SP 800-38D |
| Code source KEK | `app/services/encryption_service.py:60-87` |
| Colonne DEK | `app/models/database.py:116-120` |
| Backup script | `scripts/backup-postgres.sh` |
