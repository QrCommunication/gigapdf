# share_service.py — Plan de décomposition

## Contexte

`app/services/share_service.py` était une God Class de **1 048 lignes** violant le principe SRP.
Une première extraction a eu lieu le 2026-04-21 (HAUT-ARCH-08).

---

## Architecture après décomposition initiale

```
app/services/
├── share_service.py          # Facade backward-compat (208 lignes)
└── sharing/
    ├── __init__.py           # Re-exports publics (25 lignes)
    ├── constants.py          # SharePermission, InvitationStatus, ShareStatus (30 lignes)
    ├── invitation_service.py # InvitationService (387 lignes)
    ├── permission_service.py # PermissionService (209 lignes)
    └── share_crud_service.py # ShareCrudService (609 lignes)
```

### Responsabilités extraites

| Sous-service | Méthodes | Lignes |
|---|---|---|
| `invitation_service` | `share_document`, `accept_invitation`, `decline_invitation`, `get_pending_invitations` | 387 |
| `permission_service` | `check_access`, `update_permission` | 209 |
| `share_crud_service` | `revoke_share`, `get_document_shares`, `get_shared_by_me`, `get_shared_with_me`, `create_public_link`, `revoke_public_link` | 609 |
| `constants` | `SharePermission`, `InvitationStatus`, `ShareStatus` | 30 |

**Lignes extraites de la God Class : 1 048 → 208 (facade) + 1 235 (sous-services + constants + __init__)**

---

## Backward Compatibility

Le consommateur unique (`app/api/v1/sharing.py`) importe :
```python
from app.services.share_service import share_service, SharePermission
```

Ces imports continuent de fonctionner sans modification grâce à la facade.
**Ne pas modifier `app/api/v1/sharing.py`** avant la phase 2 de migration.

---

## Roadmap — Phase 2 (migration des imports)

### Objectif
Supprimer la classe `ShareService` (facade) et migrer les imports vers les sous-services directs.

### Étape 1 — Migrer le router (1 fichier)

`app/api/v1/sharing.py` : remplacer l'import unique par :

```python
# AVANT
from app.services.share_service import share_service, SharePermission

# APRÈS
from app.services.sharing import (
    SharePermission,
    invitation_service,
    permission_service,
    share_crud_service,
)
```

Puis mettre à jour chaque appel :
- `share_service.share_document(...)` → `invitation_service.share_document(...)`
- `share_service.accept_invitation(...)` → `invitation_service.accept_invitation(...)`
- `share_service.decline_invitation(...)` → `invitation_service.decline_invitation(...)`
- `share_service.get_pending_invitations(...)` → `invitation_service.get_pending_invitations(...)`
- `share_service.check_access(...)` → `permission_service.check_access(...)`
- `share_service.update_permission(...)` → `permission_service.update_permission(...)`
- `share_service.revoke_share(...)` → `share_crud_service.revoke_share(...)`
- `share_service.get_document_shares(...)` → `share_crud_service.get_document_shares(...)`
- `share_service.get_shared_by_me(...)` → `share_crud_service.get_shared_by_me(...)`
- `share_service.get_shared_with_me(...)` → `share_crud_service.get_shared_with_me(...)`
- `share_service.create_public_link(...)` → `share_crud_service.create_public_link(...)`
- `share_service.revoke_public_link(...)` → `share_crud_service.revoke_public_link(...)`

### Étape 2 — Supprimer la facade

Une fois le router migré et les tests validés, supprimer `app/services/share_service.py`
et le remplacer par un shim de dépreciation (ou une suppression nette si aucun consommateur externe).

### Étape 3 — Extractions complémentaires potentielles

`share_crud_service.py` (609 lignes) reste trop large. Candidats à l'extraction :

| Extraction | Méthodes | Justification |
|---|---|---|
| `public_link_service.py` | `create_public_link`, `revoke_public_link` | Tokens publics = responsabilité distincte des partages privés |
| `share_query_service.py` | `get_shared_with_me`, `get_shared_by_me`, `get_document_shares` | Lecture seule, pas d'écriture |

Garder `ShareCrudService` pour `revoke_share` uniquement (mutation d'un share existant).

### Étape 4 — Notifications

Les créations de `ShareNotification` sont actuellement embarquées dans chaque sous-service.
Si le volume de notifications augmente, les extraire dans un `share_notification_service.py`
dédié (pattern Observer / Event-driven).

---

## Tests à valider après chaque étape

- [ ] `app/api/v1/sharing.py` — tous les endpoints (12 méthodes)
- [ ] Tests d'intégration existants dans `tests/integration/api/` (si présents)
- [ ] Tests unitaires des sous-services (à créer — voir ci-dessous)

### Tests unitaires à créer (Phase 2)

```
tests/unit/services/sharing/
  test_invitation_service.py      # share_document, accept/decline, pending list
  test_permission_service.py      # check_access (tous les sources), update_permission
  test_share_crud_service.py      # revoke, CRUD, public links
```

Chaque test doit mocker `get_db_session` et les modèles SQLAlchemy.

---

## Décisions techniques

| Décision | Raison |
|---|---|
| Facade plutôt que réécriture des imports en une passe | Zéro risque de régression — 1 seul PR atomique |
| `@staticmethod` maintenu dans les sous-services | Alignement avec le pattern existant dans le codebase |
| `_generate_token()` dupliqué dans invitation et share_crud | Légitime — les deux contextes sont indépendants, DRY prématuré |
| `ShareNotification` dans chaque sous-service | Couplage fort avec la transaction DB — extraction future si besoin |
