# Roadmap Unification Schéma User — GigaPDF

**Date :** 2026-04-21
**Auteur :** Audit HAUT-ARCH-07
**Prérequis :** Lire `docs/user-schema-audit.md` avant ce document

---

## 1. Source de Vérité Recommandée

### Verdict : **Prisma est la source de vérité pour l'identité. SQLAlchemy reste la source de vérité pour les quotas.**

Justification :
- **better-auth** est le système d'authentification officiel du projet — il possède et gère la table `users`. La remplacer par SQLAlchemy impliquerait de réécrire tout le layer auth (risque XL).
- **SQLAlchemy** gère les données métier propres à FastAPI (`user_quotas`, `document_versions`, etc.) — le migrer vers Prisma impliquerait de créer des clients Python Prisma ou de passer entièrement à une architecture Next.js API-only (risque XL).
- Le bon pattern est donc : **deux tables, une pour chaque responsabilité**, avec un lien FK explicite entre elles.

```
Identité (better-auth)          Métier (FastAPI)
    [users.id]  ←──── FK ────── [user_quotas.user_id]
      "source of truth auth"       "source of truth quotas"
```

---

## 2. Stratégie Globale

| Option | Description | Effort | Risque | Recommandation |
|--------|-------------|--------|--------|----------------|
| A. FK explicite `user_quotas → users` | Ajouter la contrainte FK manquante | S | Faible | **RECOMMANDÉ** |
| B. Supprimer `email` de `user_quotas` | Dénormalisation → colonne calculée | M | Moyen | À faire au P2 |
| C. Aligner les nullable de `user_quotas` | Corriger les 8 divergences Prisma | S | Faible | **RECOMMANDÉ** |
| D. Ajouter colonnes manquantes à Prisma (`document_shares`) | Synchroniser le schéma Prisma | S | Faible | **RECOMMANDÉ** |
| E. Remplacer SQLAlchemy par Prisma | Tout migrer vers un seul ORM | XL | Très élevé | Hors scope |

---

## 3. Plan d'Action par Priorité

### P0 — Corrections Immédiates (sans migration destructive)

Ces corrections peuvent être appliquées maintenant, elles n'impactent pas les données existantes.

#### P0.1 — Aligner les nullable dans schema.prisma pour `user_quotas`

**Problème :** 8 colonnes NOT NULL avec defaults dans SQLAlchemy sont déclarées nullable (`?`) dans Prisma. Si Prisma génère un `prisma generate` ou une migration, il pourrait émettre des ALTER TABLE non désirés.

**Action :** Retirer le `?` (nullable) sur ces colonnes dans `schema.prisma` pour refléter la réalité DB.

Colonnes à corriger (retirer `?`) :
```prisma
// Dans model user_quotas :
storage_used_bytes    BigInt   @default(0)         // était BigInt?
storage_limit_bytes   BigInt   @default(5368709120) // était BigInt?
document_count        Int      @default(0)          // était Int?
document_limit        Int      @default(1000)       // était Int?
api_calls_used        Int      @default(0)          // était Int?
api_calls_limit       Int      @default(1000)       // était Int?
cancel_at_period_end  Boolean  @default(false)      // était Boolean?
has_used_trial        Boolean  @default(false)      // était Boolean?
is_suspended          Boolean  @default(false)      // était Boolean?
payment_failed_count  Int      @default(0)          // était Int?
```

**Impact :** Aucune migration DB nécessaire (les colonnes ont déjà ces defaults en base). Seulement une mise à jour du schéma Prisma.

---

#### P0.2 — Ajouter les colonnes manquantes dans `document_shares` (schema.prisma)

**Problème :** 4 colonnes présentes dans SQLAlchemy sont absentes de Prisma. Cela signifie que Next.js ne peut pas lire ces champs via Prisma Client.

**Action :** Ajouter dans `schema.prisma` :

```prisma
model document_shares {
  // ...colonnes existantes...
  status          String?   @default("active") @db.VarChar(20)
  invitation_id   String?   @db.Uuid
  revoked_at      DateTime? @db.Timestamptz(6)
  revoked_by      String?   @db.VarChar(255)
}
```

**Impact :** Aucune migration DB nécessaire (les colonnes existent déjà en base). Seulement une mise à jour du schéma Prisma + `prisma generate`.

---

#### P0.3 — Corriger le default divergent sur `document_shares.permission`

**Problème :** SQLAlchemy définit `default="edit"` mais Prisma définit `@default("view")`.

**Vérification à faire en base :**
```sql
SELECT column_default FROM information_schema.columns
WHERE table_name = 'document_shares' AND column_name = 'permission';
```

**Action selon le résultat :**
- Si DB = `"edit"` → Corriger Prisma : `@default("edit")`
- Si DB = `"view"` → Corriger SQLAlchemy : `default="view"` dans `database.py`
- Si pas de default en DB → Supprimer le default des deux côtés, rendre explicite dans le code

---

### P1 — Corrections Structurelles (avec migration DB simple)

À planifier dans le prochain sprint. Ces migrations sont non-destructives (ajout uniquement).

#### P1.1 — Ajouter la Foreign Key `user_quotas.user_id → users.id`

**Problème critique :** Le lien entre `user_quotas` et `users` est implicite. Des orphans peuvent exister.

**Migration SQL à exécuter manuellement :**

```sql
-- Étape 1 : Vérifier les orphans avant d'ajouter la FK
SELECT uq.user_id, uq.email
FROM user_quotas uq
LEFT JOIN users u ON u.id = uq.user_id
WHERE u.id IS NULL;
-- Si des lignes sont retournées, les nettoyer d'abord

-- Étape 2 : Ajouter la contrainte (non-destructive si pas d'orphans)
ALTER TABLE user_quotas
  ADD CONSTRAINT fk_user_quotas_users
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```

**Mise à jour schema.prisma après migration :**
```prisma
model user_quotas {
  user_id  String  @unique @db.VarChar(255)
  users    users?  @relation(fields: [user_id], references: [id], onDelete: Cascade)
}

model User {
  // ...
  user_quota user_quotas?
}
```

**Mise à jour SQLAlchemy après migration :**
```python
# Dans UserQuota, ajouter la FK explicite
user_id: Mapped[str] = mapped_column(
    String(255),
    ForeignKey("users.id", ondelete="CASCADE"),
    unique=True,
    nullable=False,
    index=True
)
```

---

#### P1.2 — Typer `user_id` comme UUID dans Prisma

**Problème :** `user_quotas.user_id` est `VarChar(255)` mais contient des UUID. Sémantiquement incorrect.

**Après ajout de la FK (P1.1)**, mettre à jour :
```prisma
user_id  String  @unique @db.Uuid  // au lieu de @db.VarChar(255)
```

**Note :** Cette migration peut nécessiter un `ALTER TABLE user_quotas ALTER COLUMN user_id TYPE uuid USING user_id::uuid;` en SQL si la colonne contient des valeurs non-UUID.

---

### P2 — Améliorations Long Terme (prochains sprints)

#### P2.1 — Supprimer la dénormalisation de `email` dans `user_quotas`

**Problème :** `user_quotas.email` est une copie de `users.email` sans sync garantie.

**Options :**
- **Option A (Simple) :** Créer un webhook better-auth → FastAPI déclenché à chaque changement d'email pour mettre à jour `user_quotas.email`.
- **Option B (Clean) :** Supprimer `user_quotas.email` et faire une JOIN sur `users` quand l'email est nécessaire. Requiert de mettre à jour les queries FastAPI.

**Recommandation :** Option B (plus clean, élimine la duplication), à faire après que la FK soit en place (P1.1).

---

#### P2.2 — Créer un modèle Prisma complet pour les tables SQLAlchemy manquantes

Les tables `document_share_invitations`, `share_notifications`, `infrastructure_metrics` existent en DB mais ne sont pas dans `schema.prisma`. Si Next.js a besoin de les lire, les ajouter au schéma (sans migration, les tables existent déjà).

---

#### P2.3 — Ajouter `created_at` à `user_quotas`

**Observation :** La table `user_quotas` a `updated_at` mais pas `created_at`. Toutes les autres tables du projet ont les deux. À ajouter :

```sql
ALTER TABLE user_quotas ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
```

```python
# SQLAlchemy
created_at: Mapped[datetime] = mapped_column(
    DateTime(timezone=True), default=func.now(), nullable=False
)
```

```prisma
// Prisma
created_at  DateTime  @default(now()) @db.Timestamptz(6)
```

---

## 4. Ordre d'Exécution Recommandé

```
IMMÉDIAT (sans migration, cette semaine) :
  [P0.1] Aligner nullable dans schema.prisma user_quotas
  [P0.2] Ajouter colonnes manquantes document_shares dans schema.prisma
  [P0.3] Vérifier et corriger le default de document_shares.permission

SPRINT SUIVANT (avec migrations SQL simples) :
  [P1.1] Vérifier orphans + ajouter FK user_quotas.user_id → users.id
  [P1.2] Retyper user_id comme @db.Uuid dans Prisma

BACKLOG (P2) :
  [P2.1] Supprimer dénormalisation email ou ajouter webhook sync
  [P2.2] Compléter schema.prisma avec tables SQLAlchemy manquantes
  [P2.3] Ajouter created_at à user_quotas
```

---

## 5. Risques à Surveiller

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Orphans dans `user_quotas` bloquent l'ajout FK | Moyenne | Élevé | Exécuter la query de détection AVANT la migration (P1.1) |
| `document_shares.permission` default diverge en prod vs dev | Faible | Moyen | Vérifier en base avant de corriger (P0.3) |
| `prisma generate` émet des migrations non souhaitées après P0.1 | Faible | Élevé | Toujours faire `prisma migrate --dry-run` avant d'appliquer |
| UUID cast échoue sur `user_id` si valeurs non-UUID existent | Très faible | Élevé | Vérifier avec `SELECT user_id FROM user_quotas WHERE user_id !~ '^[0-9a-f-]{36}$'` avant P1.2 |

---

## 6. Ce Qui N'Est PAS dans le Scope de Cette Roadmap

- Migrer SQLAlchemy vers Prisma (effort XL, architectural decision)
- Modifier le système d'authentification better-auth
- Changer la structure des tables `accounts`, `sessions`, `verification`
- Refactorer les services FastAPI qui utilisent `user_id` comme string

Ces décisions architecturales impliquent un P3 avec un blueprint complet et l'implication du tech lead.
