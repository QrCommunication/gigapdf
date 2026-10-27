#!/usr/bin/env bash
# Installe (ou met à jour) les includes nginx versionnés de GigaPDF sur l'hôte Ploi.
#
# Usage (sur le serveur, depuis le checkout) :
#   bash deploy/ploi/install-nginx-routing.sh
#
# Idempotent : ne recharge nginx que si un fichier a changé. En cas d'échec de
# `nginx -t`, restaure l'état précédent et sort en erreur, sans recharger.
set -euo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nginx"
DEST_ROOT="/etc/nginx/ploi"
BACKUP_DIR="$(mktemp -d)"
changed=()

restore() {
    local file
    for file in "${changed[@]}"; do
        if [[ -f "$BACKUP_DIR/${file//\//__}" ]]; then
            sudo cp -p "$BACKUP_DIR/${file//\//__}" "$file"
        else
            sudo rm -f "$file"
        fi
    done
}
trap 'rm -rf "$BACKUP_DIR"' EXIT

while IFS= read -r -d '' src; do
    rel="${src#"$SRC_ROOT"/}"
    dest="$DEST_ROOT/$rel"
    if sudo test -f "$dest" && sudo cmp -s "$src" "$dest"; then
        continue
    fi
    sudo test -d "$(dirname "$dest")" || {
        echo "Dossier Ploi absent : $(dirname "$dest") (site non créé dans Ploi ?)" >&2
        exit 1
    }
    sudo test -f "$dest" && sudo cp -p "$dest" "$BACKUP_DIR/${dest//\//__}"
    sudo install -m 0644 -o root -g root "$src" "$dest"
    changed+=("$dest")
    echo "Mis à jour : $dest"
done < <(find "$SRC_ROOT" -type f -name '*.conf' -print0)

if [[ ${#changed[@]} -eq 0 ]]; then
    echo "Configuration nginx déjà à jour."
    exit 0
fi

if ! sudo nginx -t; then
    echo "nginx -t a échoué : restauration de la configuration précédente." >&2
    restore
    exit 1
fi

sudo systemctl reload nginx
echo "nginx rechargé (${#changed[@]} fichier(s))."
