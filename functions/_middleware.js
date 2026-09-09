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
//   ban:<ip>                → "1", permanent until manually cleared
//   strikes:<ip>            → count, refreshed TTL
//   window:<ip>:<method>:<minute> → request count for the current minute
//
// Twisting this file into a DoS doesn't work: middleware runs before functions
// and returns before any origin work is done. Rate counters self-expire, and a
// cleared strike bucket can't clear a permanent ban.

const BLOCK = new Response("403 Forbidden", {
  status: 403,
  headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "3600" },
});

const TOO_MANY = new Response("429 Too Many Requests", {
  status: 429,
  headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "60" },
});

const TOO_LARGE = new Response("413 Payload Too Large", {
  status: 413,
  headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
});

// Clear exploit indicators in the URL path/query. Deliberately narrow to avoid
// blocking legit requests.
const EXPLOIT_RE = /(%00|%0a|%0d|%2e%2e|\.\.\/|\.\.%2f|<script|javascript:|__proto__|constructor\[|union\s+select|;\s*--|waitfor\s+delay|\beval\()/i;

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
    await kv.put(`ban:${ip}`, "1");
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

export async function onRequest({ request, env, next }) {
  const kv = env.SECURITY_KV;
  if (!kv) return next();

  const ip = clientIp(request);
  if (await kv.get(`ban:${ip}`)) return BLOCK;

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (EXPLOIT_RE.test(url.href)) {
    await strike(kv, ip);
    return BLOCK;
  }

  // Block cross-site state-changing calls (browsers send Origin; same-site
  // requests here match the request's own origin).
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    await strike(kv, ip);
    return BLOCK;
  }

  if (method === "POST" && Number(request.headers.get("Content-Length") ?? "0") > MAX_BODY_BYTES) {
    await strike(kv, ip);
    return TOO_LARGE;
  }

  if (await enforceRateLimit(kv, request, ip)) {
    await strike(kv, ip);
    return TOO_MANY;
  }

  return next();
}