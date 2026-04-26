#!/bin/bash
###############################################################################
# rotate-postgres-password.sh
#
# Rotates PostgreSQL password securely for production
#
# USAGE:
#   ./scripts/rotate-postgres-password.sh [--host HOST] [--user USER] [--db DB]
#
# ENVIRONMENT:
#   Set GIGAPDF_PROD_HOST, GIGAPDF_PROD_USER, GIGAPDF_PROD_DB if not using defaults
#
# SAFETY:
#   - Generates a secure random password
#   - Tests connection before and after
#   - Restarts services with automatic rollback on failure
#   - Logs all operations
#   - Requires confirmation before applying changes
#
###############################################################################

set -euo pipefail

# Configuration
PROD_HOST="${GIGAPDF_PROD_HOST:?GIGAPDF_PROD_HOST is required (e.g. 'export GIGAPDF_PROD_HOST=your.vps.example.com')}"
PROD_USER="${GIGAPDF_PROD_USER:-ubuntu}"
POSTGRES_USER="${POSTGRES_USER:-gigapdf}"
POSTGRES_DB="${POSTGRES_DB:-gigapdf}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
LOG_FILE="/var/log/gigapdf/secrets-rotation.log"
BACKUP_ENV="/opt/gigapdf/.env.backup"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
    if [[ -w "$(dirname "$LOG_FILE")" ]]; then
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    fi
}

info() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1" >&2
    return 1
}

success() {
    echo -e "${GREEN}✓ SUCCESS${NC} $1"
}

# Generate secure password
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

# Test PostgreSQL connection
test_connection() {
    local host=$1
    local user=$2
    local pass=$3
    local db=$4

    if PGPASSWORD="$pass" psql -h "$host" -U "$user" -d "$db" -c "SELECT 1" &>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Rotate password
rotate_password() {
    local new_pass=$1

    log "Rotating PostgreSQL password for user '$POSTGRES_USER' on $POSTGRES_HOST..."

    # Update PostgreSQL
    log "Updating PostgreSQL user password..."
    sudo -u postgres psql -h "$POSTGRES_HOST" -c "ALTER USER $POSTGRES_USER WITH PASSWORD '$new_pass';" || {
        error "Failed to update PostgreSQL password"
        return 1
    }
    info "PostgreSQL password updated"

    # Test new password
    log "Testing new password..."
    if test_connection "$POSTGRES_HOST" "$POSTGRES_USER" "$new_pass" "$POSTGRES_DB"; then
        info "New password verified"
    else
        error "New password failed verification"
        return 1
    fi

    # Backup current .env
    log "Backing up .env file..."
    ssh "${PROD_USER}@${PROD_HOST}" "cp /opt/gigapdf/.env $BACKUP_ENV" || {
        error "Failed to backup .env"
        return 1
    }
    info ".env backed up to $BACKUP_ENV"

    # Update .env on production
    log "Updating .env on production server..."
    ssh "${PROD_USER}@${PROD_HOST}" "sed -i \"s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$new_pass|\" /opt/gigapdf/.env" || {
        error "Failed to update .env on production"
        return 1
    }
    info ".env updated on production"

    # Verify updated value
    log "Verifying .env update..."
    ssh "${PROD_USER}@${PROD_HOST}" "grep '^POSTGRES_PASSWORD=' /opt/gigapdf/.env" | head -c 20
    echo "..."

    return 0
}

# Restart services
restart_services() {
    log "Restarting GigaPDF services..."

    ssh "${PROD_USER}@${PROD_HOST}" << 'EOF'
        set -e
        echo "Stopping services..."
        sudo systemctl stop gigapdf-api gigapdf-celery gigapdf-celery-billing
        sleep 2

        echo "Starting services..."
        sudo systemctl start gigapdf-api gigapdf-celery gigapdf-celery-billing
        sleep 3

        echo "Verifying services..."
        systemctl is-active --quiet gigapdf-api && echo "✓ gigapdf-api running"
        systemctl is-active --quiet gigapdf-celery && echo "✓ gigapdf-celery running"
        systemctl is-active --quiet gigapdf-celery-billing && echo "✓ gigapdf-celery-billing running"
EOF

    return $?
}

# Health check
health_check() {
    log "Running health check..."

    local max_attempts=5
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if ssh "${PROD_USER}@${PROD_HOST}" "curl -s http://localhost:8000/health 2>&1 | grep -q 'healthy' || curl -s http://localhost:8000/api/health 2>&1 | grep -q 'ok'" 2>/dev/null; then
            info "API is healthy"
            return 0
        fi

        warn "Health check attempt $attempt/$max_attempts failed, retrying in 5s..."
        sleep 5
        attempt=$((attempt + 1))
    done

    error "Health check failed after $max_attempts attempts"
    return 1
}

# Rollback function
rollback() {
    warn "Rolling back changes..."

    log "Restoring previous .env..."
    ssh "${PROD_USER}@${PROD_HOST}" "mv $BACKUP_ENV /opt/gigapdf/.env" || {
        error "CRITICAL: Could not restore backup .env!"
        error "Manual intervention required at $BACKUP_ENV"
        return 1
    }

    log "Restarting services with previous configuration..."
    restart_services || {
        error "CRITICAL: Could not restart services after rollback!"
        return 1
    }

    success "Rollback completed"
    return 0
}

# Main script
main() {
    echo -e "${BLUE}=== GigaPDF PostgreSQL Password Rotation ===${NC}"
    echo ""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --host) PROD_HOST=$2; shift 2 ;;
            --user) PROD_USER=$2; shift 2 ;;
            --db) POSTGRES_DB=$2; shift 2 ;;
            *) error "Unknown option: $1"; exit 1 ;;
        esac
    done

    log "Configuration:"
    echo "  Production Host: $PROD_HOST"
    echo "  SSH User: $PROD_USER"
    echo "  PostgreSQL User: $POSTGRES_USER"
    echo "  PostgreSQL DB: $POSTGRES_DB"
    echo ""

    # Generate new password
    log "Generating new secure password..."
    NEW_PASS=$(generate_password)

    warn "IMPORTANT: New password will be generated securely"
    echo ""
    echo "    ${YELLOW}⚠ After successful rotation, save the password to 1Password or Vault${NC}"
    echo ""

    # Confirmation
    read -p "Proceed with password rotation? (yes/no): " -r response
    if [[ ! "$response" =~ ^[Yy][Ee][Ss]$ ]]; then
        error "Rotation cancelled by user"
        exit 1
    fi

    # Execute rotation
    if rotate_password "$NEW_PASS"; then
        info "Password rotation completed"
    else
        error "Password rotation failed, attempting rollback..."
        rollback
        exit 1
    fi

    # Restart services
    if restart_services; then
        info "Services restarted successfully"
    else
        error "Service restart failed, attempting rollback..."
        rollback
        exit 1
    fi

    # Health check
    if health_check; then
        success "Password rotation and services verification completed!"
        echo ""
        echo -e "${GREEN}✓ New PostgreSQL Password:${NC}"
        echo ""
        echo "    ${YELLOW}$NEW_PASS${NC}"
        echo ""
        warn "Save this password immediately to 1Password/Vault, then delete this terminal history:"
        echo "    history -c && exit"
        echo ""

        # Log rotation completion
        log "PostgreSQL password rotation completed successfully"
        log "New password: [REDACTED]"

        return 0
    else
        error "Health check failed, attempting rollback..."
        rollback
        exit 1
    fi
}

# Trap errors and cleanup
trap 'error "Script interrupted"; exit 130' INT TERM

# Run main
main "$@"
