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

## Quick Start

### Fresh Database Setup

```bash
# Set the DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/gigapdf"

# Run the setup script
./database/setup.sh

# Create a super admin for the admin panel
./database/create-super-admin.sh admin@example.com 'SecurePassword123!' 'Admin Name'

# Generate Prisma clients
cd apps/web && pnpm prisma db pull && pnpm prisma generate
cd apps/admin && pnpm prisma db pull && pnpm prisma generate
```

### Reset Database (Development Only)

```bash
# ⚠️ This deletes ALL data!
./database/setup.sh --reset
```

### Check Database Status

```bash
./database/setup.sh --check
```

## Scripts

| Script | Description |
|--------|-------------|
| `setup.sh` | Apply migrations (idempotent, safe to run multiple times) |
| `setup.sh --reset` | Drop all tables and recreate (DESTRUCTIVE) |
| `setup.sh --check` | Show current tables and counts |
| `create-super-admin.sh` | Create a super admin account for the admin panel |

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

## Schema Details

### Better Auth Tables (Web & Admin)

Better Auth generates **string-based IDs** (not UUIDs). All ID columns use `TEXT` type.

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,  -- Better Auth generates string IDs
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    name TEXT,
    image TEXT,
    locale TEXT DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Core Tables

Core tables (documents, folders, etc.) use standard PostgreSQL UUIDs:

```sql
CREATE TABLE stored_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id VARCHAR(255) NOT NULL,
    -- ...
);
```

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

## Creating a Super Admin

The super admin account gives full access to the admin panel.

### Using the script (Recommended)

```bash
./database/create-super-admin.sh admin@giga-pdf.com 'SecurePassword123!' 'Rony Licha'
```

### Manual method

1. Create user via API:
```bash
curl -X POST 'https://giga-pdf.com/admin/api/auth/sign-up/email' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@giga-pdf.com","password":"SecurePassword123!","name":"Admin Name"}'
```

2. Update role in database:
```bash
psql $DATABASE_URL -c "UPDATE admin_users SET role = 'super_admin' WHERE email = 'admin@giga-pdf.com';"
```

## Troubleshooting

### "Invalid character in UUID" error

This happens when Better Auth tables have UUID type instead of TEXT. Solution:

```bash
./database/setup.sh --reset  # Reset and recreate all tables
```

### "cached plan must not change result type" error

Restart the Next.js services after schema changes:

```bash
systemctl restart gigapdf-web gigapdf-admin
```

### Prisma schema out of sync

Pull the latest schema from the database:

```bash
cd apps/web && pnpm prisma db pull && pnpm prisma generate
cd apps/admin && pnpm prisma db pull && pnpm prisma generate
```
