create table if not exists public.protected_mouse_request_submissions (
  request_id uuid not null references public.mouse_requests(id) on delete cascade,
  voter_hash text not null references public.mouse_vote_identities(voter_hash) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, voter_hash)
);

create index if not exists protected_mouse_request_submissions_voter_created_idx
  on public.protected_mouse_request_submissions (voter_hash, created_at desc);

alter table public.protected_mouse_request_submissions enable row level security;
revoke all on public.protected_mouse_request_submissions from public, anon, authenticated;

-- Reinstall the nested vote function with every read column qualified. This is
-- included here so rerunning this migration alone repairs older installations.
create or replace function public.cast_protected_mouse_vote(p_request_id uuid, p_voter_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_daily_votes integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Protected voting endpoint required' using errcode = '42501';
  end if;
  if p_voter_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid voter identity'; end if;
  if not exists (select 1 from public.mouse_requests r where r.id = p_request_id) then
    raise exception 'Mouse request not found';
  end if;

  insert into public.mouse_vote_identities(voter_hash) values (p_voter_hash)
    on conflict on constraint mouse_vote_identities_pkey do nothing;
  perform 1 from public.mouse_vote_identities i where i.voter_hash = p_voter_hash for update;

  if exists (select 1 from public.protected_mouse_votes pv where pv.request_id = p_request_id and pv.voter_hash = p_voter_hash) then
    raise exception 'Already voted for this mouse';
  end if;
  select count(*) into v_daily_votes from public.protected_mouse_votes pv
  where pv.voter_hash = p_voter_hash and pv.created_at >= now() - interval '24 hours';
  if v_daily_votes >= 5 then raise exception 'Daily vote limit reached'; end if;

  insert into public.protected_mouse_votes(request_id, voter_hash) values (p_request_id, p_voter_hash);
  update public.mouse_vote_identities as i set last_vote_at = now() where i.voter_hash = p_voter_hash;
end;
$$;

revoke all on function public.cast_protected_mouse_vote(uuid, text) from public, anon, authenticated;
grant execute on function public.cast_protected_mouse_vote(uuid, text) to service_role;

create or replace function public.cast_protected_mouse_request(
  p_manufacturer text, p_model text, p_connection text, p_voter_hash text
) returns setof public.mouse_request_catalog
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_weekly_requests integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Protected request endpoint required' using errcode = '42501';
  end if;
  if p_voter_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid voter identity'; end if;
  if char_length(trim(p_manufacturer)) not between 1 and 80
    or char_length(trim(p_model)) not between 1 and 120 then
    raise exception 'Manufacturer and model are required';
  end if;

  insert into public.mouse_vote_identities(voter_hash) values (p_voter_hash)
    on conflict on constraint mouse_vote_identities_pkey do nothing;
  perform 1 from public.mouse_vote_identities i where i.voter_hash = p_voter_hash for update;

  select count(*) into v_weekly_requests
  from public.protected_mouse_request_submissions s
  where s.voter_hash = p_voter_hash and s.created_at >= now() - interval '7 days';
  if v_weekly_requests >= 2 then raise exception 'Weekly request limit reached'; end if;

  select r.id into v_request_id
  from public.mouse_requests r
  where r.normalized_name = lower(regexp_replace(trim(p_manufacturer || ' ' || p_model), '\s+', ' ', 'g'));

  if v_request_id is null then
    begin
      insert into public.mouse_requests(manufacturer, model, connection, features, can_test)
      values (trim(p_manufacturer), trim(p_model), left(coalesce(nullif(trim(p_connection), ''), 'Not sure'), 80), '{}', false)
      returning id into v_request_id;
    exception when unique_violation then
      select r.id into v_request_id
      from public.mouse_requests r
      where r.normalized_name = lower(regexp_replace(trim(p_manufacturer || ' ' || p_model), '\s+', ' ', 'g'));
    end;
  end if;

  execute $insert$
    insert into public.protected_mouse_request_submissions(request_id, voter_hash)
    values ($1, $2)
    on conflict on constraint protected_mouse_request_submissions_pkey do nothing
  $insert$ using v_request_id, p_voter_hash;

  return query select c.* from public.mouse_request_catalog c where c.id = v_request_id;
end;
$$;

revoke all on function public.cast_protected_mouse_request(text, text, text, text) from public, anon, authenticated;
grant execute on function public.cast_protected_mouse_request(text, text, text, text) to service_role;

-- The caller-generated UUID version remains closed.
revoke execute on function public.submit_mouse_request(text, text, text, text[], boolean, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
