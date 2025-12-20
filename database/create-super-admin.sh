#!/bin/bash
# =============================================================================
# GigaPDF Super Admin Creation Script
# =============================================================================
#
# Creates a super admin account for the admin panel.
# This script uses the Better Auth API to properly hash the password.
#
# Usage: ./database/create-super-admin.sh <email> <password> <name>
#
# Example: ./database/create-super-admin.sh admin@giga-pdf.com "MySecurePass123!" "Rony Licha"
#
# Note: For passwords with special characters like @!$, use single quotes:
#       ./database/create-super-admin.sh admin@giga-pdf.com 'Pass@!word123' 'Admin'
#
# Requirements:
# - curl
# - psql (PostgreSQL client)
# - ADMIN_URL environment variable or defaults to https://giga-pdf.com/admin
# - DATABASE_URL environment variable (or .env file in project root)
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ADMIN_URL="${ADMIN_URL:-https://giga-pdf.com/admin}"
DATABASE_URL="${DATABASE_URL:-}"

# Parse arguments
EMAIL="${1:-}"
PASSWORD="${2:-}"
NAME="${3:-}"

# Validate arguments
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ] || [ -z "$NAME" ]; then
    echo -e "${RED}Error: Missing required arguments${NC}"
    echo ""
    echo "Usage: $0 <email> <password> <name>"
    echo ""
    echo "Examples:"
    echo "  $0 admin@example.com 'MySecurePass123!' 'Admin Name'"
    echo "  $0 admin@giga-pdf.com 'Pass@!word' 'Rony Licha'"
    echo ""
    echo "Note: For passwords with special characters, use single quotes!"
    echo ""
    echo "Environment variables:"
    echo "  ADMIN_URL    - Admin panel URL (default: https://giga-pdf.com/admin)"
    echo "  DATABASE_URL - PostgreSQL connection string (for role update)"
    exit 1
fi

echo -e "${GREEN}=== GigaPDF Super Admin Creation ===${NC}"
echo ""
echo "Email: $EMAIL"
echo "Name:  $NAME"
echo "URL:   $ADMIN_URL"
echo ""

# Load DATABASE_URL from .env if not set
if [ -z "$DATABASE_URL" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

    if [ -f "$PROJECT_ROOT/.env" ]; then
        source "$PROJECT_ROOT/.env"
    elif [ -f "/opt/gigapdf/.env" ]; then
        source "/opt/gigapdf/.env"
    fi
fi

# Create JSON payload using a temp file to handle special characters
TEMP_JSON=$(mktemp)
cat > "$TEMP_JSON" << EOF
{"email":"$EMAIL","password":"$PASSWORD","name":"$NAME"}
EOF

# Step 1: Create user via Better Auth API
echo -e "${YELLOW}Step 1: Creating user via Better Auth API...${NC}"

RESPONSE=$(curl -s -X POST "${ADMIN_URL}/api/auth/sign-up/email" \
    -H "Content-Type: application/json" \
    -d @"$TEMP_JSON")

# Clean up temp file
rm -f "$TEMP_JSON"

# Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
    echo -e "${RED}Error creating user:${NC}"
    echo "$RESPONSE"
    exit 1
fi

# Check for empty response
if [ -z "$RESPONSE" ]; then
    echo -e "${RED}Error: Empty response from server${NC}"
    echo "Check that the admin panel is running at $ADMIN_URL"
    exit 1
fi

# Extract user ID
USER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$USER_ID" ]; then
    echo -e "${RED}Error: Could not extract user ID from response${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi

echo -e "${GREEN}User created with ID: $USER_ID${NC}"

# Step 2: Update role to super_admin
echo ""
echo -e "${YELLOW}Step 2: Updating role to super_admin...${NC}"

if [ -z "$DATABASE_URL" ]; then
    echo -e "${YELLOW}DATABASE_URL not found. Please update role manually:${NC}"
    echo ""
    echo "  psql \$DATABASE_URL -c \"UPDATE admin_users SET role = 'super_admin' WHERE email = '$EMAIL';\""
    echo ""
else
    if psql "$DATABASE_URL" -c "UPDATE admin_users SET role = 'super_admin' WHERE email = '$EMAIL';" 2>/dev/null; then
        echo -e "${GREEN}Role updated to super_admin${NC}"
    else
        echo -e "${RED}Failed to update role. Please run manually:${NC}"
        echo ""
        echo "  psql \$DATABASE_URL -c \"UPDATE admin_users SET role = 'super_admin' WHERE email = '$EMAIL';\""
        echo ""
    fi
fi

# Step 3: Verify
echo ""
echo -e "${GREEN}=== Super Admin Created Successfully ===${NC}"
echo ""
echo "You can now log in to the admin panel:"
echo "  URL:      $ADMIN_URL"
echo "  Email:    $EMAIL"
echo "  Password: (as provided)"
echo ""
