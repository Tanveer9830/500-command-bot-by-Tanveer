# ---------------------------------------------------------------- settings
TP_REPO="${TP_REPO:-Tanveer9830/500-command-bot-by-Tanveer}"
TP_REPO_URL="${TP_REPO_URL:-https://github.com/${TP_REPO}.git}"
TP_REF="${TP_REF:-main}"
TP_APP_DIR="${TP_APP_DIR:-/opt/tanveer-prime}"
TP_DATA_DIR="${TP_DATA_DIR:-/var/lib/tanveer-prime}"
TP_USER="${TP_USER:-tanveer-prime}"
TP_SERVICE="${TP_SERVICE:-tanveer-prime}"
TP_CONF_DIR="${TP_CONF_DIR:-/etc/tanveer-prime}"
TP_ENV_FILE="${TP_ENV_FILE:-${TP_CONF_DIR}/tanveer-prime.env}"
TP_UNIT_FILE="${TP_UNIT_FILE:-/etc/systemd/system/${TP_SERVICE}.service}"
TP_BIN="${TP_BIN:-/usr/local/bin/tanveer-prime}"
TP_NODE_MAJOR="${TP_NODE_MAJOR:-22}"
TP_DISCORD_API="${TP_DISCORD_API:-https://discord.com/api/v10}"
TP_MIN_DISK_MB="${TP_MIN_DISK_MB:-700}"
# Bot permissions used in the invite link (moderation, roles, channels, messages, voice). Not Administrator.
TP_INVITE_PERMS="${TP_INVITE_PERMS:-1100454685783}"
TP_DRY_RUN="${TP_DRY_RUN:-0}"

# ---------------------------------------------------------------- steps
check_system() {
  tp_step "1/9  Checking your system"
  [ "$TP_DRY_RUN" = "1" ] || tp_require_root
  [ "$(uname -s)" = "Linux" ] || tp_die "This installer supports Linux (Ubuntu) only."

  local id="" ver="" name=""
  if [ -r /etc/os-release ]; then id=$(. /etc/os-release; echo "${ID:-}"); ver=$(. /etc/os-release; echo "${VERSION_ID:-}"); name=$(. /etc/os-release; echo "${PRETTY_NAME:-}"); fi
  TP_OS_ID="$id"
  if [ "$id" = "ubuntu" ]; then
    local major="${ver%%.*}"
    case "$major" in ''|*[!0-9]*) tp_die "Could not read the Ubuntu version (${ver:-unknown})." ;; esac
    [ "$major" -ge 22 ] || tp_die "Ubuntu ${ver} is too old. Ubuntu 22.04 or newer is required."
    tp_ok "OS: ${name:-Ubuntu $ver}"
  elif [ "$id" = "debian" ]; then
    tp_warn "Debian detected (${ver}). The installer is written for Ubuntu; continuing, but this is untested."
  else
    tp_die "Unsupported OS '${id:-unknown}'. This installer supports Ubuntu 22.04+."
  fi

  local arch; arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) TP_ARCH=x64 ;;
    aarch64|arm64) TP_ARCH=arm64 ;;
    *) tp_die "Unsupported CPU architecture '${arch}'. Supported: x86_64 (amd64) and aarch64 (arm64)." ;;
  esac
  tp_ok "Architecture: ${arch} (${TP_ARCH})"

  tp_have systemctl || tp_die "systemd is required (systemctl not found)."
  tp_have curl || { [ "$TP_DRY_RUN" = "1" ] && tp_warn "curl is missing (it would be installed)" || true; }

  if tp_have curl; then
    curl -fsS --max-time 15 -o /dev/null https://github.com 2>/dev/null || tp_die "No internet access to github.com. Check your network/DNS and try again."
    curl -fsS --max-time 15 -o /dev/null https://registry.npmjs.org/ 2>/dev/null || tp_die "Cannot reach registry.npmjs.org (needed to install dependencies)."
    tp_ok "Internet: github.com and the npm registry are reachable"
  fi

  local probe="$TP_APP_DIR"; while [ ! -d "$probe" ] && [ "$probe" != "/" ]; do probe=$(dirname "$probe"); done
  local free_mb; free_mb=$(df -Pm "$probe" | awk 'NR==2 {print $4}')
  case "$free_mb" in ''|*[!0-9]*) tp_warn "Could not determine free disk space; continuing." ;;
    *) [ "$free_mb" -ge "$TP_MIN_DISK_MB" ] || tp_die "Only ${free_mb} MB free on ${probe}; at least ${TP_MIN_DISK_MB} MB is needed."; tp_ok "Disk space: ${free_mb} MB free" ;;
  esac
}

detect_existing() {
  if [ -d "$TP_APP_DIR/.git" ] && [ -f "$TP_UNIT_FILE" ] && [ -f "$TP_ENV_FILE" ] && [ "${TP_RECONFIGURE:-0}" != "1" ]; then
    tp_step "Existing installation found"
    tp_info "Found TANVEER PRIME at ${TP_APP_DIR}. Switching to the safe updater (your database and settings are kept)."
    if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would run ${TP_APP_DIR}/update.sh"; exit 0; fi
    exec bash "$TP_APP_DIR/update.sh"
  fi
}

install_packages() {
  tp_step "2/9  Installing system packages"
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would install ca-certificates curl git gnupg openssl and Node.js ${TP_NODE_MAJOR} (NodeSource)"; return; fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y </dev/null >/dev/null || tp_die "apt-get update failed."
  apt-get install -y --no-install-recommends ca-certificates curl git gnupg openssl </dev/null >/dev/null || tp_die "Could not install base packages."
  tp_ok "git, curl and certificates are installed"

  local have=0
  if tp_have node; then local v; v=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0); [ "$v" -ge 22 ] && have=1; fi
  if [ "$have" = 1 ] && tp_have npm; then
    tp_ok "Node.js $(node -v) is already installed"
  else
    tp_info "Installing Node.js ${TP_NODE_MAJOR}.x LTS from NodeSource (signed apt repository)"
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg || tp_die "Could not download the NodeSource signing key."
    chmod 0644 /etc/apt/keyrings/nodesource.gpg
    printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "$TP_NODE_MAJOR" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y </dev/null >/dev/null || tp_die "apt-get update failed after adding NodeSource."
    apt-get install -y nodejs </dev/null >/dev/null || tp_die "Could not install Node.js."
    tp_ok "Node.js $(node -v) installed"
  fi
}

create_user() {
  tp_step "3/9  Creating the service user"
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would create system user '${TP_USER}' (no login shell) with data in ${TP_DATA_DIR}"; return; fi
  if id "$TP_USER" >/dev/null 2>&1; then tp_ok "User '${TP_USER}' already exists"
  else
    useradd --system --home-dir "$TP_DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$TP_USER" || tp_die "Could not create user ${TP_USER}."
    tp_ok "Created system user '${TP_USER}' (cannot log in)"
  fi
  install -d -m 0750 -o "$TP_USER" -g "$TP_USER" "$TP_DATA_DIR"
}

fetch_source() {
  tp_step "4/9  Downloading TANVEER PRIME"
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would clone ${TP_REPO_URL} (${TP_REF}) into ${TP_APP_DIR}"; return; fi
  if [ -d "$TP_APP_DIR/.git" ]; then
    tp_info "Source already present; fetching the latest ${TP_REF}"
    git -C "$TP_APP_DIR" fetch origin "$TP_REF" </dev/null || tp_die "git fetch failed."
    git -C "$TP_APP_DIR" merge --ff-only FETCH_HEAD </dev/null >/dev/null || tp_die "Could not fast-forward ${TP_APP_DIR}. Resolve local changes there, or move the folder aside (your data is in ${TP_DATA_DIR})."
  elif [ -e "$TP_APP_DIR" ] && [ -n "$(ls -A "$TP_APP_DIR" 2>/dev/null)" ]; then
    tp_die "${TP_APP_DIR} exists and is not a TANVEER PRIME checkout. Move it away or set TP_APP_DIR."
  else
    mkdir -p "$(dirname "$TP_APP_DIR")"
    git clone --depth 1 --branch "$TP_REF" "$TP_REPO_URL" "$TP_APP_DIR" </dev/null || tp_die "git clone failed."
  fi
  chown -R root:root "$TP_APP_DIR" 2>/dev/null || true   # code is root-owned: the bot cannot rewrite itself
  tp_ok "Source ready: $(git -C "$TP_APP_DIR" log -1 --format='%h %s' 2>/dev/null | cut -c1-70)"
}

install_deps() {
  tp_step "5/9  Installing dependencies (npm ci --omit=dev)"
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would run npm ci --omit=dev in ${TP_APP_DIR}"; return; fi
  cd "$TP_APP_DIR"
  export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
  if ! npm ci --omit=dev </dev/null; then
    tp_warn "npm ci failed; installing build tools (needed if a prebuilt SQLite binary is unavailable) and retrying once"
    apt-get install -y --no-install-recommends build-essential python3 </dev/null >/dev/null || tp_die "Could not install build tools."
    npm ci --omit=dev </dev/null || tp_die "npm ci failed. See the messages above."
  fi
  tp_ok "Dependencies installed"
}

# ---------------------------------------------------------------- credentials
tp_prompt() { # tp_prompt <var> <prompt> [default]
  local __v="$1" msg="$2" def="${3:-}" ans=""
  if [ -n "$def" ]; then msg="$msg [$def]"; fi
  IFS= read -r -p "$msg: " ans </dev/tty >/dev/tty 2>&1 || ans=""
  [ -z "$ans" ] && ans="$def"
  printf -v "$__v" '%s' "$ans"
}
tp_prompt_secret() { # tp_prompt_secret <var> <prompt>
  local __v="$1" ans=""
  IFS= read -r -s -p "$2: " ans </dev/tty >/dev/tty 2>&1 || ans=""
  echo >/dev/tty
  printf -v "$__v" '%s' "$ans"
}

# Prints "id|username" on success. Return 0 ok, 1 rejected token, 2 network trouble. The token never appears in `ps`.
discord_check_token() {
  local tmp code; tmp=$(mktemp)
  code=$(printf 'header = "Authorization: Bot %s"\n' "$1" | curl -sS -K - -o "$tmp" -w '%{http_code}' --max-time 15 "${TP_DISCORD_API}/users/@me" 2>/dev/null) || { rm -f "$tmp"; return 2; }
  case "$code" in
    200) node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.id+"|"+j.username)' "$tmp" 2>/dev/null; local rc=$?; rm -f "$tmp"; return $rc ;;
    401|403) rm -f "$tmp"; return 1 ;;
    *) rm -f "$tmp"; return 2 ;;
  esac
}

env_quote() { local v="$1"; v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; printf '"%s"' "$v"; }
env_line() { printf '%s=%s\n' "$1" "$(env_quote "$2")"; }

collect_config() {
  tp_step "6/9  Configuration"
  if [ -f "$TP_ENV_FILE" ] && [ "${TP_RECONFIGURE:-0}" != "1" ]; then
    tp_ok "Keeping your existing configuration (${TP_ENV_FILE}); set TP_RECONFIGURE=1 to change it"
    TP_CLIENT_ID=$(tp_env_get "$TP_ENV_FILE" DISCORD_CLIENT_ID || true)
    TP_DASH_ENABLED=$(tp_env_get "$TP_ENV_FILE" DASHBOARD_ENABLED || echo false)
    return
  fi
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would ask for the Discord bot token (hidden) and write ${TP_ENV_FILE} with mode 600"; return; fi

  local token="${DISCORD_TOKEN:-}" secret="${DISCORD_CLIENT_SECRET:-}" dev_guild="${DEV_GUILD_ID:-}" client_id="${DISCORD_CLIENT_ID:-}"
  local interactive=0; tp_tty_ok && interactive=1
  if [ -z "$token" ] && [ "$interactive" = 0 ]; then
    tp_die "No terminal to ask for the bot token. Re-run with the token in the environment, e.g.:  curl -fsSL <url> | sudo DISCORD_TOKEN='...' bash"
  fi

  if [ "$interactive" = 1 ] && [ -z "$token" ]; then
    {
      echo
      echo "  You need a Discord bot token. In the Discord Developer Portal (discord.com/developers/applications):"
      echo "    1. Bot tab → Reset Token → copy it.      2. Bot tab → turn ON 'Server Members Intent' and 'Message Content Intent'."
      echo "  Paste the token below. Your input is hidden and is stored only in ${TP_ENV_FILE} (root-only, mode 600)."
      echo
    } >/dev/tty
  fi

  local attempt=0 info=""
  while :; do
    if [ -z "$token" ]; then tp_prompt_secret token "Discord bot token"; fi
    token=$(printf '%s' "$token" | tr -d '[:space:]')
    if ! printf '%s' "$token" | grep -Eq '^[A-Za-z0-9._-]{50,120}$'; then
      attempt=$((attempt + 1)); tp_err "That does not look like a bot token."; token=""
      [ "$interactive" = 1 ] && [ "$attempt" -lt 3 ] || tp_die "A valid DISCORD_TOKEN is required."
      continue
    fi
    local rc=0; info=$(discord_check_token "$token") || rc=$?
    if [ "$rc" = 0 ]; then tp_ok "Discord accepted the token (bot user: ${info#*|})"; break; fi
    if [ "$rc" = 2 ]; then tp_warn "Could not reach Discord to verify the token; continuing without verification."; info=""; break; fi
    attempt=$((attempt + 1)); tp_err "Discord rejected that token."; token=""
    [ "$interactive" = 1 ] && [ "$attempt" -lt 3 ] || tp_die "The bot token was rejected."
  done
  if [ -n "$info" ]; then client_id="${info%%|*}"
  elif [ -z "$client_id" ] && [ "$interactive" = 1 ]; then tp_prompt client_id "Application (client) ID"; fi
  printf '%s' "$client_id" | grep -Eq '^[0-9]{15,25}$' || tp_die "DISCORD_CLIENT_ID must be the numeric application ID."
  TP_CLIENT_ID="$client_id"

  local dash=false dash_url="" dash_port=3000 ll_host="" ll_port=2333 ll_pass="" ll_secure=false
  if [ "$interactive" = 1 ]; then
    local a=""; tp_prompt a "Enable the web dashboard? It only listens on this machine until you add an HTTPS proxy (y/N)" "N"
    case "$a" in [Yy]*) dash=true
      [ -n "$secret" ] || tp_prompt_secret secret "Discord OAuth2 client secret (Developer Portal → OAuth2)"
      tp_prompt dash_port "Dashboard port" "3000"
      tp_prompt dash_url "Public dashboard URL (must match the OAuth2 redirect: <URL>/auth/callback)" "http://localhost:${dash_port}" ;;
    esac
    tp_prompt a "Use a Lavalink server for music? (y/N)" "N"
    case "$a" in [Yy]*) tp_prompt ll_host "Lavalink host"; tp_prompt ll_port "Lavalink port" "2333"; tp_prompt_secret ll_pass "Lavalink password"; tp_prompt a "Lavalink uses TLS? (y/N)" "N"; case "$a" in [Yy]*) ll_secure=true ;; esac ;; esac
    [ -n "$dev_guild" ] || tp_prompt dev_guild "Test server ID for instant slash-command updates (optional, press Enter to skip)" ""
  elif [ -n "$secret" ]; then dash=true; dash_url="${DASHBOARD_BASE_URL:-http://localhost:3000}"
  fi
  printf '%s' "$dash_port" | grep -Eq '^[0-9]{1,5}$' || tp_die "Invalid dashboard port."
  [ -z "$dev_guild" ] || printf '%s' "$dev_guild" | grep -Eq '^[0-9]{15,25}$' || tp_die "The test server ID must be numeric."
  [ -n "$dash_url" ] || dash_url="http://localhost:${dash_port}"
  TP_DASH_ENABLED="$dash"; TP_DASH_PORT="$dash_port"

  local session; session=$(openssl rand -hex 32)
  install -d -m 0750 -o root -g root "$TP_CONF_DIR"
  local tmp; tmp=$(umask 077; mktemp "${TP_CONF_DIR}/.env.XXXXXX")
  {
    echo "# TANVEER PRIME configuration — secrets inside. Root-only (mode 600). MADE BY TANVEER | DISCORD: TANVEER5637"
    env_line NODE_ENV production
    env_line DISCORD_TOKEN "$token"
    env_line DISCORD_CLIENT_ID "$client_id"
    [ -z "$secret" ] || env_line DISCORD_CLIENT_SECRET "$secret"
    [ -z "$dev_guild" ] || env_line DEV_GUILD_ID "$dev_guild"
    env_line DATA_DIR "$TP_DATA_DIR"
    env_line LOG_LEVEL info
    env_line ENABLE_MESSAGE_CONTENT true
    env_line ENABLE_GUILD_MEMBERS true
    env_line DASHBOARD_ENABLED "$dash"
    env_line DASHBOARD_HOST 127.0.0.1
    env_line DASHBOARD_PORT "$dash_port"
    env_line DASHBOARD_BASE_URL "$dash_url"
    env_line SESSION_SECRET "$session"
    if [ -n "$ll_host" ]; then env_line LAVALINK_HOST "$ll_host"; env_line LAVALINK_PORT "$ll_port"; env_line LAVALINK_PASSWORD "$ll_pass"; env_line LAVALINK_SECURE "$ll_secure"; fi
  } > "$tmp"
  chown root:root "$tmp" 2>/dev/null || true
  chmod 600 "$tmp"; mv -f "$tmp" "$TP_ENV_FILE"
  tp_ok "Wrote ${TP_ENV_FILE} (mode 600, root-only). The token is not shown anywhere."
  token=""; secret=""; ll_pass=""
}

# Management scripts run as root against the real env file, then DB ownership is handed back to the service user.
run_app_script() { ( cd "$TP_APP_DIR" && TP_ENV_FILE="$TP_ENV_FILE" DATA_DIR="$TP_DATA_DIR" node "$@" </dev/null ); }
fix_ownership() { chown -R "$TP_USER:$TP_USER" "$TP_DATA_DIR" 2>/dev/null || true; chmod 750 "$TP_DATA_DIR" 2>/dev/null || true; }

prepare_database() {
  tp_step "7/9  Database and slash commands"
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would run migrations and register slash commands"; return; fi
  run_app_script scripts/migrate.js || tp_die "Database migration failed. Your data is untouched; see the error above."
  fix_ownership
  if run_app_script scripts/register-commands.js; then :; else
    tp_warn "Slash command registration failed now. The bot retries at every start; you can also run: tanveer-prime register"
  fi
}

write_service() {
  tp_step "8/9  Creating the systemd service"
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would write ${TP_UNIT_FILE}, enable and start ${TP_SERVICE}"; return; fi
  local node_bin; node_bin=$(command -v node)
  sed -e "s|@APP_DIR@|${TP_APP_DIR}|g" -e "s|@DATA_DIR@|${TP_DATA_DIR}|g" -e "s|@ENV_FILE@|${TP_ENV_FILE}|g" -e "s|@USER@|${TP_USER}|g" -e "s|@NODE@|${node_bin}|g" \
    "$TP_APP_DIR/deploy/tanveer-prime.service" > "$TP_UNIT_FILE"
  chmod 644 "$TP_UNIT_FILE"
  install -m 0755 "$TP_APP_DIR/deploy/tanveer-prime-ctl" "$TP_BIN"
  umask 022; install -d -m 0755 "$TP_CONF_DIR"
  { echo "# Written by the installer; read by the 'tanveer-prime' command."; echo "TP_APP_DIR=${TP_APP_DIR}"; echo "TP_DATA_DIR=${TP_DATA_DIR}"; echo "TP_USER=${TP_USER}"; echo "TP_SERVICE=${TP_SERVICE}"; echo "TP_ENV_FILE=${TP_ENV_FILE}"; echo "TP_CLIENT_ID=${TP_CLIENT_ID:-}"; echo "TP_INVITE_PERMS=${TP_INVITE_PERMS}"; } > "${TP_CONF_DIR}/install.conf"
  systemctl daemon-reload
  systemctl enable "$TP_SERVICE" >/dev/null 2>&1 || tp_die "Could not enable the service."
  TP_START_TS=$(date '+%Y-%m-%d %H:%M:%S')
  systemctl restart "$TP_SERVICE" || tp_die "Could not start the service. See: journalctl -u ${TP_SERVICE} -n 50"
  tp_ok "Service '${TP_SERVICE}' created, enabled for boot and started"
}

health_check() {
  tp_step "9/9  Health check"
  if [ "$TP_DRY_RUN" = "1" ]; then tp_info "Dry run: would wait for the bot to connect to Discord"; return; fi
  tp_info "Waiting for the bot to connect (up to 60 seconds)…"
  local rc=0; tp_wait_connected "$TP_SERVICE" 60 "$TP_START_TS" || rc=$?
  case "$rc" in
    0) TP_HEALTH="connected"; tp_ok "The bot is running and connected to Discord" ;;
    2) TP_HEALTH="starting"; tp_warn "The service is running but has not reported a Discord connection yet. Check: tanveer-prime logs" ;;
    *) TP_HEALTH="failed"; tp_err "The service is not staying up. Last log lines:"; tp_log_tail "$TP_SERVICE" 25
       tp_err "Fix the problem (most often a wrong token or disabled intents), then run: tanveer-prime restart" ;;
  esac
}

final_report() {
  [ "$TP_DRY_RUN" = "1" ] && { tp_banner_compact "DRY RUN COMPLETE — nothing was changed"; return; }
  tp_banner_full
  echo
  if [ "${TP_HEALTH:-}" = "connected" ]; then tp_ok "TANVEER PRIME is installed, running and connected."; else tp_warn "TANVEER PRIME is installed, but is NOT confirmed connected yet (status: ${TP_HEALTH:-unknown})."; fi
  echo
  echo "  Invite the bot to a server:"
  echo "    https://discord.com/oauth2/authorize?client_id=${TP_CLIENT_ID:-YOUR_CLIENT_ID}&scope=bot%20applications.commands&permissions=${TP_INVITE_PERMS}"
  echo
  echo "  Manage it from anywhere:"
  echo "    tanveer-prime status      show service state"
  echo "    tanveer-prime logs        follow the live log   (Ctrl+C to stop)"
  echo "    tanveer-prime restart     restart the bot"
  echo "    tanveer-prime update      safe update (backup first, rollback on failure)"
  echo "    tanveer-prime doctor      run diagnostics"
  echo "    tanveer-prime backup      copy the database to ${TP_DATA_DIR}/backups"
  echo "    tanveer-prime config      edit settings (root-only file)"
  echo
  echo "  The bot starts automatically after a reboot (systemd: enabled). I have not rebooted this machine to prove it."
  if [ "${TP_DASH_ENABLED:-false}" = "true" ]; then
    echo "  Dashboard: listening on 127.0.0.1:${TP_DASH_PORT:-3000} only. I did NOT open any firewall port; put an HTTPS reverse proxy in front (docs/DASHBOARD.md)."
  fi
  echo "  Discord intents: enable 'Server Members' and 'Message Content' in the Developer Portal, or prefix commands/XP/automod will not work."
  echo
  tp_signature
}

main() {
  tp_ui_init
  tp_banner_full
  check_system
  detect_existing
  install_packages
  create_user
  fetch_source
  install_deps
  collect_config
  prepare_database
  write_service
  health_check
  final_report
  [ "${TP_HEALTH:-connected}" = "failed" ] && exit 1
  exit 0
}

main "$@"
