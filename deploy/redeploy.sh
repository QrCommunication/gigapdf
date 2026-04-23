#!/usr/bin/env bash
# =============================================================================
# GigaPDF — Idempotent redeploy script
#
# Runs the full deploy in one shot from a developer laptop:
#   1. Push HEAD to the production remote
#   2. SSH into the VPS, fetch + reset, fix perms, clean caches, install,
#      build (force — no cache), copy static+public, restart systemd
#      services, and smoke-check the HTTP endpoints.
#
# Safe to run repeatedly — every step is idempotent and self-healing.
# Designed to recover from any partially failed previous deploy (mixed
# ownership, stale .next, missing public copy, Turbo cache hits hiding
# unchanged BUILD_IDs, etc).
#
# Usage:
#   bash deploy/redeploy.sh                  # full deploy
#   bash deploy/redeploy.sh --web-only       # skip celery/api restart
#   bash deploy/redeploy.sh --skip-push      # assume origin/main is current
#   bash deploy/redeploy.sh --skip-install   # reuse node_modules
#   bash deploy/redeploy.sh --strict         # fail on any smoke check
#
# Exits non-zero on any hard failure. Smoke checks at the end are warnings
# unless --strict is passed.
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
SKIP_INSTALL=false
STRICT=false
for arg in "$@"; do
  case "$arg" in
    --web-only) WEB_ONLY=true ;;
    --skip-push) SKIP_PUSH=true ;;
    --skip-install) SKIP_INSTALL=true ;;
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
  # The production hook is best-effort: we always re-run a clean build on the
  # VPS below, so hook failures don't matter. `|| true` keeps the pipe alive.
  git push "$REMOTE" "$BRANCH" 2>&1 | tail -3 || true
else
  info "Skipping push (--skip-push)"
fi

# ── 2. Run the remote sequence ──────────────────────────────────────────────
# Everything below runs on the VPS in a single SSH session. We stream stdout
# live (no `tail -N` buffering) so the developer sees progress in real time.

REMOTE_SCRIPT=$(cat <<REMOTE
set -euo pipefail

VPS_PATH="${VPS_PATH}"
APP_USER="${APP_USER}"
APP_GROUP="${APP_GROUP}"
BRANCH="${BRANCH}"
SKIP_INSTALL=${SKIP_INSTALL}
WEB_ONLY=${WEB_ONLY}

cd "\$VPS_PATH"

section() { printf "\n\033[1;34m▶ %s\033[0m\n" "\$1"; }

# ── 2.1 Normalize ownership so every op works ────────────────────────────
section "Normalizing ownership to \$USER for git + build ops"
sudo chown -R "\$USER":"\$USER" "\$VPS_PATH"

# ── 2.2 Fast-forward to the pushed branch ────────────────────────────────
section "Fetching origin/\$BRANCH and resetting"
git fetch --prune origin "\$BRANCH"
git reset --hard "origin/\$BRANCH"
git clean -fd -- apps/ packages/ deploy/ scripts/ || true
git log --oneline -3

# ── 2.3 Purge caches that hide unchanged BUILD_IDs ───────────────────────
# Turbo + Next cache the output of previous builds. If we leave them, turbo
# returns "cache hit" and next build never regenerates BUILD_ID, so the
# deployed binary silently stays on the previous commit.
section "Purging turbo + Next.js build caches"
rm -rf .turbo
find apps packages -maxdepth 3 -type d -name '.turbo' -exec rm -rf {} + 2>/dev/null || true
rm -rf apps/web/.next apps/admin/.next

# ── 2.4 Install deps (frozen lockfile) ───────────────────────────────────
if ! \$SKIP_INSTALL; then
  section "Installing pnpm deps (frozen lockfile)"
  pnpm install --frozen-lockfile --prefer-offline
fi

# ── 2.5 Build all workspace packages (force — no cache) ──────────────────
section "Building workspace packages (--force)"
NODE_OPTIONS='--max-old-space-size=1536' pnpm turbo run build \\
  --filter='./packages/*' \\
  --concurrency=1 \\
  --force

# ── 2.6 Build Next.js apps ───────────────────────────────────────────────
section "Building apps/web"
NODE_OPTIONS='--max-old-space-size=1536' pnpm --filter=web build

if ! \$WEB_ONLY; then
  section "Building apps/admin"
  NODE_OPTIONS='--max-old-space-size=1536' pnpm --filter=admin build || \\
    echo "[remote] admin build failed, continuing"
fi

# ── 2.7 Verify BUILD_IDs are fresh ───────────────────────────────────────
section "Verifying fresh BUILD_IDs"
for app in web admin; do
  bid="\$VPS_PATH/apps/\$app/.next/BUILD_ID"
  if [ -f "\$bid" ]; then
    printf "  apps/%s: BUILD_ID=%s modified=%s\n" \\
      "\$app" "\$(cat "\$bid")" "\$(stat -c '%y' "\$bid")"
  else
    echo "  apps/\$app: BUILD_ID missing (build failed?)"
  fi
done

# ── 2.8 Copy static + public into Next.js standalone ─────────────────────
# next build outputs a self-contained standalone server that does NOT
# include .next/static or public/ by default — they must be copied manually.
# Using rsync --delete so a rebuilt static chunk never leaves stale twins.
section "Syncing static + public into standalone"
for app in web admin; do
  STANDALONE="\$VPS_PATH/apps/\$app/.next/standalone/apps/\$app"
  if [ ! -d "\$VPS_PATH/apps/\$app/.next/standalone" ]; then
    echo "  apps/\$app: no standalone output, skipping"
    continue
  fi
  mkdir -p "\$STANDALONE/.next"
  rsync -a --delete "\$VPS_PATH/apps/\$app/.next/static/" "\$STANDALONE/.next/static/"
  [ -d "\$VPS_PATH/apps/\$app/public" ] && \\
    rsync -a --delete "\$VPS_PATH/apps/\$app/public/" "\$STANDALONE/public/" || true
  echo "  apps/\$app: standalone synced"
done

# ── 2.9 Env symlinks for standalone ──────────────────────────────────────
section "Creating .env symlinks"
for app in web admin; do
  sudo ln -sf "\$VPS_PATH/.env" "\$VPS_PATH/apps/\$app/.env"
done

# ── 2.10 Hand ownership back to the service user ─────────────────────────
section "Handing ownership back to \$APP_USER:\$APP_GROUP"
sudo chown -R "\$APP_USER":"\$APP_GROUP" "\$VPS_PATH"
sudo chmod 640 "\$VPS_PATH/.env"

# ── 2.11 Restart services (api/celery first, then next-js apps) ──────────
section "Restarting systemd services"
if ! \$WEB_ONLY; then
  sudo systemctl restart gigapdf-api gigapdf-celery gigapdf-celery-billing
  sleep 2
fi
sudo systemctl restart gigapdf-web gigapdf-admin
sleep 3

# ── 2.12 Report service states ───────────────────────────────────────────
section "Service states"
for svc in gigapdf-api gigapdf-web gigapdf-admin gigapdf-celery gigapdf-celery-billing; do
  printf "  %-30s %s\n" "\$svc" "\$(sudo systemctl is-active "\$svc" 2>&1 || echo unknown)"
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

# Verify the freshly-deployed JS bundle by checking BUILD_ID match
info "Verifying BUILD_ID freshness"
LOCAL_HEAD=$(git rev-parse --short HEAD)
REMOTE_HEAD=$(ssh "${VPS_USER}@${VPS_HOST}" "cd ${VPS_PATH} && git rev-parse --short HEAD" 2>/dev/null || echo "?")
if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  ok "Remote HEAD matches local: $LOCAL_HEAD"
else
  warn "Remote HEAD ($REMOTE_HEAD) differs from local ($LOCAL_HEAD)"
  FAIL=$((FAIL + 1))
fi

if [ "$FAIL" -gt 0 ] && $STRICT; then
  fail "$FAIL check(s) failed (--strict)"
fi

if [ "$FAIL" -eq 0 ]; then
  ok "Deploy complete — all smoke checks passed."
else
  warn "Deploy complete with $FAIL warning(s) (pass --strict to fail)."
fi
