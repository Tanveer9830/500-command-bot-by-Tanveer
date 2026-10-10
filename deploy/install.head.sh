#!/usr/bin/env bash
# =============================================================================
#  TANVEER PRIME — one-command installer for Ubuntu
#  MADE BY TANVEER | DISCORD: TANVEER5637
#
#    curl -fsSL https://raw.githubusercontent.com/Tanveer9830/500-command-bot-by-Tanveer/main/install.sh | sudo bash
#
#  What it does (in order): checks root, Ubuntu version, CPU architecture, internet and disk space;
#  installs git and Node.js LTS; downloads the bot into /opt/tanveer-prime; runs `npm ci --omit=dev`;
#  asks for your Discord bot token (hidden input); writes a root-only (mode 600) env file; creates a
#  non-root service user; runs database migrations; registers slash commands; creates, enables and
#  starts the systemd service `tanveer-prime`; runs a health check; prints the management commands.
#
#  What it never does: delete a database, print your token, open a firewall port, or run bot code as root.
#  Running it again on an existing install updates it (your data and settings are kept).
#
#  Optional environment overrides: TP_REPO, TP_REF, TP_APP_DIR, TP_DATA_DIR, TP_USER, TP_NODE_MAJOR,
#  TP_RECONFIGURE=1 (ask for credentials again), TP_DRY_RUN=1 (checks only, changes nothing).
#  Non-interactive: provide DISCORD_TOKEN (and optionally DISCORD_CLIENT_SECRET, DEV_GUILD_ID) in the environment.
# =============================================================================
set -Eeuo pipefail
