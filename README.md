# OpenMouse

OpenMouse is a website for managing supported gaming mice in one place.

The goal is to let you connect a mouse, view its information, and change settings
like DPI and polling rate without installing a different app for every brand.

The website currently includes an interactive preview of the planned interface.
It is only a demo and does not make changes to a real mouse.

## Future plans

OpenMouse will begin with a small number of supported mice and grow one device at
a time. Future versions are planned to include verified device controls, more
supported models, and an offline-ready app.

OpenMouse is planned to become open-source software, but it is not currently
licensed for use, modification, or redistribution. A license will be selected
before the project's full release. You can follow its progress, suggest a
mouse, or share feedback through GitHub and the OpenMouse Discord.

## Control panel authentication

The control panel uses license codes only—users do not provide an email or
password. Supabase creates a persistent anonymous session in the background,
and Postgres verifies that session's license entitlement on every new visit.

Copy `.env.example` to `.env.local`, then set the project URL and the project's
publishable (or legacy `anon`) key. Never expose the `service_role` key through
a `VITE_` variable. In the Supabase dashboard, enable **Anonymous Sign-Ins**
under Authentication settings, then apply
`supabase/migrations/20260731000000_control_panel_auth.sql`.

License codes are one-time activations and only their SHA-256 hashes are stored. Generate
a random key outside the database, give the plaintext key to the customer once,
then insert its hash. For example, this creates a key that must be redeemed
within 30 days and grants 90 days of access after redemption:

```sql
insert into public.license_keys (key_hash, label, duration_seconds, redeem_before)
values (
  encode(digest(upper(trim('OM-REPLACE-WITH-A-RANDOM-KEY')), 'sha256'), 'hex'),
  'Customer or order reference',
  90 * 24 * 60 * 60,
  now() + interval '30 days'
);
```

Set `duration_seconds` to `null` for non-expiring access. Disabling a key before
redemption is done by setting `disabled_at`; revoking access is done by setting
`revoked_at` on the corresponding row in `control_entitlements`. Row-level
security prevents clients from listing keys or viewing another user's access.
The anonymous Supabase session persists in the browser, so returning users are
unlocked automatically until their entitlement expires or is revoked.
