# Protected mouse voting

Voting is handled by a same-origin Cloudflare Pages Function. The browser solves
Turnstile, the function validates the one-use token, and Supabase records a keyed
hash of the Cloudflare-provided client IP. Raw IP addresses are never stored.

## Behavior

- Reusing an IP for the same mouse is rejected.
- Each IP hash can vote for at most five different mice per rolling 24-hour
  window.
- Each IP hash may create at most two protected submissions per rolling
  seven-day window. A new request starts with zero votes, and the requester may
  vote through the normal protected vote button.

## Setup

Setup is performed by a maintainer on the Cloudflare Pages and Supabase
dashboards. Public browser-facing values are provided at runtime by the Pages
Function; any credential configured for verification, hashing, or database
access lives only in the platform secret stores — never in this repository or
in code shipped to the browser.