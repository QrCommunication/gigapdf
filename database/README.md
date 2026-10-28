# GigaPDF Database Management

## One database, one schema source: Alembic

GigaPDF uses a single PostgreSQL database shared by:

1. the Python backend — SQLAlchemy models in `app/models/`;
2. the web app — Prisma client from `apps/web/prisma/schema.prisma`;
3. the admin app — Prisma client from `apps/admin/prisma/schema.prisma`.

**Alembic creates every table**, including the ones only the Prisma schemas
describe (migration `migrations/versions/025_prisma_owned_tables.py`). The
Prisma schemas only read the database and generate the TypeScript clients.

### ⚠️ NEVER run `prisma db push` or `prisma migrate`

Both align the WHOLE database on one Prisma schema: they would alter or drop
the backend tables (and the other app's tables). The `db:push` / `db:migrate`
scripts were removed from the apps for that reason.

## Quick Start

### Fresh database

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/gigapdf"
source venv/bin/activate
alembic upgrade head          # every table, idempotent

cd apps/web && pnpm prisma generate
cd ../admin && pnpm prisma generate
```

### Check the database

```bash
alembic current               # must print the head revision
alembic history
```

## Table Ownership

| Defined by | Tables |
|------------|--------|
| SQLAlchemy (`app/models/`) | stored_documents, document_versions, document_shares, document_share_invitations, share_notifications, document_layers, folders, ocr_blocks, user_quotas, plans, api_keys, async_jobs, collaboration_sessions, element_locks, activity_logs, tenants, tenant_members, tenant_documents, tenant_invitations, infrastructure_metrics |
| Prisma web schema | users, sessions, accounts, verification, jwks (Better Auth), font_cache, user_signatures |
| Prisma admin schema | admin_users, admin_accounts, admin_sessions, admin_verification (Better Auth) |

All of them are created by Alembic. Better Auth generates **string IDs**: its
ID columns are `TEXT`, not `UUID`. Backend tables use PostgreSQL UUIDs.

## Schema Changes

### SQLAlchemy table

1. Edit the model in `app/models/`.
2. Write an Alembic migration in `migrations/versions/` (idempotent, with its
   integration test when it moves data).
3. If a Prisma schema mirrors the table, update that model by hand.

### Prisma-only table (Better Auth, font_cache, user_signatures)

1. Edit the model in the Prisma schema.
2. Generate the exact DDL with Prisma, without touching any database:
   ```bash
   cd apps/web
   DATABASE_URL=postgresql://x@localhost/x \
     npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
   ```
   (for the admin schema, run it from `apps/admin` with
   `--config ../web/prisma.config.ts`).
3. Ship it as a new Alembic migration.
4. `tests/integration/test_migration_025_prisma_owned_tables.py` compares the
   migrated database with the Prisma models (`prisma migrate diff
   --exit-code`) and fails on any difference.

### Prisma client regeneration

```bash
cd apps/web && pnpm prisma generate
cd apps/admin && pnpm prisma generate
```

## Creating a Super Admin

From `apps/admin`, with the production environment loaded:

```bash
pnpm create:admin                      # prompts for email, name, password
pnpm create:admin --reset-password     # existing admin: set a new password
```

## Troubleshooting

### `relation "…" does not exist`

The database is behind: run `alembic upgrade head`, then check
`alembic current`.

### "cached plan must not change result type"

Restart the Next.js services after schema changes:

```bash
systemctl restart gigapdf-web gigapdf-admin
```
