create table if not exists public.mouse_vote_identities (
  voter_hash text primary key check (char_length(voter_hash) = 64),
  created_at timestamptz not null default now(),
  last_vote_at timestamptz not null default now()
);

create table if not exists public.protected_mouse_votes (
  request_id uuid not null references public.mouse_requests(id) on delete cascade,
  voter_hash text not null references public.mouse_vote_identities(voter_hash) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, voter_hash)
);

create index if not exists protected_mouse_votes_voter_created_idx
  on public.protected_mouse_votes (voter_hash, created_at desc);

alter table public.mouse_vote_identities enable row level security;
alter table public.protected_mouse_votes enable row level security;
revoke all on public.mouse_vote_identities, public.protected_mouse_votes from public, anon, authenticated;

create or replace function public.cast_protected_mouse_vote(p_request_id uuid, p_voter_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare daily_votes integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Protected voting endpoint required' using errcode = '42501';
  end if;
  if p_voter_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid voter identity'; end if;
  if not exists (select 1 from public.mouse_requests where id = p_request_id) then
    raise exception 'Mouse request not found';
  end if;

  insert into public.mouse_vote_identities(voter_hash) values (p_voter_hash)
    on conflict (voter_hash) do nothing;
  perform 1 from public.mouse_vote_identities where voter_hash = p_voter_hash for update;

  if exists (select 1 from public.protected_mouse_votes where request_id = p_request_id and voter_hash = p_voter_hash) then
    raise exception 'Already voted for this mouse';
  end if;
  select count(*) into daily_votes from public.protected_mouse_votes
   where voter_hash = p_voter_hash and created_at >= now() - interval '24 hours';
  if daily_votes >= 5 then raise exception 'Daily vote limit reached'; end if;

  insert into public.protected_mouse_votes(request_id, voter_hash) values (p_request_id, p_voter_hash);
  update public.mouse_vote_identities set last_vote_at = now() where voter_hash = p_voter_hash;
end;
$$;

revoke all on function public.cast_protected_mouse_vote(uuid, text) from public, anon, authenticated;
grant execute on function public.cast_protected_mouse_vote(uuid, text) to service_role;

create or replace view public.mouse_request_catalog as
select r.id, r.manufacturer, r.model, r.connection, r.features, r.can_test, r.status, r.created_at,
  (count(distinct v.voter_token) + count(distinct pv.voter_hash))::integer as vote_count
from public.mouse_requests r
left join public.mouse_request_votes v on v.request_id = r.id
left join public.protected_mouse_votes pv on pv.request_id = r.id
group by r.id;

grant select on public.mouse_request_catalog to anon, authenticated;

-- Keep every old, caller-token write path closed. Only the Pages Function's
-- service-role call to cast_protected_mouse_vote may add votes.
revoke execute on function public.vote_mouse_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.submit_mouse_request(text, text, text, text[], boolean, uuid) from public, anon, authenticated;
revoke execute on function public.contribute_mouse_diagnostics(uuid, uuid, jsonb) from public, anon, authenticated;
