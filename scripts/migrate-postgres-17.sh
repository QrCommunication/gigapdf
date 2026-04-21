#!/bin/bash
# =============================================================================
# GigaPDF — Migration PostgreSQL 16 → 17
# =============================================================================
# OBJECTIF : Migrer les données d'un volume PostgreSQL 16 vers PostgreSQL 17.
#
# CONTEXTE : Les data files PostgreSQL ne sont PAS compatibles entre versions
# majeures. Changer l'image docker de postgres:16 à postgres:17 sans migration
# provoque un crash immédiat avec l'erreur :
#   "FATAL: database files are incompatible with server"
#
# MÉTHODE : dump logique via pg_dump (PG16) + restore via pg_restore (PG17).
#           Cette méthode est sûre et éprouvée pour toutes les versions.
#
# DURÉE ESTIMÉE : 2-5 min pour une base < 1 Go. Prévoir une fenêtre de
#                 maintenance (downtime).
#
# USAGE : bash scripts/migrate-postgres-17.sh
#         Peut être lancé depuis la machine locale ou le VPS, avec Docker
#         disponible et le docker-compose.yml de ce projet en CWD.
#
# PRÉREQUIS :
#   - Docker installé et en cours d'exécution
#   - Le service postgres:16 est ARRÊTÉ (ou le dump se fait en live — OK si
#     aucune écriture en cours)
#   - Espace disque suffisant pour le dump (≈ taille de la base * 2)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
COMPOSE_FILE="docker-compose.yml"
DB_NAME="${POSTGRES_DB:-gigapdf}"
DB_USER="${POSTGRES_USER:-gigapdf}"
DUMP_FILE="/tmp/gigapdf-pg16-dump-$(date +%Y%m%d_%H%M%S).sql"
PG16_CONTAINER="gigapdf-postgres-pg16-migration"
PG17_CONTAINER="gigapdf-postgres"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${BLUE}===> $1${NC}"; }

# ---------------------------------------------------------------------------
# Contrôles préalables
# ---------------------------------------------------------------------------
log_step "Contrôles préalables"

if [ ! -f "$COMPOSE_FILE" ]; then
    log_error "docker-compose.yml introuvable. Lancer ce script depuis la racine du projet."
    exit 1
fi

if ! docker info &>/dev/null; then
    log_error "Docker n'est pas accessible. Vérifier que le daemon est démarré."
    exit 1
fi

# Charger .env si présent (pour POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)
if [ -f ".env" ]; then
    log_info "Chargement de .env..."
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

DB_PASSWORD="${POSTGRES_PASSWORD:-gigapdf_secret}"

log_info "Base cible      : ${DB_NAME}"
log_info "Utilisateur     : ${DB_USER}"
log_info "Fichier dump    : ${DUMP_FILE}"

# ---------------------------------------------------------------------------
# ÉTAPE 1 : Arrêt des services applicatifs (pas encore postgres)
# ---------------------------------------------------------------------------
log_step "ÉTAPE 1 — Arrêt des services applicatifs"
log_warn "Les services API, web, admin et celery vont être arrêtés."
read -r -p "Confirmer l'arrêt des services ? (yes/no) : " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    log_warn "Annulé."
    exit 0
fi

docker compose stop api celery-worker celery-beat web admin 2>/dev/null || true
log_info "Services applicatifs arrêtés."

# ---------------------------------------------------------------------------
# ÉTAPE 2 : Dump depuis PG16 (container existant)
# ---------------------------------------------------------------------------
log_step "ÉTAPE 2 — Dump logique depuis PostgreSQL 16"

# S'assurer que le container PG16 tourne
if ! docker compose ps postgres | grep -q "running"; then
    log_info "Démarrage du container postgres (PG16) pour le dump..."
    docker compose start postgres
    sleep 3
fi

log_info "Dump en cours vers ${DUMP_FILE} ..."
docker compose exec -T postgres \
    pg_dump \
    --username="${DB_USER}" \
    --format=custom \
    --verbose \
    "${DB_NAME}" > "${DUMP_FILE}"

DUMP_SIZE=$(du -sh "${DUMP_FILE}" | cut -f1)
log_info "Dump terminé. Taille : ${DUMP_SIZE}"

# Vérification basique du dump
if [ ! -s "${DUMP_FILE}" ]; then
    log_error "Le fichier dump est vide. Abandon."
    exit 1
fi

# ---------------------------------------------------------------------------
# ÉTAPE 3 : Arrêt et suppression du container PG16
# ---------------------------------------------------------------------------
log_step "ÉTAPE 3 — Arrêt du container PostgreSQL 16"
docker compose stop postgres
docker compose rm -f postgres
log_info "Container PG16 supprimé."

# ---------------------------------------------------------------------------
# ÉTAPE 4 : Sauvegarde du volume PG16 (sécurité)
# ---------------------------------------------------------------------------
log_step "ÉTAPE 4 — Sauvegarde du volume postgres_data (optionnel mais recommandé)"
VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep 'postgres_data' | head -1)
if [ -n "${VOLUME_NAME}" ]; then
    BACKUP_TAR="/tmp/gigapdf-pg16-volume-$(date +%Y%m%d_%H%M%S).tar.gz"
    log_info "Sauvegarde du volume ${VOLUME_NAME} vers ${BACKUP_TAR} ..."
    docker run --rm \
        -v "${VOLUME_NAME}:/data:ro" \
        -v /tmp:/backup \
        alpine \
        tar czf "/backup/$(basename "${BACKUP_TAR}")" -C /data .
    log_info "Volume sauvegardé : ${BACKUP_TAR}"
else
    log_warn "Volume postgres_data introuvable — skip backup volume."
fi

# ---------------------------------------------------------------------------
# ÉTAPE 5 : Suppression de l'ancien volume et création PG17
# ---------------------------------------------------------------------------
log_step "ÉTAPE 5 — Recréation du volume pour PostgreSQL 17"
log_warn "Le volume postgres_data va être supprimé (les données sont dans le dump)."
read -r -p "Confirmer la suppression du volume ? (yes/no) : " CONFIRM2
if [ "$CONFIRM2" != "yes" ]; then
    log_warn "Annulé. Le dump est disponible dans ${DUMP_FILE}."
    exit 0
fi

docker volume rm "${VOLUME_NAME}" 2>/dev/null || true
log_info "Ancien volume supprimé."

# Modifier temporairement l'image dans docker-compose pour PG17 si pas encore fait
# (normalement déjà fait dans docker-compose.yml après ce commit)
log_info "Démarrage du container PostgreSQL 17 (initialisation du volume vide)..."
docker compose up -d postgres
log_info "Attente de la disponibilité de PG17..."
for i in {1..30}; do
    if docker compose exec postgres pg_isready -U "${DB_USER}" &>/dev/null; then
        log_info "PostgreSQL 17 prêt."
        break
    fi
    sleep 2
    if [ "$i" -eq 30 ]; then
        log_error "PostgreSQL 17 n'a pas démarré après 60 secondes."
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# ÉTAPE 6 : Restore dans PG17
# ---------------------------------------------------------------------------
log_step "ÉTAPE 6 — Restore du dump dans PostgreSQL 17"
log_info "Restore en cours depuis ${DUMP_FILE} ..."

docker compose exec -T postgres \
    pg_restore \
    --username="${DB_USER}" \
    --dbname="${DB_NAME}" \
    --verbose \
    --no-acl \
    --no-owner < "${DUMP_FILE}"

log_info "Restore terminé."

# ---------------------------------------------------------------------------
# ÉTAPE 7 : Vérification
# ---------------------------------------------------------------------------
log_step "ÉTAPE 7 — Vérification"
PG_VERSION=$(docker compose exec -T postgres psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT version();")
TABLE_COUNT=$(docker compose exec -T postgres psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")

log_info "Version PG active : ${PG_VERSION}"
log_info "Tables dans public : ${TABLE_COUNT}"

# ---------------------------------------------------------------------------
# ÉTAPE 8 : Redémarrage des services applicatifs
# ---------------------------------------------------------------------------
log_step "ÉTAPE 8 — Redémarrage des services"
docker compose up -d
log_info "Tous les services redémarrés."

# ---------------------------------------------------------------------------
# Résumé
# ---------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  Migration PostgreSQL 16 → 17 terminée"
echo "=========================================="
echo ""
echo "  Dump conservé     : ${DUMP_FILE}"
if [ -n "${BACKUP_TAR:-}" ]; then
    echo "  Volume backup     : ${BACKUP_TAR}"
fi
echo ""
echo "  Conserver le dump minimum 48h avant suppression."
echo "  Commande de nettoyage (après validation) :"
echo "    rm -f ${DUMP_FILE}"
if [ -n "${BACKUP_TAR:-}" ]; then
    echo "    rm -f ${BACKUP_TAR}"
fi
echo ""
