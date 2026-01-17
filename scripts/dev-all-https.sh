#!/bin/bash
# =============================================================================
# GigaPDF - Development Environment Launcher (HTTPS)
# =============================================================================
# Launches all services with HTTPS support:
#   - FastAPI Backend (port 8000) - HTTP (proxied through Next.js)
#   - Next.js Web App (port 3000) - HTTPS
#   - Next.js Admin Panel (port 3001) - HTTPS
#   - Celery Worker (async tasks)
#   - Celery Beat (scheduled tasks)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════════════════════════════════╗"
echo "  ║              GigaPDF Development (HTTPS)                      ║"
echo "  ╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if .venv exists
if [ ! -d ".venv" ]; then
    echo -e "${RED}Error: Python virtual environment not found (.venv)${NC}"
    echo "Run: python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${RED}Error: Node modules not found${NC}"
    echo "Run: pnpm install"
    exit 1
fi

# Check for SSL certificates
if [ ! -f "certs/localhost+2.pem" ] || [ ! -f "certs/localhost+2-key.pem" ]; then
    echo -e "${YELLOW}SSL certificates not found. Generating...${NC}"
    mkdir -p certs
    cd certs
    mkcert localhost 127.0.0.1 ::1
    cd ..
    echo -e "${GREEN}SSL certificates generated!${NC}"
fi

# Check for required services
echo -e "${BLUE}Checking required services...${NC}"

# Check PostgreSQL
if ! pg_isready -q 2>/dev/null; then
    echo -e "${YELLOW}Warning: PostgreSQL may not be running${NC}"
fi

# Check Redis
if ! redis-cli ping > /dev/null 2>&1; then
    echo -e "${YELLOW}Warning: Redis may not be running${NC}"
fi

echo -e "${GREEN}Starting all services with HTTPS...${NC}"
echo -e "${CYAN}Web App: https://localhost:3000${NC}"
echo -e "${CYAN}Admin:   https://localhost:3001${NC}"
echo -e "${CYAN}API:     http://localhost:8000${NC}\n"

# Use concurrently to run all services with colored output
npx concurrently \
    --names "API,WEB,ADMIN,CELERY,BEAT" \
    --prefix-colors "blue,green,magenta,yellow,cyan" \
    --kill-others-on-fail \
    "bash -c '. .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000'" \
    "pnpm --filter web dev:https" \
    "pnpm --filter admin dev:https" \
    "bash -c '. .venv/bin/activate && celery -A app.tasks.celery_app worker --loglevel=info'" \
    "bash -c '. .venv/bin/activate && celery -A app.tasks.celery_app beat --loglevel=info'"
