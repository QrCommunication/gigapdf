# GigaPDF Database Management

## Overview

GigaPDF uses a shared PostgreSQL database with multiple schema sources:

1. **SQLAlchemy Models** (Python Backend): `app/models/database.py`, `app/models/tenant.py`
2. **Prisma Schema (Web App)**: `apps/web/prisma/schema.prisma`
3. **Prisma Schema (Admin App)**: `apps/admin/prisma/schema.prisma`

## Important Rules

### ⚠️ NEVER use `prisma db push` directly

Using `prisma db push` will delete tables that are not in the Prisma schema. This causes data loss.

### ✅ Use the migration script instead

```bash
# From project root
./database/setup.sh
```

Or run the SQL directly:
```bash
psql $DATABASE_URL -f database/migrations/001_initial_schema.sql
```

## Table Ownership

| Module | Tables |
|--------|--------|
| Web App (BetterAuth) | users, accounts, sessions, verification |
| Admin App (BetterAuth) | admin_users, admin_accounts, admin_sessions, admin_verification |
| Backend (Documents) | stored_documents, document_versions, document_shares, folders |
| Backend (Quotas) | user_quotas, plans |
| Backend (Jobs) | async_jobs, collaboration_sessions, element_locks |
| Backend (Activity) | activity_logs |
| Backend (Tenants) | tenants, tenant_members, tenant_documents, tenant_invitations |

## Schema Changes

### Adding new tables or columns

1. Edit the SQLAlchemy models in `app/models/`
2. Add the SQL changes to a new migration file in `database/migrations/`
3. Run the migration on the database
4. Run `prisma db pull` in both web and admin apps to update their schemas

### Prisma client regeneration

After database changes, regenerate Prisma clients:

```bash
cd apps/web && pnpm prisma generate
cd apps/admin && pnpm prisma generate
```

## Initial Setup

For a fresh database:

```bash
# Set the DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/gigapdf"

# Run the setup script
./database/setup.sh

# Generate Prisma clients
cd apps/web && pnpm prisma db pull && pnpm prisma generate
cd apps/admin && pnpm prisma db pull && pnpm prisma generate
```
