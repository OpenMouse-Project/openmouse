# OpenMouse-Support · Discord bot

The Discord ticketing engine for OpenMouse-Support. A standalone Node.js +
[discord.js](https://discord.js.org) v14 process, adapted from the concepts of
[Open Ticket](https://github.com/open-discord-bots/open-ticket), backed by the
OpenMouse **Supabase** project.

It handles the interactive Discord functionality that Cloudflare Pages Functions
cannot (they are short-lived and cannot hold a gateway connection): buttons,
modals, thread creation and ticket lifecycle events. **Discord is the source of
truth for the conversation** — the bot does not mirror messages into Supabase.

## What it does

- Posts the persistent **OpenMouse Support** panel into `#support` with a
  `🎫 Create Ticket` button.
- Opens a **creation modal** (subject, description, category, optional
  device/version/OS info) when the button is clicked.
- Creates a **ticket in Supabase** (concurrency-safe `OM-XXXX` numbering) and a
  **thread inside `#support`**, posts the initial ticket info, and associates
  the user. The thread — and everything said in it — lives in Discord.
- **Automatically reopens** resolved/closed tickets when the user replies, and
  touches the ticket's activity timestamp in Supabase.
- Registers a `/om-support-panel` command to (re)post the panel.

The dashboard's staff replies are posted into the **same existing thread** by the
dashboard Functions using the bot token (see `functions/api/support/*` in the
repo root) — the bot itself does not need to forward dashboard content.

## Requirements

- Node.js ≥ 20
- A Discord application with a bot token
- The OpenMouse Supabase project (schema in `../db/migrations.sql`)

## Discord application setup

1. Create an application at <https://discord.com/developers/applications>.
2. Under **Bot**, copy the token.
3. Invite the bot to the OpenMouse server with permissions in `#support`:
   Send Messages, Create Public Threads, Manage Threads, Read Message History,
   and `MENTION_EVERYONE` not required (mention abuse is blocked).
4. Note the **Client ID** and **Client Secret** (used for the dashboard's OAuth2
   staff login).

## Configuration

Copy `.env.example` → `.env` and fill in the values. Every value is secret and
server-side; never expose it to a browser and never commit `.env`.

```bash
DISCORD_TOKEN=...            # bot token
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_GUILD_ID=...         # the OpenMouse server id
SUPPORT_CHANNEL_ID=...       # the #support channel id
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
STAFF_WHITELIST=...          # comma-separated Discord ids allowed as staff
STAFF_ROLE_ID=               # optional role-id alternative for staff
SUPPORT_PANEL_MESSAGE_ID=    # optional: edit the existing panel on restart
```

## Running

```bash
npm install
npm run build     # compiles TypeScript to dist/
npm start         # node dist/index.js
```

On startup the bot registers the `/om-support-panel` command and (re)posts the
support panel. If you set `SUPPORT_PANEL_MESSAGE_ID`, that existing message is
edited instead of posting a new one (so restarts don't stack duplicate panels).

## Deployment

Run it on an always-on host — a VPS or a container. It must stay connected to
the Discord gateway to receive button/modal/message events. The dashboard lives
elsewhere on Cloudflare Pages, so the bot and dashboard can restart
independently.

## Environment note

The `@supabase/supabase-js` client here is created with the **service-role key**
so the bot can pass RLS (end-user roles are revoked on the support tables).
Never ship this client or key to a browser — this is strictly server-side.
