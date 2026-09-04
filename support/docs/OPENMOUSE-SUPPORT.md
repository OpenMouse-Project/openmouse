# OpenMouse-Support

OpenMouse-Support is the official support and ticket management system for the
OpenMouse project. **Discord is the user-facing support platform** — normal users
interact with support through the `#support` channel — and **the OpenMouse-Support
dashboard is the private staff/developer control center**.

It adapts the proven Discord ticketing engine of the open-source
[Open Ticket](https://github.com/open-discord-bots/open-ticket) project and
integrates it with OpenMouse's existing Supabase infrastructure and Cloudflare
Pages stack, rather than building a ticket system from scratch or introducing a
new tech stack.

### Source of truth: Discord owns the conversation

**Discord is the single source of truth for ticket conversations.** Discord owns
the threads, the messages, who said what, timestamps, attachments and full
history. Supabase stores only **structured metadata and application state**:
the ticket record (`OM-XXXX` number ↔ thread mapping), status, priority,
assignment, device/diagnostic info, internal staff notes, the audit log, and
dashboard state. The dashboard reads the live conversation from Discord via the
REST API and staff replies are posted straight back into the same thread — there
is no second, mirrored copy of the conversation stored in Supabase.

---

## Architecture at a glance

```
 Users (Discord #support)
        │  🎫 Create Ticket → modal → thread
        ▼
OpenMouse-Support Discord Bot        ┌─────────────────────────────┐
 (Node.js / discord.js v14,          │  Staff Dashboard (Preact)   │
  long-lived process on a VPS)       │  control.openmouse.app/...  │
        │  threads, messages,        ├─────────────────────────────┤
        │  buttons, modals           │  Cloudflare Pages Functions │
        ▼                            │  (functions/api/support/*)  │
   ┌──────────────────┐              │  Discord OAuth2 staff login │
   │  Discord = true  │◄──── source   └──────────────┬──────────────┘
   │  source of truth │  of truth for                │ REST + polling
   │  (threads +      │  the CONVERSATION             ▼
   │   messages)      │          ┌──────────────────────────────┐
   └──────────────────┘          │  Discord REST (bot token)    │◄── staff replies
        ▲                        │  posts into the SAME thread  │    go to the same
        │ metadata/state only    └──────────────────────────────┘    ticket thread
   ┌──────────────────┐
   │   Supabase       │  structured metadata only: tickets,
   │   (no conversation│  status/priority/assignment, notes,
   │    mirror)        │  audit log
   └──────────────────┘
```

- **Discord bot** (`support/bot`): the only genuinely new long-lived component.
  Discord buttons/modals/threads require a persistent gateway connection, which
  cannot run on Cloudflare's short-lived serverless functions. It is a
  standalone Node.js + discord.js process, adapted from Open Ticket's engine
  concepts, talking to the same Supabase project. Crucially, it does **not**
  mirror messages into Supabase — Discord stays the canonical conversation store.
- **Dashboard + API** (`src/support-admin.tsx`, `functions/api/support/*`):
  integrated into OpenMouse's existing Preact + Vite + Cloudflare Pages stack,
  reusing the project's dark developer-facing admin design language. It reads
  the live conversation from Discord and posts staff replies back into the same
  thread.
- **Split of responsibilities**: Discord owns conversations (threads, messages,
  authors, timestamps, attachments, history). Supabase owns application state
  (ticket metadata, notes, assignments, audit, dashboard state).

---

## Why the Discord bot is a separate process

Cloudflare Pages Functions (Workers) are short-lived, stateless and cannot hold
a persistent WebSocket gateway connection to Discord. The spec requires a real
Discord bot/application for buttons, modals, thread creation and message
handling — a webhook alone is explicitly not sufficient. Therefore `support/bot`
runs as a Node.js process (VPS / Docker / any always-on host), while everything
else stays on the existing Cloudflare/Preact stack.

---

## Database (Supabase)

Supabase is the **source of truth for structured ticket metadata and application
state** (it is explicitly **not** a mirror of the Discord conversation). The
schema lives in `support/db/migrations.sql` and covers:

| Table | Purpose |
|-------|---------|
| `support_staff` | Staff members, roles (OWNER/ADMIN/DEVELOPER/SUPPORT) |
| `support_tickets` | Ticket record: number ↔ thread mapping, status, priority, assignment, device/diagnostic info, timestamps (the `thread_id` / `discord_channel_id` link to the Discord thread that holds the actual conversation) |
| `support_ticket_participants` | Additional participant Discord ids |
| `support_ticket_messages` | **Internal staff notes only** + a delivery **outbox** for staff replies (see below) — not a full conversation mirror |
| `support_audit_log` | Staff/action audit trail |

Key design points:

- **Concurrency-safe ticket numbering.** Numbers are allocated from a PostgreSQL
  sequence inside `allocate_ticket_number()`, producing `OM-0001`, `OM-0002`, …
  Two simultaneous creations can never get the same number (never a
  `COUNT(*) + 1`).
- **The conversation itself is not stored in Supabase.** User and staff messages
  live in the Discord thread. `support_ticket_messages` is used for two things
  that Discord cannot hold:
  1. **Internal notes** (`is_internal_note = true`) — staff-only, never sent to
     Discord.
  2. **A delivery outbox** for staff replies that failed to post to Discord due
     to an outage (`delivered_to_discord = false`). These are retried later and
     marked delivered once they land; the row is never a second copy of a living
     conversation message.
- **Row Level Security** is enabled on every table and all end-user roles
  (`public`, `anon`, `authenticated`) are revoked. Only the **service-role key**
  can read/write these tables, and it is used exclusively server-side by the
  bot and the Pages Functions. RPC calls are restricted to `service_role`.
- **Relationships & indexes** are defined for tickets, participants, notes,
  audit log and the staff/ticket joins.

### Setting it up

Run `support/db/migrations.sql` in the Supabase SQL editor (or your migration
tooling). The enums and sequence handle the rest. This is intentionally kept as
a committed file (unlike the gitignored `supabase/migrations/` scratch dir) so
it is reviewable and shareable.

---

## Discord integration

### One ticket = one thread inside `#support`

`#support` remains a **normal text channel** (never a Forum, never a separate
channel per ticket). The bot posts a persistent **OpenMouse Support** panel:

> **OpenMouse Support** — Need help with OpenMouse?
> `🎫 Create Ticket`

Clicking **Create Ticket** opens a modal collecting:
- Subject (required)
- Description (required)
- Category
- Device / model, OpenMouse version, OS / firmware (optional, folded into a
  short field)

On submit the bot:
1. Validates the form.
2. Creates the `support_tickets` row and allocates `OM-XXXX` via the sequence.
3. Creates a **thread inside** `#support` named like `OM-0042 — Mouse not detected`.
4. Saves the thread id on the ticket.
5. Posts the initial ticket info embed into the thread.
6. Adds the user to the thread (associating them with the ticket).

### Conversation is read from Discord (no mirror)

The bot does **not** copy messages into Supabase. Discord holds the thread and
its full history; Supabase only records that a conversation happened (activity
timestamps) and the ticket/thread link. The dashboard reads the conversation
live from Discord through the REST API (paginated, newest-first, up to a bounded
number of messages), so everything in the thread — including user edits context,
attachments and history — appears in the dashboard as-is.

If a **user** replies to a `RESOLVED`/`CLOSED` ticket, the bot automatically
reopens it and touches the ticket's activity timestamp.

### Staff replies (Dashboard → Discord)

When a staff member replies from the dashboard, the Pages Function posts the
message into the **exact same existing ticket thread** (via the Discord REST API
with the bot token) — it never creates another thread and never posts into the
main `#support` channel. The message's author is shown as the staff member who
replied. On success the reply is recorded in the audit log; the ticket moves
`OPEN → IN_PROGRESS`. If Discord is briefly unavailable, the reply is written to
the Supabase **outbox** (`delivered_to_discord = false`) so it is never lost.
Delivery is then **auto-retried**: each poll atomically claims and re-posts one
pending outbox item as soon as Discord is reachable again (see Reliability), and
a manual "Not delivered — retry" fallback also remains on the message.

### Loading older history (lazy)

The initial ticket detail loads the **newest** window of the conversation
(capped at 200 messages). Older history is not truncated away — a **"Load older
messages"** button pages back through the Discord thread on demand (`?before=<messageId>`),
so a huge thread can be read in full without loading everything up front.

### Discord bot setup

See [`support/bot/README.md`](../bot/README.md) for full instructions. In short:

1. Create a Discord application/bot and invite it to the OpenMouse server with
   **Send Messages**, **Manage Threads**, **Create Public Threads** and
   **Read Message History** permissions in `#support`.
2. Copy `support/bot/.env.example` → `.env` and fill in the values.
3. `npm install && npm run build && npm start`.

---

## Staff dashboard

The dashboard is the private staff/developer control center. It uses
OpenMouse's existing **Preact + Vite + Cloudflare Pages** stack and its existing
dark, developer-focused admin design language. Entry: `support-admin.html` →
`src/support-admin.tsx` → `src/support-admin.css`.

### Auth (Discord OAuth2)

Access is enforced **server-side**:
- `GET /api/support/login` redirects to Discord OAuth2 (with an anti-CSRF
  `state` cookie).
- `GET /api/support/callback` validates `state`, exchanges the code, fetches the
  user's Discord identity, checks the **staff whitelist**, computes the role and
  issues a signed, httpOnly, `SameSite=Strict` session cookie.
- Every API route re-validates the session via `requireSession()` — never a
  client-side-only check.

Roles: `OWNER`, `ADMIN`, `DEVELOPER`, `SUPPORT`. Whitelist + role lists are set
in Pages environment variables (see below). Participant management is limited to
ADMIN/OWNER.

### API (Cloudflare Pages Functions under `functions/api/support/`)

| Path | Method | Purpose |
|------|--------|---------|
| `login`, `callback`, `me`, `logout` | — | Discord OAuth2 session |
| `overview` | GET | Headline stats, recent tickets/activity |
| `tickets` | GET | Search / filter / sort / paginate tickets |
| `ticket/[id]` | GET | Full ticket detail — reads the live conversation from Discord + internal notes/outbox; optional `?before=<messageId>` lazy-loads older history; returns `conversationUnavailable` if Discord can't be reached |
| `ticket/[id]/reply` | POST | Staff reply → posts into the same Discord thread (outbox on failure) |
| `ticket/[id]/retry` | POST | Manual retry of undelivered outbox replies (re-post to Discord, mark delivered) |
| `ticket/[id]/note` | POST | Internal note (never sent to Discord) |
| `ticket/[id]/status` | POST | Change status (OPEN/…/CLOSED), optional thread notice |
| `ticket/[id]/priority` | POST | Change priority |
| `ticket/[id]/assign` | POST | Assign / unassign staff |
| `ticket/[id]/participants` | POST | Add / remove participants (ADMIN/OWNER) |
| `poll` | GET | Lightweight realtime delta feed (`after=<last message id>` cursor, reads new messages from Discord; also auto-retries one pending outbox item) |
| `audit` | GET | Audit log across tickets |
| `staff` | GET | Staff list (assignee dropdown) |

### Realtime

The dashboard updates `support-admin.tsx` via lightweight REST polling every
~5 s against `/api/support/poll`. The poll uses the newest seen Discord message
id as a cursor (`after=`), fetches messages newer than that from the Discord
thread via the REST API, and merges any new internal notes/outbox items. So a
new Discord user message, status, priority or assignment change appears in the
open ticket quickly. (Secure RLS means we deliberately don't open Postgres
realtime websockets to the browser.)

### Status & priority

- **Status**: `OPEN` → `IN_PROGRESS` → `WAITING_FOR_USER` → `RESOLVED` → `CLOSED`.
  Auto-reopen when a user replies to a resolved/closed ticket.
- **Priority**: `LOW`, `NORMAL`, `HIGH`, `URGENT`, visible in list, detail and
  overview.

### Internal notes

Staff-only notes are stored in Supabase with `is_internal_note = true`, shown
visibly distinct in the dashboard, and **never** sent to Discord.

---

## Environment variables (Cloudflare Pages Functions)

These are **server-side secrets** — never prefix with `VITE_`, never commit, and
never expose to the browser.

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Superuser key (server-side only) |
| `SUPPORT_SESSION_SECRET` | HMAC secret for dashboard session cookies (`openssl rand -hex 32`) |
| `SUPPORT_BASE_URL` | e.g. `https://control.openmouse.app` (for OAuth redirect) |
| `DISCORD_CLIENT_ID` | Discord app client id (OAuth) |
| `DISCORD_CLIENT_SECRET` | Discord app client secret (OAuth) |
| `DISCORD_BOT_TOKEN` | Discord bot token (used for posting staff replies) |
| `SUPPORT_STAFF_WHITELIST` | Comma-separated Discord ids allowed to log in |
| `SUPPORT_OWNER_IDS` / `SUPPORT_ADMIN_IDS` / `SUPPORT_DEVELOPER_IDS` | Comma-separated role lists |
| `SUPPORT_WHITELIST_EXTRA` | Extra ids allowed to log in at SUPPORT level |

The Discord bot has its own env (see `support/bot/.env.example`).

### Discord OAuth redirect URI

Register `` `${SUPPORT_BASE_URL}/api/support/callback` `` as an OAuth2 redirect
URI in the Discord Developer Portal, with the **identify** scope.

---

## Security

- Supabase service-role key and Discord bot token are never exposed to the
  browser; they exist only in Pages Function / bot environment.
- Staff auth is server-side OAuth2 + whitelist; sessions are signed and
  httpOnly.
- `SameSite=Strict` cookies and OAuth `state` prevent CSRF.
- Origin checks on API POSTs where applicable.
- `@everyone/@here` mentions are blocked in dashboard replies (mention abuse).
- RLS enabled everywhere; only `service_role` can access.
- Bot token / webhook credentials are not reused from anywhere that may have
  been leaked; the previous webhook credential is considered compromised and
  must not be used.

---

## Reliability

- Persistent IDs everywhere (ticket id, thread id, message id).
- **Discord is the source of truth**, so there is no divergent secondary copy of
  the conversation to drift out of sync. The dashboard always reads the live
  thread.
- The dashboard degrades gracefully if Discord is unavailable: it shows a
  "conversation unavailable" banner and still renders ticket metadata, internal
  notes and any queued outbox replies.
- **Staff replies survive Discord outages via the outbox**: if posting fails, the
  reply is stored (`delivered_to_discord = false`) and **auto-retried** — each
  poll atomically claims and re-posts one pending item as soon as Discord is
  reachable again. The claim is `SELECT … FOR UPDATE SKIP LOCKED` (plus a
  2-minute reclaim window), so concurrent pollers can never double-post the same
  reply. A manual "retry" action remains as a fallback.
- **Lazy-loading prevents the long-thread tail from disappearing.** The initial
  view shows the newest window (≤200); older history is paginated on demand
  (`?before=<messageId>`), so very long threads are fully readable without a
  heavy initial fetch.
- Pagination is **idempotent and cursor-based** (`after=<message id>`), so
  duplicate poll events cannot produce duplicate rows or duplicated UI messages.
- Ticket numbering is concurrency-safe (sequence-based).
- The bot and dashboard are separate processes, so a bot restart does not take
  the dashboard down (and vice versa).

### Known limits of the Discord-as-source-of-truth model

- **No full-text search over historical conversation messages** in the
  dashboard. Search (and stats) operate on Supabase metadata (subject,
  description, number, status, assignee, notes). To search past message bodies,
  query Discord's own search or the thread directly. Since the conversation is
  no longer stored locally, this is the deliberate trade-off for not
  maintaining a duplicate copy.
- **Paging is by Discord message id (order), not strictly by timestamp.** The
  thread is read newest-first with `before=` cursors. The initial view is capped
  at a newest window (200 messages) and older history loads on demand, so a very
  long thread takes extra clicks to read back rather than being hidden.
- **Rate-limit budget.** Reading long threads and every poll consumes Discord
  REST rate limits. The bot shares the same token, so heavy conversation reads +
  staff posts must stay within the shared bucket (polling is lightweight and
  cursor-based by design to keep this low).
- **Offline behavior.** Users always talk to real Discord (uninterrupted). Only
  the dashboard's *read* of the conversation and *posting* of staff replies
  depend on the dashboard→Discord path; those are covered by the banner + outbox
  mechanisms above.
- **`support_ticket_messages` is not the conversation.** It holds internal notes
  + retryable outbox entries only — querying it will not return the full thread.

---

## Rationale for Open Ticket adaptation

Open Ticket provides exactly the interactive Discord ticketing engine OpenMouse
needs: panels/buttons, modals/questions, thread-based tickets, lifecycle, claim
free functionality, participants, priorities, events and logging. We keep those
behaviours but replace its storage layer (JSON files), config and deployment
model:

- Storage → **Supabase** (source of truth, RLS, relationships, idempotency).
- Config → **environment variables** following OpenMouse's convention.
- Runtime for the bot → Node.js (required for the gateway); dashboard → the
  existing Cloudflare/Preact stack.

We do **not** copy Open Ticket's JSON database, its dashboard, or its stack into
OpenMouse; we adapt the ticketing engine so the result is native to OpenMouse.

---

## Local development

1. **Bot**: `cd support/bot`, `npm install`, copy `.env.example` → `.env`,
   `npm run build && npm start`.
2. **Dashboard/API**: run the existing Vite dev server (`npm run dev`) and the
   Pages Functions with the required env vars. Use the Cloudflare Wrangler CLI
   for the Functions if you need them locally (`npx wrangler pages dev`).
3. Apply `support/db/migrations.sql` to your Supabase project.

## Production deployment

- **Dashboard + API**: deploy the Cloudflare Pages project (`npm run build` —
  the app target includes `support-admin.html`), set the env vars above.
- **Bot**: run `support/bot` on a VPS or as a Docker container, keeping it
  always-on. Re-point `SUPPORT_PANEL_MESSAGE_ID` to the deployed panel message
  id so it is edited rather than duplicated on restarts.
