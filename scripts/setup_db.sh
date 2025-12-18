#!/bin/bash
# Setup PostgreSQL database for Giga-PDF

set -e

# Default values
DB_USER="${GIGAPDF_DB_USER:-gigapdf}"
DB_PASSWORD="${GIGAPDF_DB_PASSWORD:-gigapdf}"
DB_NAME="${GIGAPDF_DB_NAME:-gigapdf}"
DB_HOST="${GIGAPDF_DB_HOST:-localhost}"

echo "Setting up PostgreSQL database..."

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "PostgreSQL is not installed. Please install it first."
    exit 1
fi

# Create user and databases
sudo -u postgres psql << EOF
-- Create user if not exists
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
    END IF;
END
\$\$;

-- Create main database
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

-- Create Celery results database
SELECT 'CREATE DATABASE ${DB_NAME}_celery OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}_celery')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME}_celery TO $DB_USER;
EOF

echo ""
echo "Database setup complete!"
echo ""
echo "Connection string:"
echo "  postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME"
echo ""
echo "Add this to your .env file:"
echo "  DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME"
echo "  CELERY_RESULT_BACKEND=db+postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/${DB_NAME}_celery"
