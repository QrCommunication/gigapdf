#!/usr/bin/env bash
# =============================================================================
# GigaPDF — Idempotent redeploy script
#
# Runs the full deploy in one shot from a developer laptop:
#   1. Push HEAD to the production remote
#   2. SSH into the VPS, fetch + reset, fix perms, build, copy static+public,
#      restart systemd services, and smoke-check the HTTP endpoints.
#
# Safe to run repeatedly — every step is idempotent. Designed to recover from
# partially failed previous deploys (mixed ownership, stale .next, missing
# public copy, etc).
#
# Usage:
#   bash deploy/redeploy.sh                  # deploy current HEAD
#   bash deploy/redeploy.sh --web-only       # skip celery/api restart
#   bash deploy/redeploy.sh --skip-push      # assume origin/main is current
#   bash deploy/redeploy.sh --skip-build     # only copy static + restart
#
# Exits non-zero on any hard failure. Smoke checks at the end are warnings
# (informational) unless --strict is passed.
# =============================================================================

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
VPS_USER="${GIGAPDF_VPS_USER:-ubuntu}"
VPS_HOST="${GIGAPDF_VPS_HOST:-51.159.105.179}"
VPS_PATH="${GIGAPDF_VPS_PATH:-/opt/gigapdf}"
APP_USER="${GIGAPDF_APP_USER:-gigapdf}"
APP_GROUP="${GIGAPDF_APP_GROUP:-gigapdf}"
REMOTE="${GIGAPDF_REMOTE:-production}"
BRANCH="${GIGAPDF_BRANCH:-main}"

WEB_ONLY=false
SKIP_PUSH=false
SKIP_BUILD=false
STRICT=false
for arg in "$@"; do
  case "$arg" in
    --web-only) WEB_ONLY=true ;;
    --skip-push) SKIP_PUSH=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --strict) STRICT=true ;;
    -h|--help)
      sed -n '1,/^# ==/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "[warn] unknown flag: $arg" >&2 ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { printf "${BLUE}[info]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[ ok ]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
fail()  { printf "${RED}[fail]${NC} %s\n" "$*" >&2; exit 1; }

# ── 1. Push to production remote ────────────────────────────────────────────
if ! $SKIP_PUSH; then
  info "Pushing ${BRANCH} → ${REMOTE}"
  git push "$REMOTE" "$BRANCH" 2>&1 | tail -5 || warn "push hook returned non-zero (continuing — we pull manually on the VPS)"
else
  info "Skipping push (--skip-push)"
fi

# ── 2. Run the remote sequence ──────────────────────────────────────────────
# Everything below runs on the VPS in a single SSH session so a partial
# failure doesn't leave the filesystem in a broken ownership state.
REMOTE_SCRIPT=$(cat <<REMOTE
set -euo pipefail

VPS_PATH="${VPS_PATH}"
APP_USER="${APP_USER}"
APP_GROUP="${APP_GROUP}"
BRANCH="${BRANCH}"
SKIP_BUILD=${SKIP_BUILD}
WEB_ONLY=${WEB_ONLY}

cd "\$VPS_PATH"

# 2.1 Take full ownership so every subsequent op works ────────────────────
echo "[remote] Normalizing ownership to \$USER for git ops"
sudo chown -R "\$USER":"\$USER" "\$VPS_PATH"

# 2.2 Fast-forward to the pushed branch — reset --hard survives local drift
echo "[remote] Fetching origin/\$BRANCH"
git fetch origin "\$BRANCH"
git reset --hard "origin/\$BRANCH"
git log --oneline -3

# 2.3 Install dependencies — always, cheap if unchanged
echo "[remote] Installing pnpm deps (frozen lockfile)"
pnpm install --frozen-lockfile --prefer-offline 2>&1 | tail -3

# 2.4 Build (unless --skip-build) — sequential turbo avoids OOM on big deps
if ! \$SKIP_BUILD; then
  echo "[remote] Building packages"
  NODE_OPTIONS='--max-old-space-size=1536' pnpm turbo build --filter='./packages/*' --concurrency=1 2>&1 | tail -5

  echo "[remote] Building apps/web"
  NODE_OPTIONS='--max-old-space-size=1536' pnpm --filter=web build 2>&1 | tail -5

  if ! \$WEB_ONLY; then
    echo "[remote] Building apps/admin"
    NODE_OPTIONS='--max-old-space-size=1536' pnpm --filter=admin build 2>&1 | tail -5 || echo "[remote] admin build failed, continuing"
  fi
fi

# 2.5 Copy static + public into Next.js standalone output (required at runtime)
echo "[remote] Copying static + public into standalone"
for app in web admin; do
  STANDALONE="\$VPS_PATH/apps/\$app/.next/standalone/apps/\$app"
  if [ -d "\$VPS_PATH/apps/\$app/.next/standalone" ]; then
    mkdir -p "\$STANDALONE/.next"
    # rsync --delete so a rebuilt static chunk never leaves stale twins.
    # Falls back to cp if rsync is missing.
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --delete "\$VPS_PATH/apps/\$app/.next/static/" "\$STANDALONE/.next/static/"
      [ -d "\$VPS_PATH/apps/\$app/public" ] && rsync -a --delete "\$VPS_PATH/apps/\$app/public/" "\$STANDALONE/public/" || true
    else
      rm -rf "\$STANDALONE/.next/static" "\$STANDALONE/public"
      cp -r "\$VPS_PATH/apps/\$app/.next/static" "\$STANDALONE/.next/static"
      [ -d "\$VPS_PATH/apps/\$app/public" ] && cp -r "\$VPS_PATH/apps/\$app/public" "\$STANDALONE/public" || true
    fi
  fi
done

# 2.6 Env symlinks for standalone (Next.js reads them from cwd)
echo "[remote] Creating .env symlinks"
sudo ln -sf "\$VPS_PATH/.env" "\$VPS_PATH/apps/web/.env"
sudo ln -sf "\$VPS_PATH/.env" "\$VPS_PATH/apps/admin/.env"

# 2.7 Hand ownership back to the service user
echo "[remote] Chowning back to \$APP_USER:\$APP_GROUP"
sudo chown -R "\$APP_USER":"\$APP_GROUP" "\$VPS_PATH"
sudo chmod 640 "\$VPS_PATH/.env"

# 2.8 Restart services (celery + api first, then web/admin)
echo "[remote] Restarting services"
if ! \$WEB_ONLY; then
  sudo systemctl restart gigapdf-api gigapdf-celery gigapdf-celery-billing
  sleep 2
fi
sudo systemctl restart gigapdf-web gigapdf-admin

# 2.9 Report service states
echo "[remote] Service status:"
for svc in gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing; do
  STATE=\$(sudo systemctl is-active "\$svc" 2>&1 || true)
  echo "  \$svc: \$STATE"
done
REMOTE
)

info "Connecting to ${VPS_USER}@${VPS_HOST}"
ssh -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}" "bash -s" <<EOF || fail "Remote deploy failed"
${REMOTE_SCRIPT}
EOF

# ── 3. Smoke checks ─────────────────────────────────────────────────────────
info "Smoke-testing public endpoints"
FAIL=0
for path in "" "/pdf-worker/pdf.worker.min.mjs" "/login"; do
  url="https://giga-pdf.com${path}"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
  if [[ "$code" =~ ^(200|3[0-9]{2})$ ]]; then
    ok "GET $url → $code"
  else
    warn "GET $url → $code"
    FAIL=$((FAIL + 1))
  fi
done

if [ "$FAIL" -gt 0 ] && $STRICT; then
  fail "$FAIL smoke check(s) failed (--strict)"
fi

ok "Deploy complete."
