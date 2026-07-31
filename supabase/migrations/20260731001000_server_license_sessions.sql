alter table public.license_keys
  add column if not exists access_expires_at timestamptz;

-- The browser no longer authenticates or redeems licenses directly.
revoke execute on function public.control_access_status() from authenticated;
revoke execute on function public.redeem_license_key(text) from authenticated;

update public.license_keys
   set access_expires_at = redeemed_at + make_interval(secs => duration_seconds)
 where redeemed_at is not null
   and duration_seconds is not null
   and access_expires_at is null;

create table if not exists public.license_sessions (
  id uuid primary key default gen_random_uuid(),
  license_key_id uuid not null references public.license_keys(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists license_sessions_active_token_idx
  on public.license_sessions (token_hash, expires_at)
  where revoked_at is null;

alter table public.license_sessions enable row level security;
revoke all on public.license_sessions from public, anon, authenticated;

create or replace function public.activate_license_session(license_key text, session_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  matched_key public.license_keys%rowtype;
  session_expiry timestamptz;
begin
  if length(trim(license_key)) < 12 or length(session_hash) <> 64 then
    raise exception 'Invalid license code';
  end if;

  select * into matched_key
    from public.license_keys
   where key_hash = encode(digest(upper(trim(license_key)), 'sha256'), 'hex')
   for update;

  if not found or matched_key.disabled_at is not null then
    raise exception 'Invalid license code';
  end if;
  if matched_key.redeemed_at is null
     and matched_key.redeem_before is not null
     and matched_key.redeem_before <= now() then
    raise exception 'License code activation period has expired';
  end if;

  if matched_key.redeemed_at is null then
    matched_key.redeemed_at := now();
    matched_key.access_expires_at := case
      when matched_key.duration_seconds is null then null
      else now() + make_interval(secs => matched_key.duration_seconds)
    end;
    update public.license_keys
       set redeemed_at = matched_key.redeemed_at,
           access_expires_at = matched_key.access_expires_at
     where id = matched_key.id;
  end if;

  if matched_key.access_expires_at is not null and matched_key.access_expires_at <= now() then
    raise exception 'License has expired';
  end if;

  session_expiry := least(
    coalesce(matched_key.access_expires_at, now() + interval '365 days'),
    now() + interval '365 days'
  );
  insert into public.license_sessions (license_key_id, token_hash, expires_at)
  values (matched_key.id, lower(session_hash), session_expiry);

  return jsonb_build_object('allowed', true, 'session_expires_at', session_expiry);
end;
$$;

create or replace function public.validate_license_session(session_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  valid_until timestamptz;
begin
  select least(s.expires_at, coalesce(k.access_expires_at, s.expires_at))
    into valid_until
    from public.license_sessions s
    join public.license_keys k on k.id = s.license_key_id
   where s.token_hash = lower(session_hash)
     and s.revoked_at is null
     and s.expires_at > now()
     and k.disabled_at is null
     and (k.access_expires_at is null or k.access_expires_at > now());

  if valid_until is null then
    return jsonb_build_object('allowed', false);
  end if;

  update public.license_sessions
     set last_seen_at = now()
   where token_hash = lower(session_hash)
     and last_seen_at < now() - interval '5 minutes';
  return jsonb_build_object('allowed', true, 'expires_at', valid_until);
end;
$$;

revoke all on function public.activate_license_session(text, text) from public, anon, authenticated;
revoke all on function public.validate_license_session(text) from public, anon, authenticated;
grant execute on function public.activate_license_session(text, text) to service_role;
grant execute on function public.validate_license_session(text) to service_role;
