# User Schema Audit — GigaPDF

**Date:** 2026-04-21
**Scope:** Table `users` (Prisma / better-auth) vs table `user_quotas` (SQLAlchemy / FastAPI)
**DB:** PostgreSQL unique, partagée entre Next.js et FastAPI

---

## 1. Clarification Architecture Réelle

Le contexte initial évoquait "deux schémas User (SQLAlchemy + Prisma)". L'audit révèle une architecture différente et plus précise :

- **Il n'existe pas de modèle `User` SQLAlchemy.** Le modèle SQLAlchemy `UserQuota` (`user_quotas`) est la table de quotas/facturation, pas d'identité.
- **La table `users` (Prisma) est détenue exclusivement par better-auth.** FastAPI n'y lit ni n'y écrit jamais directement.
- **Le lien entre les deux systèmes** est la colonne `user_quotas.user_id` (String 255) qui contient la valeur de `users.id` (UUID string). Cette correspondance est implicite et non enforced par une foreign key DB.

```
Next.js / better-auth          FastAPI / SQLAlchemy
      ↓                                ↓
  [users]                       [user_quotas]
  id (UUID PK)  ←── implicite ── user_id (String, UNIQUE, NOT FK)
  email                         email (nullable, dupliqué)
  ...                           ...
```

---

## 2. Schéma Prisma — Table `users`

Fichier : `/apps/web/prisma/schema.prisma`
Propriétaire : **better-auth (Next.js)**
Table DB : `users`

| Colonne        | Type Prisma      | Type DB           | Nullable | Default       | Contrainte      |
|----------------|-----------------|-------------------|----------|---------------|-----------------|
| `id`           | `String`         | `varchar(uuid)`   | NON      | `uuid()`      | PK              |
| `email`        | `String`         | `varchar`         | NON      | —             | UNIQUE          |
| `emailVerified`| `Boolean`        | `boolean`         | NON      | `false`       | —               |
| `name`         | `String?`        | `varchar`         | OUI      | —             | —               |
| `image`        | `String?`        | `varchar`         | OUI      | —             | —               |
| `locale`       | `String?`        | `varchar`         | OUI      | `"fr"`        | —               |
| `createdAt`    | `DateTime`       | `timestamp`       | NON      | `now()`       | —               |
| `updatedAt`    | `DateTime`       | `timestamp`       | NON      | `now()`       | @updatedAt      |

Relations :
- `accounts Account[]` → table `accounts`
- `sessions Session[]` → table `sessions`

---

## 3. Schéma SQLAlchemy — Table `user_quotas`

Fichier : `/app/models/database.py` — classe `UserQuota`
Propriétaire : **FastAPI (Python)**
Table DB : `user_quotas`

| Colonne                  | Type SQLAlchemy       | Type DB           | Nullable | Default              | Contrainte     |
|--------------------------|----------------------|-------------------|----------|----------------------|----------------|
| `id`                     | `UUID(as_uuid=False)`| `uuid`            | NON      | `uuid4()`            | PK             |
| `user_id`                | `String(255)`        | `varchar(255)`    | NON      | —                    | UNIQUE, INDEX  |
| `email`                  | `String(255)`        | `varchar(255)`    | OUI      | —                    | —              |
| `storage_used_bytes`     | `BigInteger`         | `bigint`          | NON      | `0`                  | —              |
| `storage_limit_bytes`    | `BigInteger`         | `bigint`          | NON      | `5368709120` (5GB)   | —              |
| `document_count`         | `Integer`            | `int`             | NON      | `0`                  | —              |
| `document_limit`         | `Integer`            | `int`             | NON      | `1000`               | —              |
| `api_calls_used`         | `Integer`            | `int`             | NON      | `0`                  | —              |
| `api_calls_limit`        | `Integer`            | `int`             | NON      | `1000`               | —              |
| `api_calls_reset_at`     | `DateTime(tz=True)`  | `timestamptz`     | NON      | `now()`              | —              |
| `plan_type`              | `String(20)`         | `varchar(20)`     | OUI*     | `"free"`             | —              |
| `plan_expires_at`        | `DateTime(tz=True)`  | `timestamptz`     | OUI      | —                    | —              |
| `stripe_customer_id`     | `String(255)`        | `varchar(255)`    | OUI      | —                    | UNIQUE, INDEX  |
| `stripe_subscription_id` | `String(255)`        | `varchar(255)`    | OUI      | —                    | —              |
| `subscription_status`    | `String(50)`         | `varchar(50)`     | OUI*     | `"none"`             | —              |
| `current_period_end`     | `DateTime(tz=True)`  | `timestamptz`     | OUI      | —                    | —              |
| `cancel_at_period_end`   | `Boolean`            | `boolean`         | NON      | `False`              | —              |
| `trial_start_at`         | `DateTime(tz=True)`  | `timestamptz`     | OUI      | —                    | —              |
| `trial_ends_at`          | `DateTime(tz=True)`  | `timestamptz`     | OUI      | —                    | —              |
| `has_used_trial`         | `Boolean`            | `boolean`         | NON      | `False`              | —              |
| `is_suspended`           | `Boolean`            | `boolean`         | NON      | `False`              | —              |
| `suspended_at`           | `DateTime(tz=True)`  | `timestamptz`     | OUI      | —                    | —              |
| `suspension_reason`      | `String(255)`        | `varchar(255)`    | OUI      | —                    | —              |
| `payment_failed_count`   | `Integer`            | `int`             | NON      | `0`                  | —              |
| `last_payment_failed_at` | `DateTime(tz=True)`  | `timestamptz`     | OUI      | —                    | —              |
| `updated_at`             | `DateTime(tz=True)`  | `timestamptz`     | NON      | `now()`              | —              |

*La colonne `plan_type` et `subscription_status` sont `OUI` nullable en DB (Prisma le confirme avec `?`) mais ont un default non-null dans SQLAlchemy — nullable=True implicite via Mapped[str].

---

## 4. Schéma Prisma — Table `user_quotas` (vue côté Prisma)

Le schéma Prisma (ligne 423–457 dans `schema.prisma`) reflète fidèlement la structure SQLAlchemy avec quelques nuances :

| Différence                | SQLAlchemy              | Prisma                     | Impact               |
|---------------------------|------------------------|----------------------------|-----------------------|
| `storage_used_bytes`      | `BigInteger` NOT NULL   | `BigInt?` nullable         | **DIVERGENCE** ⚠     |
| `storage_limit_bytes`     | `BigInteger` NOT NULL   | `BigInt?` nullable         | **DIVERGENCE** ⚠     |
| `document_count`          | `Integer` NOT NULL      | `Int?` nullable            | **DIVERGENCE** ⚠     |
| `document_limit`          | `Integer` NOT NULL      | `Int?` nullable            | **DIVERGENCE** ⚠     |
| `api_calls_used`          | `Integer` NOT NULL      | `Int?` nullable            | **DIVERGENCE** ⚠     |
| `api_calls_limit`         | `Integer` NOT NULL      | `Int?` nullable            | **DIVERGENCE** ⚠     |
| `cancel_at_period_end`    | `Boolean` NOT NULL      | `Boolean?` nullable        | **DIVERGENCE** ⚠     |
| `has_used_trial`          | `Boolean` NOT NULL      | `Boolean?` nullable        | **DIVERGENCE** ⚠     |
| `is_suspended`            | `Boolean` NOT NULL      | `Boolean?` nullable        | **DIVERGENCE** ⚠     |
| `payment_failed_count`    | `Integer` NOT NULL      | `Int?` nullable            | **DIVERGENCE** ⚠     |
| `id` (UUID format)        | `UUID(as_uuid=False)` → `str` | `@db.Uuid` → `String` | OK (compatible)  |
| Relations tenant (FK)     | Définis dans SQLAlchemy | Définis dans Prisma         | OK (identique)       |

---

## 5. Analyse du Lien `users.id` → `user_quotas.user_id`

**Problème critique** : Le lien entre les deux tables est **entièrement implicite**.

```sql
-- Ce qui DEVRAIT exister mais N'EXISTE PAS :
ALTER TABLE user_quotas
  ADD CONSTRAINT fk_user_quotas_users
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```

**Ce qui existe actuellement :**
- `user_quotas.user_id` = `varchar(255)`, UNIQUE, pas de FK
- `users.id` = UUID stocké comme string dans Prisma

**Risques :**
1. Un `user_quotas` peut exister sans `users` correspondant (orphan records).
2. La suppression d'un `users` ne nettoie pas le `user_quotas` (pas de CASCADE).
3. Le type `varchar(255)` pour `user_id` vs `uuid` pour `users.id` — fonctionnellement compatible mais sémantiquement imprécis.

---

## 6. Colonne `email` dupliquée

La colonne `email` existe dans **deux tables** :
- `users.email` (NOT NULL, UNIQUE) — source de vérité
- `user_quotas.email` (nullable, sans contrainte unique) — copie dénormalisée

Risque : Les deux valeurs peuvent diverger si l'utilisateur change son email dans better-auth sans que FastAPI soit notifié. Il n'existe pas de trigger ou webhook garantissant la synchronisation.

---

## 7. Tables Prisma Absentes du Côté SQLAlchemy

Ces tables Prisma n'ont pas d'équivalent SQLAlchemy (expected, car gérées exclusivement par better-auth ou Prisma) :

| Table Prisma       | Propriétaire | Notes                            |
|--------------------|-------------|----------------------------------|
| `users`            | better-auth  | Identité utilisateur              |
| `accounts`         | better-auth  | OAuth providers                  |
| `sessions`         | better-auth  | Sessions actives                 |
| `verification`     | better-auth  | Email verification tokens        |
| `jwks`             | better-auth  | JWK signing keys                 |
| `admin_users`      | better-auth  | Comptes admin                    |
| `admin_accounts`   | better-auth  | OAuth admin                      |
| `admin_sessions`   | better-auth  | Sessions admin                   |
| `admin_verification`| better-auth | Vérification admin               |

---

## 8. Tables SQLAlchemy Absentes du Côté Prisma

| Table SQLAlchemy                | Notes                                        |
|---------------------------------|----------------------------------------------|
| `document_share_invitations`    | Absente dans schema.prisma — gérée uniquement par SQLAlchemy |
| `share_notifications`           | Absente dans schema.prisma                   |
| `infrastructure_metrics`        | Absente dans schema.prisma                   |
| `document_shares` (partiel)     | Présente dans les deux mais différentes colonnes (`status`, `invitation_id`, `revoked_at`, `revoked_by` absentes côté Prisma) |

---

## 9. Divergences sur `document_shares`

| Colonne           | SQLAlchemy     | Prisma          | Statut         |
|-------------------|----------------|-----------------|----------------|
| `id`              | UUID NOT NULL  | UUID NOT NULL   | OK             |
| `document_id`     | UUID NOT NULL  | UUID NOT NULL   | OK             |
| `shared_with_user_id` | String(255) nullable | VarChar(255) nullable | OK |
| `share_token`     | String(64) nullable | VarChar(64) nullable | OK |
| `permission`      | String(20) `"edit"` | VarChar(20) `"view"` | **DÉFAUT DIVERGENT** ⚠ |
| `expires_at`      | DateTime nullable | Timestamptz nullable | OK |
| `created_by`      | String(255) NOT NULL | VarChar(255) NOT NULL | OK |
| `created_at`      | DateTime NOT NULL | Timestamptz NOT NULL | OK |
| `status`          | String(20) `"active"` | **ABSENT** | **COLONNE MANQUANTE** ⚠ |
| `invitation_id`   | UUID nullable  | **ABSENT**      | **COLONNE MANQUANTE** ⚠ |
| `revoked_at`      | DateTime nullable | **ABSENT**   | **COLONNE MANQUANTE** ⚠ |
| `revoked_by`      | String(255) nullable | **ABSENT** | **COLONNE MANQUANTE** ⚠ |

---

## 10. Résumé des Divergences Critiques

| # | Sévérité  | Table          | Problème                                                       |
|---|-----------|----------------|----------------------------------------------------------------|
| 1 | CRITIQUE  | `user_quotas`  | Pas de FK `user_id → users.id` (orphans possibles)            |
| 2 | ÉLEVÉE    | `user_quotas`  | 8 colonnes NOT NULL en SQLAlchemy, nullable en Prisma          |
| 3 | ÉLEVÉE    | `document_shares` | 4 colonnes présentes en SQLAlchemy, absentes en Prisma      |
| 4 | ÉLEVÉE    | `document_shares` | Default `permission` divergent ("edit" vs "view")           |
| 5 | MOYENNE   | `users` + `user_quotas` | `email` dupliqué sans sync garantie                  |
| 6 | FAIBLE    | `user_quotas`  | Type `user_id` varchar(255) au lieu de `@db.Uuid`             |
| 7 | INFO      | diverses tables | Tables SQLAlchemy absentes du schema.prisma (expected)        |
