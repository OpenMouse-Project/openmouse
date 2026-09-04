// Shared helpers for the OpenMouse-Support staff dashboard: a signed, httpOnly
// cookie session backed by Discord OAuth2. Server-side authorization only — the
// browser never decides who is allowed in. The whitelist and role mapping live
// in this module via env vars; nothing sensitive is sent to the client.

const COOKIE_NAME = "om_support_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Session payload is { discordId, role, name } — signed, never tamper-proof alone.
 * Cookie value is `encodeURIComponent("<expiresAt>|<json>")."<hexsig>"`
 * (the encoded body never contains a literal `.` or `|`, so parsing is unambiguous).
 * Path=/ so it is sent to the /api/support/... endpoints (the dashboard routes
 * live there; a /support-prefixed path would never match).
 */
export async function createSessionCookie(secret, payload) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const body = `${expiresAt}|${JSON.stringify(payload)}`;
  const signature = await hmac(body, secret);
  return `${COOKIE_NAME}=${encodeURIComponent(body)}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** Returns the verified session payload, or null if invalid/expired. */
export async function readSession(request, secret) {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const parts = match[1].split(".");
  if (parts.length !== 2) return null;
  const [encodedBody, signature] = parts;
  if (!encodedBody || !signature) return null;
  let body;
  try {
    body = decodeURIComponent(encodedBody);
  } catch {
    return null;
  }
  const expected = await hmac(body, secret);
  if (expected !== signature) return null;
  const sep = body.indexOf("|");
  if (sep === -1) return null;
  const expiresAtRaw = body.slice(0, sep);
  const payloadRaw = body.slice(sep + 1);
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAt || Date.now() > expiresAt) return null;
  try {
    return JSON.parse(payloadRaw);
  } catch {
    return null;
  }
}

/** Convenience: reject with 401 unless a valid session exists. */
export async function requireSession(request, env) {
  const session = await readSession(request, env.SUPPORT_SESSION_SECRET);
  if (!session) return null;
  return session;
}

/** Staff roles recognized by the dashboard (mirrors the DB enum). */
export const STAFF_ROLES = ["OWNER", "ADMIN", "DEVELOPER", "SUPPORT"];

/**
 * Resolves the role for a Discord id from configuration. Higher-priority lists
 * win. The whitelist is the set of ids allowed to log in at all; each list maps
 * to a role. Any id on the whitelist defaults to SUPPORT unless mapped higher.
 */
export function roleForId(env, discordId) {
  const maps = [
    { role: "OWNER", ids: (env.SUPPORT_OWNER_IDS ?? "") },
    { role: "ADMIN", ids: (env.SUPPORT_ADMIN_IDS ?? "") },
    { role: "DEVELOPER", ids: (env.SUPPORT_DEVELOPER_IDS ?? "") },
  ];
  for (const { role, ids } of maps) {
    if (ids.split(",").map((s) => s.trim()).filter(Boolean).includes(discordId)) return role;
  }
  return "SUPPORT";
}

/** Whitelist of Discord ids allowed to log in at all. */
export function isWhitelisted(env, discordId) {
  const whitelist = (env.SUPPORT_STAFF_WHITELIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!whitelist.length) return roleForId(env, discordId) !== "SUPPORT" || isExplicitlyWhitelisted(env, discordId);
  return whitelist.includes(discordId);
}

function isExplicitlyWhitelisted(env, discordId) {
  const all = [
    env.SUPPORT_OWNER_IDS,
    env.SUPPORT_ADMIN_IDS,
    env.SUPPORT_DEVELOPER_IDS,
    env.SUPPORT_WHITELIST_EXTRA,
  ]
    .filter(Boolean)
    .join(",");
  return all.split(",").map((s) => s.trim()).filter(Boolean).includes(discordId);
}

/** Authorization guard: at least SUPPORT role (all authenticated staff). */
export function canAccess(role) {
  return STAFF_ROLES.includes(role);
}

/** ADMIN or OWNER can manage staff/participants; SUPPORT/DEVELOPER can still work tickets. */
export function canManageStaff(role) {
  return role === "OWNER" || role === "ADMIN";
}

export const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
});

/** Simple synchronous constant-time string compare (for OAuth state etc.). */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Only allow same-origin relative redirect targets so the OAuth `redirect`
 * param cannot be abused as an open redirect. Anything absolute (contains a
 * scheme, host, or a protocol-relative `//`) falls back to the default.
 */
export function safeRedirect(raw, fallback = "/support") {
  if (!raw) return fallback;
  if (raw.startsWith("//") || !raw.startsWith("/")) return fallback;
  if (/[\\\r\n]/.test(raw)) return fallback;
  return raw;
}
