#!/usr/bin/env bash
# =============================================================================
#  TANVEER PRIME — safe updater          MADE BY TANVEER | DISCORD: TANVEER5637
#  Order: backup database → fetch → fast-forward only → npm ci → migrate (auto-backup) → validate →
#         register slash commands → restart → health check. Any failure rolls the code back to the
#         previous commit and restarts the old version. The database is never deleted.
#  Run:  tanveer-prime update    (or: sudo bash /opt/tanveer-prime/update.sh)
#  Env:  TP_REF (branch, default main), TP_FORCE=1 (stash local changes in the app folder first)
# =============================================================================
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/deploy/lib.sh"
tp_ui_init

CONF="${TP_CONF_FILE:-/etc/tanveer-prime/install.conf}"
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
TP_APP_DIR="${TP_APP_DIR:-$HERE}"; TP_DATA_DIR="${TP_DATA_DIR:-/var/lib/tanveer-prime}"; TP_USER="${TP_USER:-tanveer-prime}"
TP_SERVICE="${TP_SERVICE:-tanveer-prime}"; TP_ENV_FILE="${TP_ENV_FILE:-/etc/tanveer-prime/tanveer-prime.env}"; TP_REF="${TP_REF:-main}"

run_app() { ( cd "$TP_APP_DIR" && TP_ENV_FILE="$TP_ENV_FILE" DATA_DIR="$TP_DATA_DIR" node "$@" </dev/null ); }
fix_ownership() { chown -R "$TP_USER:$TP_USER" "$TP_DATA_DIR" 2>/dev/null || true; }

tp_banner_compact "UPDATE"
tp_require_root
[ -d "$TP_APP_DIR/.git" ] || tp_die "${TP_APP_DIR} is not a git checkout; cannot update."
[ -f "$TP_ENV_FILE" ] || tp_die "Configuration ${TP_ENV_FILE} not found. Run the installer first."
cd "$TP_APP_DIR"

tp_step "Checking for local changes"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  if [ "${TP_FORCE:-0}" = "1" ]; then git stash push -m "tanveer-prime-update-$(date +%s)" >/dev/null; tp_warn "Local changes were stashed (git stash list)."
  else tp_die "Local changes found in ${TP_APP_DIR}. Re-run with TP_FORCE=1 to stash them (they are kept, not deleted)."; fi
fi

PREV=$(git rev-parse HEAD)
tp_step "Backing up the database"
run_app scripts/backup.js || tp_warn "Database backup failed (continuing: migrations take their own backup first)."
fix_ownership

tp_step "Fetching ${TP_REF}"
git fetch origin "$TP_REF" </dev/null || tp_die "git fetch failed. Nothing was changed."
NEW=$(git rev-parse FETCH_HEAD)
if [ "$NEW" = "$PREV" ]; then tp_ok "Already up to date ($(git rev-parse --short HEAD))."; exit 0; fi
tp_info "Updating $(git rev-parse --short "$PREV") → $(git rev-parse --short "$NEW")"

rollback() {
  tp_err "Update failed: $1"
  tp_info "Rolling back to $(git rev-parse --short "$PREV")…"
  git reset --hard "$PREV" >/dev/null 2>&1 || true
  ( export npm_config_audit=false npm_config_fund=false; npm ci --omit=dev </dev/null >/dev/null 2>&1 ) || tp_warn "npm ci during rollback failed."
  systemctl restart "$TP_SERVICE" || true
  tp_warn "The previous version was restored. If a migration had already run, your pre-update database copy is in ${TP_DATA_DIR}/backups."
  exit 1
}

git merge-base --is-ancestor HEAD FETCH_HEAD || rollback "the new version is not a fast-forward of your checkout"
git merge --ff-only FETCH_HEAD </dev/null >/dev/null 2>&1 || rollback "the new version is not a fast-forward of your checkout"
tp_step "Installing dependencies"
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
npm ci --omit=dev </dev/null || rollback "npm ci failed"
tp_step "Validating"
run_app scripts/validate-commands.js || rollback "command registry validation failed"
tp_step "Migrating database"
run_app scripts/migrate.js || rollback "database migration failed"
fix_ownership
tp_step "Registering slash commands"
run_app scripts/register-commands.js || tp_warn "Slash registration failed; the bot retries at start."
tp_step "Restarting"
SINCE=$(date '+%Y-%m-%d %H:%M:%S')
systemctl restart "$TP_SERVICE" || rollback "the service would not restart"
rc=0; tp_wait_connected "$TP_SERVICE" 60 "$SINCE" || rc=$?
case "$rc" in
  0) tp_ok "Updated to $(git rev-parse --short HEAD) and connected to Discord." ;;
  1) tp_log_tail "$TP_SERVICE" 20; rollback "the new version did not stay running" ;;
  *) tp_warn "Updated, and the service is running, but a Discord connection was not confirmed within 60s. Check: tanveer-prime logs" ;;
esac
tp_step "What changed"
git log --oneline "$PREV..HEAD" 2>/dev/null | head -15 || true
tp_signature
