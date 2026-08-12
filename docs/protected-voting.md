# Protected mouse voting

Voting is handled by a same-origin Cloudflare Pages Function. The browser solves
Turnstile, the function validates the one-use token, and Supabase records a keyed
hash of the Cloudflare-provided client IP. Raw IP addresses are never stored.

## Setup

1. Run `supabase/migrations/20260812001000_protected_mouse_voting.sql` in the
   Supabase SQL editor. The old anonymous vote, request, and diagnostic RPCs must
   remain revoked.
2. Create a Turnstile widget for `openmouse.app`.
3. Add `VITE_TURNSTILE_SITE_KEY` as a Cloudflare Pages build environment
   variable. This is a public site key, not a secret. Rebuild the site after
   setting it.
4. Add these encrypted Pages secrets for the Function:
   - `TURNSTILE_SECRET_KEY`: the Turnstile widget secret
   - `VOTER_HASH_SECRET`: at least 32 random bytes; generate with
     `openssl rand -hex 32`
   - `SUPABASE_URL`: the project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: the legacy service-role JWT from Supabase
5. Deploy the `dev` build and verify a vote. Reusing an IP for the same mouse is
   rejected, and each IP hash can vote for at most five different mice per
   rolling 24-hour window.

Never prefix the service-role key, Turnstile secret, or voter-hash secret with
`VITE_`; Vite variables are included in browser code.
