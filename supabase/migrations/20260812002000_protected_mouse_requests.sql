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

create or replace function public.cast_protected_mouse_request(
  p_manufacturer text, p_model text, p_connection text, p_voter_hash text
) returns setof public.mouse_request_catalog
language plpgsql
security definer
set search_path = public
as $$
declare
  request_id uuid;
  weekly_requests integer;
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
    on conflict (voter_hash) do nothing;
  perform 1 from public.mouse_vote_identities where voter_hash = p_voter_hash for update;

  select count(*) into weekly_requests
  from public.protected_mouse_request_submissions
  where voter_hash = p_voter_hash and created_at >= now() - interval '7 days';
  if weekly_requests >= 2 then raise exception 'Weekly request limit reached'; end if;

  select r.id into request_id
  from public.mouse_requests r
  where r.normalized_name = lower(regexp_replace(trim(p_manufacturer || ' ' || p_model), '\s+', ' ', 'g'));

  if request_id is null then
    begin
      insert into public.mouse_requests(manufacturer, model, connection, features, can_test)
      values (trim(p_manufacturer), trim(p_model), left(coalesce(nullif(trim(p_connection), ''), 'Not sure'), 80), '{}', false)
      returning id into request_id;
    exception when unique_violation then
      select r.id into request_id
      from public.mouse_requests r
      where r.normalized_name = lower(regexp_replace(trim(p_manufacturer || ' ' || p_model), '\s+', ' ', 'g'));
    end;
  end if;

  perform public.cast_protected_mouse_vote(request_id, p_voter_hash);
  insert into public.protected_mouse_request_submissions(request_id, voter_hash)
  values (request_id, p_voter_hash)
  on conflict (request_id, voter_hash) do nothing;

  return query select * from public.mouse_request_catalog where id = request_id;
end;
$$;

revoke all on function public.cast_protected_mouse_request(text, text, text, text) from public, anon, authenticated;
grant execute on function public.cast_protected_mouse_request(text, text, text, text) to service_role;

-- The caller-generated UUID version remains closed.
revoke execute on function public.submit_mouse_request(text, text, text, text[], boolean, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
