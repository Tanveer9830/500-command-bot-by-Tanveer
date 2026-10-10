# Security & permission policy

`MADE BY TANVEER | DISCORD: TANVEER5637`

## Global Owner
* One identity only: `IDENTITY.GLOBAL_OWNER_ID = 1131248987173814336` (`src/constants.js`, frozen, not configurable by env, DB or dashboard).
* One check: `authz.isGlobalOwner(userId)` in `src/security/authz.js`; every owner-tier action goes through the executor's `checkAccess`.
* No command, setting, or dashboard route adds, promotes or transfers owners (the `owner` group has none; `tests/policy.test.js` asserts this).
* Owner-tier actions (21): global custom commands (`gcustom`), and `owner` group: maintenance, blacklist/unblacklist/list, presence, stats, leaveguild, botname, auditlog, dbbackup, dbcheck, guilds, register. They work in DMs and are audit-logged.
* The Global Owner does **not** bypass Discord permissions for server-admin actions (a moderator action still needs the Discord permission in that server).

## Custom commands
| Scope | Who can manage | Notes |
|---|---|---|
| Global (`/gcustom`, `!gcustom`) | **Global Owner only** | ephemeral replies, audit-logged, versioned |
| Server (`/custom`, `!cc`) | Members with **Manage Server** | per-server only, versioned (history/rollback/soft-delete), cannot shadow built-in commands |
Custom commands are plain text templates (`{user}`, `{args}`, `{random:a|b}`) sent with mention parsing disabled; they cannot run code.

## Mentions & pings
There are no ping/tag commands (`/pin`, `/tag`, `/notag` or equivalents); `npm run validate` rejects forbidden names. All outgoing messages use `allowedMentions: { parse: [] }` and text echoed from users is neutralised. `automod mentions` is a *protection* (mass-mention threshold), not a ping feature.

## Execution safety
No `eval`, `Function`, `vm`, `child_process` or shell execution in the bot. The `dev` group provides pure local calculators/encoders only.

## Secrets
* Real secrets live only in `/etc/tanveer-prime/tanveer-prime.env` (root, mode 600). `.env*` is git-ignored; `.env.example` has placeholders only and the config loader rejects them.
* The logger redacts configured secret values and token-shaped strings. Tokens are never put on a command line.
* Backups of the database contain server data (not the token) — keep `/var/lib/tanveer-prime/backups` private (mode 750).

## Service hardening
Runs as non-login user; `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, empty capability set, restricted address families, writes only to the data directory.

## Reporting
Open a private security advisory on the GitHub repository, or contact Discord `tanveer5637`.
