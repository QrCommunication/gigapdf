#!/usr/bin/env bash
# Forced-command target for the gigapdf CI deploy SSH key (auto-deploy on green main).
#
# INSTALL (this file is the source of truth → prod VPS):
#   sudo install -m 0755 deploy/gigapdf-ci-deploy.sh /usr/local/bin/gigapdf-ci-deploy.sh
# The prod deploy key's authorized_keys pins:
#   command="/usr/local/bin/gigapdf-ci-deploy.sh",no-port-forwarding,... <key>
# so a CI push can ONLY run this script (reset to origin/main + deploy/deploy.sh).
#
# prod `origin` = bare repo /opt/gigapdf-repo.git (push-production model, peut être
# en retard). Le CI a poussé sur GitHub → on déploie depuis le remote `github`.
set -euo pipefail
cd /opt/gigapdf
# Reclaim deployer (ubuntu) ownership BEFORE git ops. A prior MANUAL redeploy.sh
# chowns the whole repo to the service user (gigapdf); the CI deploy runs as ubuntu,
# so `git reset --hard` fails with "unable to unlink old '<file>': Permission denied".
# deploy.sh's section 0.5 reclaims .turbo/.next but runs AFTER this reset (too late),
# hence the reclaim lives here, ahead of the fetch/reset.
echo "[ci-deploy] reclaiming deployer ownership of /opt/gigapdf"
sudo chown -R ubuntu:ubuntu /opt/gigapdf
echo "[ci-deploy] fetch github main"
git fetch github main
git reset --hard github/main
echo "[ci-deploy] HEAD now $(git rev-parse --short HEAD)"
echo "[ci-deploy] running deploy/deploy.sh"
exec bash deploy/deploy.sh
