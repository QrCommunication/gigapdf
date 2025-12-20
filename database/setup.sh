#!/bin/bash
# GigaPDF Database Setup Script
#
# This script sets up the complete database schema.
# Run this on a fresh database or to ensure all tables exist.
#
# Usage: ./database/setup.sh
#
# Requirements:
# - PostgreSQL client (psql)
# - DATABASE_URL environment variable set

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL environment variable is not set"
    echo "Example: export DATABASE_URL=postgresql://user:pass@host:5432/dbname"
    exit 1
fi

echo "🚀 GigaPDF Database Setup"
echo "========================="
echo ""

# Run migrations in order
for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        filename=$(basename "$migration")
        echo "📄 Applying migration: $filename"
        psql "$DATABASE_URL" -f "$migration"
        echo "   ✅ Done"
    fi
done

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Tables created:"
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
