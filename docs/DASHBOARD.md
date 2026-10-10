# Dashboard

Optional web UI for server managers. Discord OAuth2 login (`identify guilds` scopes only). `MADE BY TANVEER | DISCORD: TANVEER5637`

## Enable
Installer: answer **y** to "Enable the web dashboard". Or edit the config (`tanveer-prime config`):
```
DASHBOARD_ENABLED="true"
DISCORD_CLIENT_SECRET="…"                  # Developer Portal → OAuth2
DASHBOARD_BASE_URL="https://bot.example.com"
DASHBOARD_PORT="3000"
```
In the Developer Portal → OAuth2 → Redirects add **`<DASHBOARD_BASE_URL>/auth/callback`** (exactly).

## Network exposure
The dashboard binds to `127.0.0.1` and the installer opens **no** firewall port. To reach it from outside, put an HTTPS reverse proxy (Caddy, nginx) in front and set `DASHBOARD_TRUST_PROXY="true"` so secure cookies and client IPs are handled correctly. Example Caddyfile: `bot.example.com { reverse_proxy 127.0.0.1:3000 }`. Cookies get the `Secure` flag when the base URL is `https://`.

## What it can do
Login → list servers you manage (owner, Administrator or Manage Server, **re-checked on every request**) → view overview, edit/reset per-server settings (validated against the same schema as the `/settings` commands), see moderation cases and the audit log. Every dashboard change is written to the audit log with source `dashboard`.

## What it cannot do (by design)
No Global Owner controls, no owner promotion, no global custom commands, no eval/shell. The Global Owner has no extra dashboard rights.

## Security properties
HttpOnly + SameSite=Lax session cookie (signed, stored in SQLite) · OAuth `state` verified · session id regenerated after login · CSRF token + same-origin check on every write · strict CSP, `X-Frame-Options: DENY` · OAuth access tokens are used once, revoked, and never stored · in-memory rate limits · `GET /healthz` returns `{ok:true}` for uptime checks.
