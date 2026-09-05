// Shared helpers for the gated admin dashboard: a signed, httpOnly cookie
// session backed by a single shared password (env.ADMIN_PASSWORD) — this
// is a single-operator dashboard, not a multi-user auth system.

const COOKIE_NAME = "om_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

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

/** Builds the Set-Cookie value for a fresh admin session, valid for SESSION_TTL_SECONDS. */
export async function createSessionCookie(secret) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const signature = await hmac(String(expiresAt), secret);
  return `${COOKIE_NAME}=${expiresAt}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** Verifies the request's admin cookie against the shared secret. */
export async function hasValidSession(request, secret) {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const [expiresAtRaw, signature] = decodeURIComponent(match[1]).split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAt || Date.now() > expiresAt) return false;
  const expected = await hmac(expiresAtRaw, secret);
  return expected === signature;
}

export const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
});
