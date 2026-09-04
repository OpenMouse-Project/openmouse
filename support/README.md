# OpenMouse-Support

The official support and ticket management system for the OpenMouse project.

```
support/
├── bot/                # Reference ONLY — the original gateway-based Discord bot
│   │                   #   (Node.js + discord.js v14). No longer run: the same
│   │                   #   flow now runs on Cloudflare as an HTTP interactions
│   │                   #   endpoint (see functions/api/support/interactions.js).
│   ├── src/            #   config, catalog, handlers, repo (Supabase), staff auth
│   ├── .env.example    #   (obsolete — see Functions env vars)
│   └── README.md       #   archived setup/running notes
├── db/                 # Supabase schema (structured metadata + state)
│   └── migrations.sql
└── docs/               # Architecture & integration documentation
    └── OPENMOUSE-SUPPORT.md
```

**Source of truth:** Discord owns ticket **conversations** (threads, messages,
authors, timestamps, attachments, history). Supabase holds only **structured
metadata and state** — ticket records, the ticket-number ↔ thread mapping,
status/priority/assignment, internal notes, the outbox and the audit log. The
dashboard reads the live conversation from Discord and staff replies post back
into the same thread; no second copy of the conversation is stored.

**Everything runs on Cloudflare Pages Functions** — including the Discord-facing
surface. The user-facing ticket creation flow (support panel button → modal →
thread) is an **HTTP interactions endpoint** (`functions/api/support/interactions.js`);
Discord delivers button clicks / modal submits / slash commands as signed POST
webhooks, so no persistent gateway process is needed. `support/bot/` is kept only
as reference.

The **dashboard + API** live in the existing OpenMouse web project, not under
`support/`:
- `support-admin.html` → `src/support-admin.tsx` (+ `src/support-admin.css`)
  — the Preact staff dashboard.
- `functions/api/support/*` — the Cloudflare Pages Functions API (Discord OAuth2
  staff auth, tickets, messages, notes, audit, polling, interactions).

## Getting started

1. Apply the schema: run `db/migrations.sql` in Supabase.
2. Deploy the dashboard/API + interactions endpoint on Cloudflare Pages and set
   the Functions env vars (see `docs/OPENMOUSE-SUPPORT.md`).
3. Point the Discord app's **Interactions Endpoint URL** at
   `<SUPPORT_BASE_URL>/api/support/interactions` and register the
   `/om-support-panel` slash command to post the panel.

Read `docs/OPENMOUSE-SUPPORT.md` for the full architecture, database, auth and
deployment guide. Never commit real secrets; all secrets are environment
variables kept server-side.
