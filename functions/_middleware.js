// Site-wide security guard. Runs before every Cloudflare Pages route — static
// pages, admin, and all /api/* endpoints. Tracks per-IP behavior, flags
// abuse/exploit attempts, and permanently bans repeat offenders.
//
// Storage: Durable state lives in a Cloudflare KV namespace bound as
// `SECURITY_KV` (Pages dashboard → Settings → Functions → KV namespace
// bindings → variable name `SECURITY_KV`). Without the binding the middleware
// passes every request through untouched, so the site never breaks on a
// missing binding.
//
// Keys:
//   ban:<ip>                → reason token ("security" | "artwork"); legacy
//                             "1" is treated as "security"; permanent until
//                             manually cleared
//   strikes:<ip>            → count, refreshed TTL
//   window:<ip>:<method>:<minute> → request count for the current minute
//
// Env:
//   RATE_LIMIT_MODE=waf     → skip the KV rate-limit counter entirely and rely
//                             on a WAF rate limiting rule at the edge instead.
//                             Unset keeps the KV limiter, so this is safe to
//                             deploy before the WAF rule exists.
//
// Twisting this file into a DoS doesn't work: middleware runs before functions
// and returns before any origin work is done. Rate counters self-expire, and a
// cleared strike bucket can't clear a permanent ban.

import { isAdminUnbanRequest } from "./_lib/admin.js";
import { hardenResponse } from "./_lib/security-headers.js";

const DISCORD_TICKET_URL = "https://discordapp.com/channels/1531814042421952644/1545272715072639117";

const BAN_REASONS = {
  security:
    "Repeated automated abuse or exploit attempts were detected from this IP address. The ban is permanent.",
  artwork:
    "Repeated artwork submissions were rejected by the review system. The ban is permanent.",
  default:
    "This IP address is permanently blocked from OpenMouse.",
};

// Full-bleed ban screen for permanently banned IPs. A plain response would be
// swallowed by the SPA's fetch handlers; this HTML renders as a standalone red
// page on any navigation.
const banPage = (reasonToken) => {
  const reason = BAN_REASONS[reasonToken] ?? BAN_REASONS.default;
  // The inline stylesheet needs a nonce because the canonical CSP has no
  // 'unsafe-inline'. The ban page is a Function response, so it declares its
  // own locked-down policy (no scripts, no external resources) instead of the
  // site-wide one applied by hardenResponse.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>You have been banned</title>
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #230707; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #fff; text-align: center; padding: 2rem; }
  .card { max-width: 34rem; }
  h1 { font-size: clamp(2rem, 6vw, 3.25rem); font-weight: 900; letter-spacing: .05em;
    text-transform: uppercase; color: #ff3b30; margin: 0 0 1.25rem;
    text-shadow: 0 0 26px rgba(255, 59, 48, 0.5); }
  .reason { font-size: 1.05rem; line-height: 1.6; color: #ffd9d6; margin: 0 0 2.25rem; }
  a { display: inline-block; padding: .9rem 1.7rem; border-radius: 10px;
    background: #5865f2; color: #fff; font-weight: 700; text-decoration: none; }
  a:hover { background: #4752c4; }
</style>
</head>
<body>
  <div class="card">
    <h1>You have been banned</h1>
    <p class="reason">${reason}</p>
    <a href="${DISCORD_TICKET_URL}" target="_blank" rel="noopener">Open a ticket on Discord</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
};

// Built lazily inside the handler, not at module scope — constructing a
// Response at global scope is exactly the kind of thing workerd's "no I/O
// outside a handler" rule blocks (it fails the whole Worker at startup, not
// just the request), even though nothing here looks like I/O.
const block = () => new Response("403 Forbidden", {
  status: 403,
  headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "3600" },
});

const tooMany = () => new Response("429 Too Many Requests", {
  status: 429,
  headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "60" },
});

const tooLarge = () => new Response("413 Payload Too Large", {
  status: 413,
  headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
});

// Clear exploit indicators in the URL path/query. Deliberately narrow to avoid
// blocking legit requests.
const EXPLOIT_RE = /(%00|%0a|%0d|%2e%2e|\.\.\/|\.\.%2f|<script|javascript:|__proto__|constructor\[|union\s+select|;\s*--|waitfor\s+delay|\beval\()/i;

// Static subresources (JS, CSS, images, fonts, media, the service worker and
// manifests) are served straight from Pages' edge and never touch an origin
// function. Running the per-request ban lookup and rate-limit counter over them
// is pure overhead: a single SPA page load fires dozens, and each one used to
// cost a KV read plus a write. They carry no exploit surface (no query parsing,
// no origin work), so the guard skips them wholesale.
//
// Everything that can do damage — document navigations, fetch/XHR calls
// (Sec-Fetch-Dest: empty), and any non-GET request — is still guarded. When
// Sec-Fetch-Dest is absent (curl, bots) the path extension decides; API routes
// and documents never carry an asset extension, so the fallback fails closed.
const ASSET_DESTS = new Set([
  "script", "style", "image", "font", "audio", "video", "track", "manifest", "worker",
]);
const ASSET_EXT_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg|wav|wasm|webmanifest)$/i;

function isStaticSubresource(request, url) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest) return ASSET_DESTS.has(dest.toLowerCase());
  return ASSET_EXT_RE.test(url.pathname);
}

const STRIKES_TO_BAN = 25;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const GET_LIMIT_PER_MINUTE = 240;
const POST_LIMIT_PER_MINUTE = 30;

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// Adds a strike; returns true when the threshold is crossed and the IP is now
// permanently banned.
async function strike(kv, ip) {
  const current = Number((await kv.get(`strikes:${ip}`)) ?? "0");
  const next = current + 1;
  if (next >= STRIKES_TO_BAN) {
    await kv.put(`ban:${ip}`, "security");
    return true;
  }
  await kv.put(`strikes:${ip}`, String(next), { expirationTtl: 7 * 24 * 3600 });
  return false;
}

async function enforceRateLimit(kv, request, ip) {
  const method = request.method.toUpperCase() === "GET" ? "get" : "post";
  const key = `window:${ip}:${method}:${Math.floor(Date.now() / 60_000)}`;
  const cap = method === "get" ? GET_LIMIT_PER_MINUTE : POST_LIMIT_PER_MINUTE;
  const count = Number((await kv.get(key)) ?? "0") + 1;
  await kv.put(key, String(count), { expirationTtl: 90 });
  return count > cap;
}

export async function onRequest(context) {
  return hardenResponse(await handle(context));
}

async function handle({ request, env, next }) {
  const kv = env.SECURITY_KV;
  if (!kv) return next();

  const ip = clientIp(request);
  const url = new URL(request.url);

  // Subresources are the bulk of traffic and the bulk of the KV bill; skip them
  // before any storage work.
  if (isStaticSubresource(request, url)) return next();

  // An admin who is themselves caught by a ban (shared/NAT IP) still has to
  // reach the unban endpoint, so that one path is exempt — and only when the
  // request carries the correct ADMIN_TOKEN, which the endpoint re-checks.
  const banReason = await kv.get(`ban:${ip}`);
  if (banReason && !isAdminUnbanRequest(request, env, url.pathname)) {
    return banPage(banReason === "1" ? "security" : banReason);
  }

  const method = request.method.toUpperCase();

  // When a WAF rate limiting rule is enforcing limits at the edge
  // (RATE_LIMIT_MODE=waf), the KV counter is redundant and costs a write per
  // guarded request. Anything else keeps the KV limiter.
  const kvRateLimit = env.RATE_LIMIT_MODE !== "waf";

  if (EXPLOIT_RE.test(url.href)) {
    await strike(kv, ip);
    return block();
  }

  // Block cross-site state-changing calls (browsers send Origin; same-site
  // requests here match the request's own origin).
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    await strike(kv, ip);
    return block();
  }

  if (method === "POST" && Number(request.headers.get("Content-Length") ?? "0") > MAX_BODY_BYTES) {
    await strike(kv, ip);
    return tooLarge();
  }

  if (kvRateLimit && await enforceRateLimit(kv, request, ip)) {
    await strike(kv, ip);
    return tooMany();
  }

  return next();
}