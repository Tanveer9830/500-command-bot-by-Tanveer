# Installing TANVEER PRIME

`MADE BY TANVEER | DISCORD: TANVEER5637`

## One command
```bash
curl -fsSL https://raw.githubusercontent.com/Tanveer9830/500-command-bot-by-Tanveer/main/install.sh | sudo bash
```
Requirements: Ubuntu 22.04+ (Debian works but is untested), x86-64 or arm64, systemd, root (`sudo`), outbound internet, ~700 MB free disk.

The script reads prompts from your terminal (`/dev/tty`), so it works even though the script itself arrives through a pipe. When there is no terminal (automation), pass the token in the environment:

```bash
curl -fsSL <url> | sudo DISCORD_TOKEN='...' bash        # optional: DISCORD_CLIENT_SECRET, DEV_GUILD_ID
```

### What gets created
| Path | Purpose | Owner / mode |
|---|---|---|
| `/opt/tanveer-prime` | program files (git checkout) | root — the bot cannot rewrite its own code |
| `/etc/tanveer-prime/tanveer-prime.env` | **secrets** (token, session secret…) | root:root `600` |
| `/etc/tanveer-prime/install.conf` | paths used by the `tanveer-prime` command (no secrets) | root `644` |
| `/var/lib/tanveer-prime` | SQLite database + backups | `tanveer-prime` user `750` |
| `/etc/systemd/system/tanveer-prime.service` | hardened service (`NoNewPrivileges`, `ProtectSystem=strict`, writes only to the data dir) | root |
| `/usr/local/bin/tanveer-prime` | management command | root |

The service runs as the non-login user `tanveer-prime`. Exit code 78 (bad configuration) is not restarted in a loop — fix the file and run `tanveer-prime restart`.

### Overrides (environment variables)
`TP_REF` (branch/tag, default `main`) · `TP_REPO` / `TP_REPO_URL` (use a fork) · `TP_APP_DIR` · `TP_DATA_DIR` · `TP_USER` · `TP_NODE_MAJOR` (default 22) · `TP_RECONFIGURE=1` (ask for credentials again; a rejected token never overwrites a working config) · `TP_DRY_RUN=1` (checks only).

### Never does
Delete a database · print the token (it is sent to Discord through a curl config on stdin, never in `ps`) · open firewall ports · run the bot as root.

## Updating
`tanveer-prime update` (or re-run the install command). Steps: refuse if you edited files in `/opt/tanveer-prime` (set `TP_FORCE=1` to stash them) → database backup → `git fetch` → fast-forward only → `npm ci` → validate commands → migrate (migrations are transactional and take their own backup) → register slash commands → restart → wait for "connected to Discord". If any step fails the code and dependencies are rolled back, the old version is restarted, and the backup path is printed.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Discord rejected that token" | Reset the token in the Developer Portal → Bot and paste the new one |
| Service running but never "connected" | `tanveer-prime logs`; usually disabled **Message Content / Server Members** intents (Portal → Bot) |
| Slash commands missing | Global commands can take up to an hour; set `DEV_GUILD_ID` (`tanveer-prime config`) then `tanveer-prime register` |
| `npm ci` fails | The installer retries once after installing build tools; send the printed error |
| Music says unavailable | Configure `LAVALINK_*` (`tanveer-prime config`); the rest of the bot is unaffected |
| Anything else | `tanveer-prime doctor` (never prints secrets) |

## Uninstall
`tanveer-prime uninstall` stops and removes the service, command and program files. It **keeps** `/var/lib/tanveer-prime` (database) and `/etc/tanveer-prime` (config). To erase those yourself: `sudo rm -rf /var/lib/tanveer-prime /etc/tanveer-prime`.

## How the installer is built
`install.sh` is generated: `deploy/install.head.sh` + `deploy/lib.sh` (the logo/panel block is generated from `src/utils/branding.js`) + `deploy/install.body.sh`. After editing any of those run `node scripts/sync-installer.js`; the test-suite fails if `install.sh` is stale.
