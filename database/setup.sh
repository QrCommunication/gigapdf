#!/bin/bash
# =============================================================================
# GigaPDF Database Setup Script
# =============================================================================
#
# This script sets up the complete database schema.
# It can be run on a fresh database or to ensure all tables exist.
#
# Usage:
#   ./database/setup.sh           # Apply migrations (safe, idempotent)
#   ./database/setup.sh --reset   # Drop all tables and recreate (DESTRUCTIVE)
#   ./database/setup.sh --check   # Check database status only
#
# Requirements:
# - PostgreSQL client (psql)
# - DATABASE_URL environment variable set
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

# Parse arguments
RESET_MODE=false
CHECK_ONLY=false

for arg in "$@"; do
    case $arg in
        --reset)
            RESET_MODE=true
            ;;
        --check)
            CHECK_ONLY=true
            ;;
        --help|-h)
            echo "GigaPDF Database Setup"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --reset   Drop all tables and recreate (DESTRUCTIVE)"
            echo "  --check   Check database status only"
            echo "  --help    Show this help message"
            exit 0
            ;;
    esac
done

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    # Try to load from .env
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
    if [ -f "$PROJECT_ROOT/.env" ]; then
        source "$PROJECT_ROOT/.env"
    fi
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
    echo "Example: export DATABASE_URL=postgresql://user:pass@host:5432/dbname"
    exit 1
fi

echo -e "${BLUE}=== GigaPDF Database Setup ===${NC}"
echo ""

# Check database connection
echo -e "${YELLOW}Checking database connection...${NC}"
if ! psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}Error: Cannot connect to database${NC}"
    exit 1
fi
echo -e "${GREEN}Database connection OK${NC}"
echo ""

# Check only mode
if [ "$CHECK_ONLY" = true ]; then
    echo -e "${YELLOW}Current tables:${NC}"
    psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"

    echo ""
    echo -e "${YELLOW}Table counts:${NC}"
    psql "$DATABASE_URL" -c "
        SELECT
            'users' as table_name, COUNT(*) as count FROM users
        UNION ALL SELECT 'admin_users', COUNT(*) FROM admin_users
        UNION ALL SELECT 'stored_documents', COUNT(*) FROM stored_documents
        UNION ALL SELECT 'plans', COUNT(*) FROM plans
        UNION ALL SELECT 'user_quotas', COUNT(*) FROM user_quotas
        ORDER BY table_name;
    " 2>/dev/null || echo "(Some tables may not exist yet)"
    exit 0
fi

# Reset mode - DROP ALL TABLES
if [ "$RESET_MODE" = true ]; then
    echo -e "${RED}⚠️  WARNING: This will DELETE ALL DATA!${NC}"
    echo ""
    read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi

    echo ""
    echo -e "${YELLOW}Dropping all tables...${NC}"

    psql "$DATABASE_URL" -c "
        DROP TABLE IF EXISTS tenant_invitations CASCADE;
        DROP TABLE IF EXISTS tenant_documents CASCADE;
        DROP TABLE IF EXISTS tenant_members CASCADE;
        DROP TABLE IF EXISTS tenants CASCADE;
        DROP TABLE IF EXISTS activity_logs CASCADE;
        DROP TABLE IF EXISTS element_locks CASCADE;
        DROP TABLE IF EXISTS collaboration_sessions CASCADE;
        DROP TABLE IF EXISTS async_jobs CASCADE;
        DROP TABLE IF EXISTS user_quotas CASCADE;
        DROP TABLE IF EXISTS plans CASCADE;
        DROP TABLE IF EXISTS document_shares CASCADE;
        DROP TABLE IF EXISTS document_versions CASCADE;
        DROP TABLE IF EXISTS stored_documents CASCADE;
        DROP TABLE IF EXISTS folders CASCADE;
        DROP TABLE IF EXISTS admin_verification CASCADE;
        DROP TABLE IF EXISTS admin_sessions CASCADE;
        DROP TABLE IF EXISTS admin_accounts CASCADE;
        DROP TABLE IF EXISTS admin_users CASCADE;
        DROP TABLE IF EXISTS verification CASCADE;
        DROP TABLE IF EXISTS sessions CASCADE;
        DROP TABLE IF EXISTS accounts CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
    "

    echo -e "${GREEN}All tables dropped${NC}"
    echo ""
fi

# Run migrations in order
echo -e "${YELLOW}Applying migrations...${NC}"
echo ""

for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        filename=$(basename "$migration")
        echo -e "  ${BLUE}📄 $filename${NC}"

        if psql "$DATABASE_URL" -f "$migration" > /dev/null 2>&1; then
            echo -e "     ${GREEN}✓ Done${NC}"
        else
            echo -e "     ${YELLOW}⚠ Some statements may have failed (table already exists)${NC}"
        fi
    fi
done

echo ""
echo -e "${GREEN}=== Database setup complete! ===${NC}"
echo ""

# Show summary
echo -e "${YELLOW}Tables created:${NC}"
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" 2>/dev/null

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Regenerate Prisma clients:"
echo "     cd apps/web && pnpm prisma db pull && pnpm prisma generate"
echo "     cd apps/admin && pnpm prisma db pull && pnpm prisma generate"
echo ""
echo "  2. Create a super admin (optional):"
echo "     ./database/create-super-admin.sh admin@example.com 'password' 'Admin Name'"
echo ""
