#!/usr/bin/env bash
# Installe (ou met à jour) le moteur OCR host-side de GigaPDF sur l'hôte Ploi.
#
# Usage (sur le serveur, depuis le checkout) :
#   bash deploy/ploi/install-ocr-engine.sh
#
# Pourquoi : la route Next /api/pdf/ocr envoie chaque page rastérisée au service
# gigapdf-ocr (OCR_SERVICE_URL, défaut 127.0.0.1:8077). Ce service était installé
# par deploy/deploy.sh sur l'ancien VPS ; le script de déploiement Ploi ne le fait
# pas, d'où un OCR en 500 (ECONNREFUSED) sur tout PDF scanné.
#
# Idempotent : le binaire et les modèles ne sont retéléchargés que si le fichier
# d'empreintes de la release a changé ; le service n'est redémarré que si le
# binaire, les modèles, l'unité ou le .env ont changé, ou s'il ne tourne pas.
# Échoue (code ≠ 0) si l'empreinte ne correspond pas ou si /health ne répond pas.
set -euo pipefail

RELEASE_URL="https://github.com/QrCommunication/gigapdf-lib/releases/download/ocr-rten-v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$APP_DIR/.env"
UNIT_SRC="$SCRIPT_DIR/systemd/gigapdf-ocr.service"
UNIT_DEST="/etc/systemd/system/gigapdf-ocr.service"
INSTALL_DIR="/opt/gigapdf-ocr"
BIN="$INSTALL_DIR/bin/ocr_serve"
MODELS_ROOT="/var/lib/gigapdf/rten-models"
MARKER="$MODELS_ROOT/.release-sha256"
OCR_BIND="127.0.0.1:8077"
HEALTH_URL="http://$OCR_BIND/health"
HEALTH_TIMEOUT_S=90

needs_restart=false
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. Binaire + modèles, uniquement si la release a changé.
curl -fsSL -o "$TMP/gigapdf-ocr.sha256" "$RELEASE_URL/gigapdf-ocr.sha256"
release_sha="$(sha256sum "$TMP/gigapdf-ocr.sha256" | awk '{print $1}')"
if [[ -x "$BIN" && -d "$MODELS_ROOT/models" ]] \
    && [[ "$(sudo cat "$MARKER" 2>/dev/null)" == "$release_sha" ]]; then
    echo "Moteur OCR déjà à jour."
else
    echo "Téléchargement du moteur OCR (binaire + modèles, ~250 Mo)..."
    curl -fsSL -o "$TMP/ocr_serve" "$RELEASE_URL/ocr_serve"
    curl -fsSL -o "$TMP/gigapdf-ocr-models.tar.gz" "$RELEASE_URL/gigapdf-ocr-models.tar.gz"
    (cd "$TMP" && sha256sum --check --strict gigapdf-ocr.sha256)

    sudo install -d -m 0755 -o root -g root "$INSTALL_DIR/bin" "$MODELS_ROOT"
    sudo install -m 0755 -o root -g root "$TMP/ocr_serve" "$BIN"
    # Extraction à côté puis bascule : un échec de tar laisse les anciens modèles en place.
    sudo rm -rf "$MODELS_ROOT/models.new"
    sudo mkdir "$MODELS_ROOT/models.new"
    sudo tar xzf "$TMP/gigapdf-ocr-models.tar.gz" -C "$MODELS_ROOT/models.new" --strip-components=1 models
    sudo chown -R root:root "$MODELS_ROOT/models.new"
    sudo chmod -R a+rX "$MODELS_ROOT/models.new"
    sudo rm -rf "$MODELS_ROOT/models"
    sudo mv "$MODELS_ROOT/models.new" "$MODELS_ROOT/models"
    echo "$release_sha" | sudo tee "$MARKER" >/dev/null
    needs_restart=true
    echo "Moteur OCR installé."
fi

# 2. Clés d'environnement lues par le binaire (ajoutées seulement si absentes).
for kv in "OCR_MODELS_DIR=$MODELS_ROOT/models" "OCR_BIND=$OCR_BIND" "OCR_SERVICE_URL=http://$OCR_BIND"; do
    if ! grep -q "^${kv%%=*}=" "$ENV_FILE"; then
        echo "$kv" >> "$ENV_FILE"
        echo "Ajouté au .env : ${kv%%=*}"
        needs_restart=true
    fi
done

# 3. Unité systemd versionnée.
if ! sudo cmp -s "$UNIT_SRC" "$UNIT_DEST"; then
    sudo install -m 0644 -o root -g root "$UNIT_SRC" "$UNIT_DEST"
    sudo systemctl daemon-reload
    echo "Unité mise à jour : $UNIT_DEST"
    needs_restart=true
fi
sudo systemctl enable --quiet gigapdf-ocr

if ! systemctl is-active --quiet gigapdf-ocr; then
    needs_restart=true
fi
if [[ "$needs_restart" == true ]]; then
    sudo systemctl restart gigapdf-ocr
    echo "gigapdf-ocr redémarré (chargement des modèles)."
fi

# 4. Les modèles se chargent au démarrage : attendre que /health réponde.
for ((elapsed = 0; elapsed < HEALTH_TIMEOUT_S; elapsed += 2)); do
    if health="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
        echo "gigapdf-ocr opérationnel : $health"
        exit 0
    fi
    sleep 2
done

echo "gigapdf-ocr ne répond pas sur $HEALTH_URL après ${HEALTH_TIMEOUT_S}s." >&2
sudo journalctl -u gigapdf-ocr -n 30 --no-pager >&2 || true
exit 1
