# TANVEER PRIME

**A Discord bot with 817 distinct commands, slash + `!` prefix, SQLite, Lavalink music and an OAuth2 dashboard — installed with one command.**

`MADE BY TANVEER | DISCORD: TANVEER5637`

---

## Install (one command, works from a phone)

Open an SSH app (Termius, JuiceSSH…) on your **Ubuntu 22.04+** server, paste this, press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/Tanveer9830/500-command-bot-by-Tanveer/main/install.sh | sudo bash
```

It asks for **one thing**: your bot token (typing is hidden). Everything else is automatic:

1. checks root, Ubuntu version, CPU (x64/arm64), internet and disk space
2. installs git and Node.js 22 LTS (signed NodeSource repository)
3. downloads the bot to `/opt/tanveer-prime` and runs `npm ci --omit=dev`
4. validates your token with Discord and derives the application ID for you
5. writes your secrets to `/etc/tanveer-prime/tanveer-prime.env` (**root-only, mode 600**)
6. creates a non-login service user `tanveer-prime`, runs database migrations, registers the slash commands
7. creates, enables and starts the `tanveer-prime` systemd service, waits for "connected to Discord", and prints the invite link and management commands

It **never** deletes a database, prints your token, or opens a firewall port. Run the same command again later and it detects the install and **updates** instead (database and settings kept).

### Before you run it — 2 minutes in the Developer Portal
1. <https://discord.com/developers/applications> → *New Application* → **Bot** → *Reset Token* → copy it.
2. Same page, **Privileged Gateway Intents**: turn on **Server Members Intent** and **Message Content Intent** (needed for `!` commands, XP, automod, welcome messages).
3. Run the install command and paste the token when asked. Use the invite link it prints to add the bot to your server.

### Manage it
```
tanveer-prime status      # service state
tanveer-prime logs -f     # live log (Ctrl+C to leave)
tanveer-prime restart     # also: start, stop
tanveer-prime update      # safe update: backup → pull → migrate → health check → auto-rollback
tanveer-prime doctor      # diagnostics (never prints secrets)
tanveer-prime backup      # copy the database to /var/lib/tanveer-prime/backups
tanveer-prime config      # edit the root-only settings file, then restart
tanveer-prime invite      # print the invite link
```
Non-interactive install (CI / automation): `curl -fsSL <url> | sudo DISCORD_TOKEN='…' bash`.
Dry run (checks only, changes nothing): `curl -fsSL <url> | sudo TP_DRY_RUN=1 bash`.
Details, troubleshooting and uninstall: [docs/INSTALL.md](docs/INSTALL.md).

---

## Commands

Everything runs through **one shared registry**, so a command behaves identically as `/group sub` and `!group sub`.

| | Count |
|---|---|
| Distinct registered actions (own handler each) | **817** |
| Normal-user actions | **466** |
| Admin-tier actions (330 admin + 21 Global-Owner-only) | **351** |
| Top-level slash commands registered (Discord cap: 100) | **100** (67 grouped + 33 shortcuts) |
| Slash subcommands inside the groups | 817 |
| Aliases (extra routes, **not** counted above) | 112 |

Examples: `/mod ban`, `!ban @user spam`, `/economy daily` (or `/daily`), `/music play`, `!poll create "Pizza?" "yes | no"`, `/math …`, `/text …`, `/automod …`. Type `/help` or `!help` for the category list.

The full, generated inventory (canonical name, aliases, category, admin/user, slash and prefix invocation, permissions, status, slash status, test status) is in **[docs/COMMANDS.md](docs/COMMANDS.md)** (machine-readable: [docs/commands.json](docs/commands.json)). Regenerate with `npm run inventory`; `npm run validate` fails the build if any count, duplicate or forbidden-name rule is violated.

**Honest description of the 817.** Categories include moderation (38), security/automod/anti-raid (59), economy (34 + 30 admin), levels (13 + 25 admin), tickets, polls, giveaways, music (32), community admin (31), and a large utility toolbox — text tools (49), calculators (58), converters, games, random generators, developer tools, lookups. Many admin actions are small configuration toggles (e.g. "set welcome channel"); many utilities are small calculators. They are real, distinct handlers — but not 817 equally heavy features.

### Policies
- **Global Owner** is the single hard-coded ID `1131248987173814336`, checked in one place (`src/security/authz.js`). There is no command or dashboard control to add owners. The owner does **not** bypass Discord permission checks for server-admin actions. Global custom commands (`/gcustom …`) are owner-only; owner actions are audit-logged.
- **Server custom commands** require **Manage Server**, are versioned (history/rollback), and never run code — they are text templates only.
- **No eval, no shell execution** anywhere in the bot.
- **No ping/tag commands.** Every outgoing message uses `allowedMentions: { parse: [] }`; user text is neutralised (`@everyone`/`@here`). There are no `/pin`, `/tag`, `/notag` commands or renamed equivalents (checked by `npm run validate`).
- Details: [docs/SECURITY.md](docs/SECURITY.md).

## Dashboard (optional)
Discord OAuth2 login, per-server settings, cases and audit log. Listens on `127.0.0.1` only; the installer opens **no** port. See [docs/DASHBOARD.md](docs/DASHBOARD.md) for the redirect URL and HTTPS reverse-proxy setup. The dashboard cannot grant or change the Global Owner.

## Music
Uses [Lavalink](https://github.com/lavalink-devs/Lavalink) through Shoukaku. Enter its host/port/password when the installer asks (or edit the config later). Without Lavalink, music commands say music is unavailable; nothing else is affected.

## Development
```bash
git clone https://github.com/Tanveer9830/500-command-bot-by-Tanveer && cd 500-command-bot-by-Tanveer
npm ci
cp .env.example .env      # fill in your own values (git-ignored)
npm run migrate && npm run register && npm start
npm test                  # 890+ tests, no network or Discord needed
```
Layout: `src/commands` (command modules) · `src/core` (registry, executor, argument parsing) · `src/services` · `src/security` · `src/handlers` · `src/dashboard` · `scripts/` · `deploy/` (installer parts; `install.sh` is generated by `node scripts/sync-installer.js`) · `migrations/`.

## Verification status (what was and wasn't actually run)
| Item | Status |
|---|---|
| Automated tests (`npm test`) | **893 tests passing** (registry, executor, every action smoke-run against mocks, economy, moderation, music/lookup with fakes, scheduler, runtime, dashboard, installer) |
| Behavioral tests per action | **see docs/COMMANDS.md** — only actions with dedicated tests are labelled `behavioral`; the rest are `smoke` only |
| `install.sh` / `update.sh` / `uninstall.sh` | Run end-to-end **in a simulation**: real scripts, with `apt-get`, `systemctl`, `useradd`, `npm` etc. replaced by logging stubs and a local fake Discord API; the systemd unit passes `systemd-analyze verify`. **Not yet run on a real Ubuntu VPS.** |
| Live Discord connection, slash registration against Discord, real voice/Lavalink playback | **Not exercised** during development (no token / network access to Discord). The installer's health check reports honestly whether the bot connected. |
| Reboot persistence | Service is `enabled` (starts at boot); reboot **not** tested by me. |

If something fails on your server, run `tanveer-prime doctor` and open an issue with its output (it never prints secrets).

## Known limitations
- The supplied ASCII logo's first glyph is drawn as a "Y" shape, so the art reads "YANVEER". It is kept verbatim as supplied; swapping in a "T" glyph is a one-line change in `src/utils/branding.js` (then run `node scripts/sync-installer.js`).
- Global slash commands can take up to an hour to appear the first time; set a test server ID (`DEV_GUILD_ID`) for instant updates there.
- Economy currency is virtual only (🪙). Nothing involves real money.

## License
MIT — © Tanveer. The creator attribution `MADE BY TANVEER | DISCORD: TANVEER5637` is part of the bot's branding.
