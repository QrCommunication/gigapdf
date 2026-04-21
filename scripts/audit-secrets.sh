#!/bin/bash
###############################################################################
# audit-secrets.sh
#
# Scans repository for hardcoded secrets and suspicious patterns
#
# USAGE:
#   ./scripts/audit-secrets.sh [--fail-on-findings]
#
# EXIT CODES:
#   0 = No secrets found
#   1 = Secrets found (or --fail-on-findings flag set)
#
# CAN BE USED AS:
#   - Pre-commit hook: scripts/audit-secrets.sh --fail-on-findings
#   - CI/CD check: scripts/audit-secrets.sh
#   - Manual audit: scripts/audit-secrets.sh
#
###############################################################################

set -euo pipefail

# Configuration
REPO_ROOT="${1:-.}"
FAIL_ON_FINDINGS="${2:-}"
FINDINGS=0
TEMP_REPORT="/tmp/secrets-audit-$(date +%s).txt"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Patterns to detect
declare -A PATTERNS=(
    ["password"]='(?i)password\s*[:=]\s*["\x27]?[a-zA-Z0-9!@#$%^&*_\-\.]{8,}["\x27]?'
    ["api_key"]='(?i)(api[_-]?key|apikey)\s*[:=]\s*["\x27]?[a-zA-Z0-9_\-]{16,}["\x27]?'
    ["token"]='(?i)(token|auth[_-]?token)\s*[:=]\s*["\x27]?[a-zA-Z0-9_\-\.]{20,}["\x27]?'
    ["secret"]='(?i)(secret|api[_-]?secret)\s*[:=]\s*["\x27]?[a-zA-Z0-9!@#$%^&*_\-\.]{16,}["\x27]?'
    ["aws_secret"]='AKIA[0-9A-Z]{16}|aws_secret_access_key'
    ["stripe_key"]='(sk_live|sk_test|rk_live|rk_test)_[0-9a-zA-Z]{20,}'
    ["github_token"]='ghp_[0-9a-zA-Z]{36,255}'
    ["slack_token"]='xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9_-]{24,34}'
    ["private_key"]='-----BEGIN (RSA|DSA|EC|PGP|OPENSSH) PRIVATE KEY'
    ["jwt_secret"]='(?i)(jwt[_-]?secret|jwt[_-]?key)\s*[:=]\s*["\x27]?[a-zA-Z0-9_\-\.]{20,}["\x27]?'
    ["db_password"]='(?i)(postgresql|postgres|mysql|mongo)[_-]?password\s*[:=]'
)

# Files to exclude
EXCLUDE_PATTERNS=(
    "node_modules"
    ".git"
    "dist"
    "build"
    ".next"
    "coverage"
    "*.min.js"
    "*.lock"
)

# Functions
log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

info() {
    echo -e "${GREEN}ℹ${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1" >&2
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Build grep exclude arguments
build_excludes() {
    local excludes=""
    for pattern in "${EXCLUDE_PATTERNS[@]}"; do
        excludes="$excludes --exclude-dir=$pattern"
    done
    echo "$excludes"
}

# Check for sensitive files
check_sensitive_files() {
    log "Checking for sensitive files..."

    local sensitive_files=(
        ".env"
        ".env.local"
        ".env.prod"
        ".env.production"
        "secrets.json"
        "credentials.json"
        "*.pem"
        "*.key"
        "*.p12"
        ".aws/credentials"
        ".ssh/id_rsa"
    )

    for pattern in "${sensitive_files[@]}"; do
        if find "$REPO_ROOT" -name "$pattern" -not -path "*/.git/*" -not -path "*/node_modules/*" 2>/dev/null | grep -q .; then
            error "FOUND SENSITIVE FILE: $pattern"
            find "$REPO_ROOT" -name "$pattern" -not -path "*/.git/*" -not -path "*/node_modules/*" 2>/dev/null | while read -r file; do
                echo "    $file"
            done
            FINDINGS=$((FINDINGS + 1))
        fi
    done
}

# Scan for pattern matches
scan_patterns() {
    log "Scanning for secret patterns..."

    local excludes=$(build_excludes)

    for pattern_name in "${!PATTERNS[@]}"; do
        local pattern="${PATTERNS[$pattern_name]}"

        # Try grep with extended regex
        if grep -rE "$pattern" \
            "$REPO_ROOT" \
            $excludes \
            --include="*.py" \
            --include="*.ts" \
            --include="*.tsx" \
            --include="*.js" \
            --include="*.jsx" \
            --include="*.json" \
            --include="*.yml" \
            --include="*.yaml" \
            --include="*.env*" \
            --include="*.sh" \
            2>/dev/null | grep -v -E "(example|template|placeholder|fake|test_|dummy_)" | head -10 > "$TEMP_REPORT.tmp" 2>/dev/null; then

            if [ -s "$TEMP_REPORT.tmp" ]; then
                error "POTENTIAL SECRET FOUND: [$pattern_name]"
                head -5 "$TEMP_REPORT.tmp" | while read -r line; do
                    # Redact sensitive parts (keep only file path)
                    file_path=$(echo "$line" | cut -d: -f1)
                    line_num=$(echo "$line" | cut -d: -f2)
                    echo "    $file_path:$line_num"
                done
                rm -f "$TEMP_REPORT.tmp"
                FINDINGS=$((FINDINGS + 1))
            fi
        fi
    done
}

# Check .gitignore coverage
check_gitignore() {
    log "Checking .gitignore coverage..."

    local required_patterns=(
        ".env"
        ".env.local"
        ".env.*.local"
        "*.key"
        "*.pem"
        "secrets/"
    )

    for pattern in "${required_patterns[@]}"; do
        if ! grep -q "^${pattern}$" "$REPO_ROOT/.gitignore" 2>/dev/null; then
            warn ".gitignore missing pattern: $pattern"
        fi
    done
}

# Check environment files
check_env_files() {
    log "Checking .env files..."

    if [ -f "$REPO_ROOT/.env" ]; then
        warn ".env file exists in repo (should be .gitignore'd)"
        FINDINGS=$((FINDINGS + 1))
    fi

    if [ ! -f "$REPO_ROOT/.env.example" ]; then
        warn ".env.example template not found (should exist for documentation)"
    fi
}

# Generate report
generate_report() {
    {
        echo "============================================"
        echo "Secrets Audit Report"
        echo "============================================"
        echo "Timestamp: $(date)"
        echo "Repository: $REPO_ROOT"
        echo ""
        echo "Summary:"
        echo "--------"
        if [ $FINDINGS -eq 0 ]; then
            echo "✓ No secrets detected"
        else
            echo "✗ Found $FINDINGS potential security issues"
        fi
        echo ""
        echo "Recommendations:"
        echo "----------------"
        echo "1. Review all findings above"
        echo "2. Remove any credentials from source code"
        echo "3. Store secrets in environment variables"
        echo "4. Use .env.example for template without values"
        echo "5. Configure pre-commit hook: git config core.hooksPath scripts/hooks"
        echo ""
    } > "$TEMP_REPORT"

    if [ -t 1 ]; then
        # Interactive: show report
        cat "$TEMP_REPORT"
    fi

    # Save to file
    cp "$TEMP_REPORT" "${REPO_ROOT}/audit-secrets-report.txt"
    info "Report saved to: ${REPO_ROOT}/audit-secrets-report.txt"

    rm -f "$TEMP_REPORT"
}

# Main execution
main() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  GigaPDF Secrets Audit${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    # Run checks
    check_sensitive_files
    scan_patterns
    check_gitignore
    check_env_files

    echo ""

    # Generate report
    generate_report

    echo ""

    # Exit with appropriate code
    if [ $FINDINGS -gt 0 ]; then
        echo -e "${RED}✗ AUDIT FAILED: $FINDINGS security issues detected${NC}"
        echo ""
        echo "Actions:"
        echo "  1. Review audit-secrets-report.txt for details"
        echo "  2. Remove secrets from source code"
        echo "  3. Store in .env or secret manager"
        echo "  4. If accidentally committed, use:"
        echo "     git filter-branch --tree-filter 'rm -f <file>' HEAD"
        echo ""

        if [ -n "$FAIL_ON_FINDINGS" ] && [ "$FAIL_ON_FINDINGS" = "--fail-on-findings" ]; then
            exit 1
        fi
    else
        success "AUDIT PASSED: No secrets detected"
        exit 0
    fi
}

# Run main
main "$@"
