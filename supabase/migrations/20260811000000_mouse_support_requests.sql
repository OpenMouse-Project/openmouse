create extension if not exists pgcrypto;

create table public.mouse_requests (
  id uuid primary key default gen_random_uuid(),
  manufacturer text not null check (char_length(manufacturer) between 1 and 80),
  model text not null check (char_length(model) between 1 and 120),
  normalized_name text generated always as (lower(regexp_replace(trim(manufacturer || ' ' || model), '\s+', ' ', 'g'))) stored unique,
  connection text not null default 'Not sure',
  features text[] not null default '{}',
  can_test boolean not null default false,
  status text not null default 'submitted' check (status in ('submitted','reviewing','planned','supported','declined')),
  created_at timestamptz not null default now()
);

create table public.mouse_request_votes (
  request_id uuid not null references public.mouse_requests(id) on delete cascade,
  voter_token uuid not null,
  created_at timestamptz not null default now(),
  primary key (request_id, voter_token)
);

create table public.mouse_request_diagnostics (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.mouse_requests(id) on delete cascade,
  voter_token uuid not null,
  bundle jsonb not null,
  created_at timestamptz not null default now(),
  unique (request_id, voter_token)
);

create view public.mouse_request_catalog as
select r.id, r.manufacturer, r.model, r.connection, r.features, r.can_test, r.status, r.created_at,
  count(v.request_id)::integer as vote_count
from public.mouse_requests r left join public.mouse_request_votes v on v.request_id = r.id
group by r.id;

alter table public.mouse_requests enable row level security;
alter table public.mouse_request_votes enable row level security;
alter table public.mouse_request_diagnostics enable row level security;
create policy "catalog requests are public" on public.mouse_requests for select using (true);
create policy "catalog votes are countable" on public.mouse_request_votes for select using (true);

create function public.vote_mouse_request(p_request_id uuid, p_voter_token uuid) returns void
language sql security definer set search_path = public as $$
  insert into mouse_request_votes(request_id, voter_token) values (p_request_id, p_voter_token);
$$;

create function public.submit_mouse_request(
  p_manufacturer text, p_model text, p_connection text, p_features text[],
  p_can_test boolean, p_voter_token uuid
) returns setof public.mouse_request_catalog
language plpgsql security definer set search_path = public as $$
declare request_id uuid;
begin
  if char_length(trim(p_manufacturer)) not between 1 and 80 or char_length(trim(p_model)) not between 1 and 120 then
    raise exception 'Manufacturer and model are required';
  end if;
  insert into mouse_requests(manufacturer, model, connection, features, can_test)
    values (trim(p_manufacturer), trim(p_model), left(coalesce(p_connection, 'Not sure'), 80), coalesce(p_features, '{}'), coalesce(p_can_test, false))
    on conflict (normalized_name) do update set can_test = mouse_requests.can_test or excluded.can_test
    returning id into request_id;
  insert into mouse_request_votes values (request_id, p_voter_token, now()) on conflict do nothing;
  return query select * from mouse_request_catalog where id = request_id;
end;
$$;

create function public.contribute_mouse_diagnostics(p_request_id uuid, p_voter_token uuid, p_bundle jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if pg_column_size(p_bundle) > 1048576 then raise exception 'Diagnostic bundle is larger than 1 MB'; end if;
  insert into mouse_request_diagnostics(request_id, voter_token, bundle)
    values (p_request_id, p_voter_token, p_bundle)
    on conflict (request_id, voter_token) do update set bundle = excluded.bundle, created_at = now();
end;
$$;

revoke all on public.mouse_requests, public.mouse_request_votes, public.mouse_request_diagnostics from anon, authenticated;
revoke execute on function public.vote_mouse_request(uuid, uuid) from public;
revoke execute on function public.submit_mouse_request(text,text,text,text[],boolean,uuid) from public;
revoke execute on function public.contribute_mouse_diagnostics(uuid,uuid,jsonb) from public;
grant select on public.mouse_request_catalog to anon, authenticated;
grant execute on function public.vote_mouse_request(uuid, uuid) to anon, authenticated;
grant execute on function public.submit_mouse_request(text,text,text,text[],boolean,uuid) to anon, authenticated;
grant execute on function public.contribute_mouse_diagnostics(uuid,uuid,jsonb) to anon, authenticated;
