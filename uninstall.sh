#!/usr/bin/env bash
# =============================================================================
#  TANVEER PRIME — uninstaller           MADE BY TANVEER | DISCORD: TANVEER5637
#  Stops and removes the service, the management command and the program files.
#  It NEVER deletes your database or configuration. Those stay until you remove them yourself.
# =============================================================================
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/deploy/lib.sh"
tp_ui_init
CONF="${TP_CONF_FILE:-/etc/tanveer-prime/install.conf}"
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
TP_APP_DIR="${TP_APP_DIR:-$HERE}"; TP_DATA_DIR="${TP_DATA_DIR:-/var/lib/tanveer-prime}"; TP_SERVICE="${TP_SERVICE:-tanveer-prime}"
TP_ENV_FILE="${TP_ENV_FILE:-/etc/tanveer-prime/tanveer-prime.env}"; TP_UNIT_FILE="${TP_UNIT_FILE:-/etc/systemd/system/${TP_SERVICE}.service}"
TP_BIN="${TP_BIN:-/usr/local/bin/tanveer-prime}"

tp_banner_compact "UNINSTALL"
tp_require_root
if [ "${1:-}" != "--yes" ]; then
  if tp_tty_ok; then read -r -p "Remove the TANVEER PRIME service and program files? Your data in ${TP_DATA_DIR} is kept. [y/N] " a </dev/tty >/dev/tty 2>&1 || a=n
  else a=n; fi
  case "$a" in [Yy]*) ;; *) tp_info "Cancelled. Nothing was changed."; exit 0 ;; esac
fi
systemctl disable --now "$TP_SERVICE" >/dev/null 2>&1 || true
rm -f "$TP_UNIT_FILE"; systemctl daemon-reload || true
rm -f "$TP_BIN"
# Remove program files last (this script lives there); the data directory and env file are deliberately left alone.
tp_ok "Service and command removed."
tp_info "Kept: ${TP_DATA_DIR} (database, backups) and ${TP_ENV_FILE} (configuration, contains your token)."
tp_info "To delete them permanently yourself:  sudo rm -rf ${TP_DATA_DIR} /etc/tanveer-prime"
rm -rf "${TP_APP_DIR:?}" 2>/dev/null || tp_warn "Could not remove ${TP_APP_DIR}; delete it manually."
tp_signature
