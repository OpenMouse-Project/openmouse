# OpenMouse-Support

The official support and ticket management system for the OpenMouse project.

```
support/
├── bot/                # Discord bot (Node.js + discord.js v14) — the user-facing
│   │                   #   ticketing engine (buttons, modals, threads).
│   ├── src/            #   config, catalog, handlers, repo (Supabase), staff auth
│   ├── .env.example    #   bot environment variables
│   └── README.md       #   setup + running the bot
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

The **dashboard + API** live in the existing OpenMouse web project, not under
`support/`:
- `support-admin.html` → `src/support-admin.tsx` (+ `src/support-admin.css`)
  — the Preact staff dashboard.
- `functions/api/support/*` — the Cloudflare Pages Functions API (Discord OAuth2
  staff auth, tickets, messages, notes, audit, polling).

This is intentional: the dashboard reuses OpenMouse's existing Preact +
Cloudflare Pages + Supabase stack. Only the Discord bot — which requires a
persistent gateway connection — is a separate Node.js process.

## Getting started

1. Apply the schema: run `db/migrations.sql` in Supabase.
2. Set up and run the bot: see `bot/README.md`.
3. Deploy the dashboard/API on Cloudflare Pages and set the Functions env vars
   (see `docs/OPENMOUSE-SUPPORT.md`).

Read `docs/OPENMOUSE-SUPPORT.md` for the full architecture, database, auth and
deployment guide. Never commit real secrets; all secrets are environment
variables kept server-side.
