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

/**
 * Access is gated by a single Discord server role (e.g. "dev") rather than a
 * list of individual Discord user ids — add/remove the role in Discord to
 * grant/revoke dashboard access, no env var edits needed per person.
 * `SUPPORT_STAFF_ROLE_ID` is that role's Discord role id; `DISCORD_GUILD_ID`
 * is the server it lives in.
 *
 * There is only one staff tier now. The DB's `staff_role` enum is left as-is
 * (unchanged schema); every staff member is simply recorded as `SUPPORT`.
 */
export const STAFF_ROLE = "SUPPORT";

/** True if the Discord user currently holds the configured staff role in the guild. */
export async function isStaffMember(env, discordId) {
  const { DISCORD_GUILD_ID, DISCORD_BOT_TOKEN, SUPPORT_STAFF_ROLE_ID } = env;
  if (!DISCORD_GUILD_ID || !DISCORD_BOT_TOKEN || !SUPPORT_STAFF_ROLE_ID) return false;
  const response = await fetch(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`,
    { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
  );
  if (!response.ok) return false; // 404 = not a guild member (or removed)
  const member = await response.json().catch(() => null);
  return Array.isArray(member?.roles) && member.roles.includes(SUPPORT_STAFF_ROLE_ID);
}

/**
 * Resolves the staff role for each of a batch of Discord ids in one pass
 * (deduped), returning a plain synchronous lookup. Used where a list of
 * Discord message authors needs to be classified as staff/user without
 * threading async through a `.map()` (e.g. mapDiscordMessage).
 */
export async function buildIsStaffAuthor(env, discordIds) {
  const unique = [...new Set(discordIds.filter(Boolean))];
  const results = await Promise.all(unique.map((id) => isStaffMember(env, id)));
  const staffIds = new Set(unique.filter((_, i) => results[i]));
  return (discordId) => staffIds.has(discordId);
}

/** Every logged-in session already holds the single staff role. */
export function canAccess(role) {
  return role === STAFF_ROLE;
}

/** Single tier now — any authenticated staff member can manage participants. */
export function canManageStaff(role) {
  return role === STAFF_ROLE;
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
