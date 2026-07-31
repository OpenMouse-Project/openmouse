create extension if not exists pgcrypto;

create table public.license_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  label text,
  duration_seconds bigint check (duration_seconds is null or duration_seconds > 0),
  redeem_before timestamptz,
  disabled_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.license_keys is
  'One-time license keys. Store only SHA-256 hashes, never plaintext keys.';
comment on column public.license_keys.duration_seconds is
  'Access duration after redemption. NULL means no entitlement expiry.';

create table public.control_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  license_key_id uuid unique references public.license_keys(id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index control_entitlements_active_user_idx
  on public.control_entitlements (user_id, expires_at)
  where revoked_at is null;

alter table public.license_keys enable row level security;
alter table public.control_entitlements enable row level security;

create policy "Users can view their own entitlements"
  on public.control_entitlements for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.control_access_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, auth, extensions
as $$
declare
  entitlement_expiry timestamptz;
  is_admin boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('allowed', false, 'expires_at', null);
  end if;

  select coalesce((raw_app_meta_data ->> 'control_panel_admin')::boolean, false)
    into is_admin
    from auth.users
   where id = auth.uid();

  if is_admin then
    return jsonb_build_object('allowed', true, 'expires_at', null);
  end if;

  select max(expires_at)
    into entitlement_expiry
    from public.control_entitlements
   where user_id = auth.uid()
     and revoked_at is null
     and (expires_at is null or expires_at > now());

  if exists (
    select 1 from public.control_entitlements
     where user_id = auth.uid()
       and revoked_at is null
       and expires_at is null
  ) then
    return jsonb_build_object('allowed', true, 'expires_at', null);
  end if;

  return jsonb_build_object(
    'allowed', entitlement_expiry is not null,
    'expires_at', entitlement_expiry
  );
end;
$$;

create or replace function public.redeem_license_key(license_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  matched_key public.license_keys%rowtype;
  entitlement_expiry timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if length(trim(license_key)) < 12 then
    raise exception 'Invalid license key';
  end if;

  select * into matched_key
    from public.license_keys
   where key_hash = encode(digest(upper(trim(license_key)), 'sha256'), 'hex')
   for update;

  if not found or matched_key.disabled_at is not null then
    raise exception 'Invalid license key';
  end if;
  if matched_key.redeemed_at is not null then
    raise exception 'License key has already been redeemed';
  end if;
  if matched_key.redeem_before is not null and matched_key.redeem_before <= now() then
    raise exception 'License key has expired';
  end if;

  entitlement_expiry := case
    when matched_key.duration_seconds is null then null
    else now() + make_interval(secs => matched_key.duration_seconds)
  end;

  update public.license_keys
     set redeemed_at = now(), redeemed_by = auth.uid()
   where id = matched_key.id;

  insert into public.control_entitlements (user_id, license_key_id, expires_at)
  values (auth.uid(), matched_key.id, entitlement_expiry);

  return jsonb_build_object('allowed', true, 'expires_at', entitlement_expiry);
end;
$$;

revoke all on function public.control_access_status() from public, anon;
revoke all on function public.redeem_license_key(text) from public, anon;
grant execute on function public.control_access_status() to authenticated;
grant execute on function public.redeem_license_key(text) to authenticated;

revoke all on public.license_keys from anon, authenticated;
revoke all on public.control_entitlements from anon;
grant select on public.control_entitlements to authenticated;
