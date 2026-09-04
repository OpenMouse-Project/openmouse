-- ============================================================================
-- OpenMouse-Support
--
-- Supabase schema for the OpenMouse support & ticket management system.
--
-- ARCHITECTURE: Discord is the source of truth for the ticket *conversation*
-- (threads, messages, edits, deletions, attachments, timestamps, authors). The
-- staff dashboard reads the conversation directly from the Discord API. This
-- schema holds only the structured metadata and application state that Discord
-- cannot represent or query cleanly:
--   * support_tickets    -- number <-> thread mapping, subject, category,
--                          diagnostics, status, priority, assignment, timestamps
--   * support_staff      -- staff identities/roles (linked to Discord ids)
--   * support_ticket_participants -- extra attendees
--   * support_ticket_messages     -- internal notes + pending-outbox only
--   * support_audit_log  -- staff/action audit trail
--
-- The Discord bot writes via the service-role key; the staff dashboard
-- reads/writes via the service-role key through locked-down Cloudflare Pages
-- Functions. Staff authorization is enforced server-side (Discord OAuth2 +
-- whitelist), not via Supabase auth, so the rows are not exposed to
-- anon/authenticated roles and RLS is enabled everywhere with no grant to
-- end-user roles.
--
-- Run this whole file in the Supabase SQL editor, or via the migrations tool.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.ticket_status as enum (
    'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_priority as enum (
    'LOW', 'NORMAL', 'HIGH', 'URGENT'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_message_type as enum (
    'USER', 'STAFF', 'SYSTEM'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.staff_role as enum (
    'OWNER', 'ADMIN', 'DEVELOPER', 'SUPPORT'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- staff
-- Staff members who can access the dashboard. Identified by their Discord
-- user id. Roles gate what they can do. The whitelist of Discord ids that are
-- allowed to log in at all lives in the dashboard Function config; this table
-- stores the richer per-staff role/display info once OAuth proves identity.
-- ---------------------------------------------------------------------------
create table if not exists public.support_staff (
  discord_id text primary key,
  role public.staff_role not null default 'SUPPORT',
  discord_username text,
  display_name text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- ---------------------------------------------------------------------------
-- tickets
-- One row per ticket. number is the human-facing "OM-0004" id, allocated
-- concurrency-safe from the support_ticket_seq sequence (never COUNT(*) + 1).
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique,            -- the integer behind "OM-%04d"
  public_number text not null unique,        -- the "OM-0004" string
  subject text not null,
  description text not null default '',
  category text not null default 'Other',
  -- User/device/diagnostic information collected at creation time (nullable,
  -- only stored when actually provided by the user):
  device_model text,
  openmouse_version text,
  operating_system text,
  firmware_version text,
  diagnostics jsonb not null default '{}'::jsonb,

  user_discord_id text not null,
  user_discord_username text,

  status public.ticket_status not null default 'OPEN',
  priority public.ticket_priority not null default 'NORMAL',

  assigned_to text references public.support_staff(discord_id),
  assigned_at timestamptz,

  -- Discord thread where the conversation lives (nullable until created).
  discord_thread_id text,
  discord_thread_name text,
  discord_channel_id text,
  discord_panel_message_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  last_activity_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_by text,

  constraint support_tickets_status_check check (status <> 'CLOSED' or closed_at is not null)
);

create index if not exists support_tickets_status_idx on public.support_tickets (status);
create index if not exists support_tickets_priority_idx on public.support_tickets (priority);
create index if not exists support_tickets_assigned_to_idx on public.support_tickets (assigned_to);
create index if not exists support_tickets_user_idx on public.support_tickets (user_discord_id);
create index if not exists support_tickets_created_idx on public.support_tickets (created_at desc);
create index if not exists support_tickets_last_activity_idx on public.support_tickets (last_activity_at desc);
create index if not exists support_tickets_category_idx on public.support_tickets (category);

-- Concurrency-safe ticket numbering. allocation is a per-row attempt token;
-- support_ticket_seq is incremented inside the insert so that concurrent
-- creations can never receive the same number.
create sequence if not exists public.support_ticket_seq start 1;

-- ---------------------------------------------------------------------------
-- ticket_participants
-- The subject user is the owner (stored on support_tickets). Additional
-- attendee Discord ids that can also take part are added here.
-- ---------------------------------------------------------------------------
create table if not exists public.support_ticket_participants (
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  discord_id text not null,
  discord_username text,
  added_by text,
  added_at timestamptz not null default now(),
  primary key (ticket_id, discord_id)
);

create index if not exists support_ticket_participants_discord_idx
  on public.support_ticket_participants (discord_id);

-- ---------------------------------------------------------------------------
-- messages
--
-- Discord is now the source of truth for the actual ticket conversation
-- (threads, messages, edits, deletions, attachments, timestamps, authors).
-- This table NO LONGER mirrors the conversation. It holds only the small set
-- of messages that Discord cannot represent and that must persist outside it:
--
--   1. Internal staff notes (is_internal_note = true, discord_message_id null)
--      -- these must NEVER be sent to Discord.
--   2. Pending/failed staff replies (is_internal_note = false,
--      delivered_to_discord = false, discord_message_id null) -- an "outbox"
--      used when Discord is temporarily unavailable, so a staff reply is never
--      silently lost. Staff can retry delivery from the dashboard.
--
-- Discord-originated messages are never inserted here.
-- ---------------------------------------------------------------------------
create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  -- Set only once an outbox reply has actually been posted to Discord:
  discord_message_id text unique,
  discord_channel_id text,
  author_discord_id text not null,
  author_name text,
  content text not null default '',
  message_type public.ticket_message_type not null default 'USER',
  -- Whether this was authored by the dashboard (STAFF) versus Discord:
  source text not null default 'discord' check (source in ('discord', 'dashboard')),
  -- For STAFF dashboard messages / internal notes:
  staff_discord_id text references public.support_staff(discord_id),
  is_internal_note boolean not null default false,
  -- false = staff reply is sitting in the outbox and has NOT yet reached Discord:
  delivered_to_discord boolean not null default true,
  -- Auto-retry claim stamp (concurrent pollers claim one item at a time so a
  -- reply is never double-posted). Null until an auto-retry polls in; reset by
  -- the claim window so an item can't be stuck forever if a poller dies mid-post.
  retry_claimed_at timestamptz,
  retry_claimed_by text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at);
create index if not exists support_ticket_messages_author_idx
  on public.support_ticket_messages (author_discord_id);
create index if not exists support_ticket_messages_outbox_idx
  on public.support_ticket_messages (ticket_id)
  where is_internal_note = false and delivered_to_discord = false;

-- ---------------------------------------------------------------------------
-- audit_log
-- Staff/action log for important ticket events.
-- ---------------------------------------------------------------------------
create table if not exists public.support_audit_log (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  actor_discord_id text,
  actor_name text,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_audit_log_ticket_idx on public.support_audit_log (ticket_id, created_at desc);
create index if not exists support_audit_log_created_idx on public.support_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.support_staff enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_participants enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_audit_log enable row level security;

-- No end-user role may touch these tables directly. Only the service-role key
-- (used exclusively server-side by the bot and the dashboard Functions) can.
revoke all on public.support_staff, public.support_tickets,
  public.support_ticket_participants, public.support_ticket_messages,
  public.support_audit_log from public, anon, authenticated;

-- The RPC functions below read/write via the service-role key and are also
-- restricted to that role only.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_ticket_activity(p_ticket uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.support_tickets
     set updated_at = now(), last_activity_at = now()
   where id = p_ticket;
end;
$$;

revoke all on function public.touch_ticket_activity(uuid) from public, anon, authenticated;
grant execute on function public.touch_ticket_activity(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- allocate_ticket_number
-- Concurrency-safe: bumps the sequence inside a transaction and returns the
-- unique integer + its public "OM-0004" string. Callers create their own
-- unnumbered ticket row and then set its number with it.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_ticket_number(p_ticket uuid)
returns table (ticket_uuid uuid, number_out integer, public_number_out text)
language plpgsql security definer set search_path = public as $$
declare v_number integer;
begin
  select nextval('public.support_ticket_seq') into v_number;
  update public.support_tickets
     set number = v_number,
         public_number = 'OM-' || lpad(v_number::text, 4, '0')
   where id = p_ticket;
  return query select p_ticket, v_number, 'OM-' || lpad(v_number::text, 4, '0');
end;
$$;

revoke all on function public.allocate_ticket_number(uuid) from public, anon, authenticated;
grant execute on function public.allocate_ticket_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- claim_pending_outbox
-- Atomically claims ONE pending outbox item for a ticket so that concurrent
-- dashboard pollers can auto-retry deliveries without ever posting the same
-- staff reply twice. Uses SELECT ... FOR UPDATE SKIP LOCKED: exactly one caller
-- locks a given row. A row already claimed within the window (CLAIM_WINDOW) is
-- ignored, so if a poller dies mid-post the item becomes claimable again after
-- the window instead of being stuck forever. On success the caller posts the
-- message to Discord and then marks delivered_to_discord = true, which removes
-- it from future claims.
-- ---------------------------------------------------------------------------
create or replace function public.claim_pending_outbox(p_ticket uuid, p_claimant text)
returns table (
  id uuid, ticket_id uuid, discord_channel_id text,
  author_discord_id text, author_name text, content text, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_claim_window interval := interval '2 minutes';
begin
  select m.id, m.ticket_id, m.discord_channel_id, m.author_discord_id,
         m.author_name, m.content, m.created_at
    into v_row
    from public.support_ticket_messages m
   where m.ticket_id = p_ticket
     and m.is_internal_note = false
     and m.delivered_to_discord = false
     and (m.retry_claimed_at is null or m.retry_claimed_at < now() - v_claim_window)
   order by m.created_at asc
   limit 1
   for update skip locked;

  if v_row.id is null then
    return;
  end if;

  update public.support_ticket_messages
     set retry_claimed_at = now(), retry_claimed_by = p_claimant
   where id = v_row.id;

  return query
    select v_row.id, v_row.ticket_id, v_row.discord_channel_id,
           v_row.author_discord_id, v_row.author_name, v_row.content, v_row.created_at;
end;
$$;

revoke all on function public.claim_pending_outbox(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_pending_outbox(uuid, text) to service_role;
