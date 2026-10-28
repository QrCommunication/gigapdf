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

# The Ploi site template adds X-Frame-Options "SAMEORIGIN", X-XSS-Protection
# and X-Content-Type-Options at server level. Next already sends the security
# headers (apps/web/src/lib/security-headers.ts), so every page carried two
# contradictory X-Frame-Options (DENY + SAMEORIGIN), and the embed widget got
# SAMEORIGIN although it must be framable. X-XSS-Protection "1; mode=block" is
# obsolete and can itself open XS-leaks. Removing the three lines makes Next the
# single source. Ploi rewrites this file when the site is edited in its panel,
# hence the check on every deploy.
TEMPLATE_HEADER_RE='^[[:space:]]*add_header[[:space:]]+(X-Frame-Options|X-XSS-Protection|X-Content-Type-Options)[[:space:]]'
for site_dir in "$SRC_ROOT"/*/; do
    site_conf="/etc/nginx/sites-available/$(basename "$site_dir")"
    sudo test -f "$site_conf" || continue
    sudo grep -Eq "$TEMPLATE_HEADER_RE" "$site_conf" || continue
    sudo cp -p "$site_conf" "$BACKUP_DIR/${site_conf//\//__}"
    sudo sed -E -i "/$TEMPLATE_HEADER_RE/d" "$site_conf"
    changed+=("$site_conf")
    echo "En-têtes du gabarit Ploi retirés : $site_conf"
done

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
