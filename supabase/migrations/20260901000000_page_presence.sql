-- "Who's on the launch countdown page right now" — a heartbeat table with a
-- single service-role RPC, following the same locked-down pattern as
-- protected_mouse_voting.sql. No public read/write path exists; only the
-- presence Pages Function (via the service role key) may call this.

create table if not exists public.page_presence (
  session_id uuid primary key,
  last_seen timestamptz not null default now()
);

alter table public.page_presence enable row level security;
revoke all on public.page_presence from public, anon, authenticated;

create or replace function public.heartbeat_page_presence(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_ids uuid[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Protected presence endpoint required' using errcode = '42501';
  end if;

  insert into public.page_presence (session_id, last_seen)
  values (p_session_id, now())
  on conflict (session_id) do update set last_seen = excluded.last_seen;

  -- Sweep anyone who hasn't heartbeated in a while so the table never grows
  -- unbounded and stale visitors drop out of the count/roster promptly.
  delete from public.page_presence where last_seen < now() - interval '2 minutes';

  select count(*) into v_count from public.page_presence;
  select coalesce(array_agg(session_id order by last_seen desc), '{}')
    into v_ids
    from (select session_id, last_seen from public.page_presence order by last_seen desc limit 24) recent;

  return jsonb_build_object('count', v_count, 'ids', v_ids);
end;
$$;

revoke all on function public.heartbeat_page_presence(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_page_presence(uuid) to service_role;
