#!/bin/bash
# Lance tous les services en mode développement HTTPS

cd "$(dirname "$0")/.."

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Démarrage de GigaPDF en mode HTTPS...${NC}\n"

# Vérifier que les certificats existent
if [ ! -f "certs/localhost+2.pem" ]; then
    echo -e "${RED}❌ Certificats non trouvés. Exécutez d'abord:${NC}"
    echo "   mkcert -install"
    echo "   cd certs && mkcert localhost 127.0.0.1 ::1"
    exit 1
fi

# Build les packages d'abord
echo -e "${BLUE}📦 Build des packages...${NC}"
pnpm build:packages

# Lancer tous les services
echo -e "${GREEN}🔥 Lancement des services...${NC}\n"

concurrently \
    --names "API,WEB,ADMIN" \
    --prefix-colors "blue,green,yellow" \
    --kill-others \
    "bash -c 'source .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --reload-exclude node_modules --reload-exclude .git --reload-exclude apps --reload-exclude packages'" \
    "cd apps/web && node server-https.mjs" \
    "cd apps/admin && pnpm dev"
