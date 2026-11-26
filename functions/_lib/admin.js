// Shared admin-token check used by the site guard (functions/_middleware.js)
// and the admin endpoints under functions/api/admin/*.
//
// The token is a shared secret in env.ADMIN_TOKEN. Every helper here fails
// closed: an unset secret means "not admin", never "trusted".

export const ADMIN_UNBAN_PATH = "/api/admin/unban";

// Constant-time string compare — a plain `===` leaks the token prefix one byte
// at a time to a patient attacker.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function tokenFrom(request) {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1].trim();
  return request.headers.get("x-admin-token") ?? "";
}

export function isAdminRequest(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  return safeEqual(tokenFrom(request), expected);
}

/** The narrow case the guard exempts from a permanent IP ban: a correctly
    authenticated call to the unban endpoint itself. Nothing else qualifies, so
    a leaked token can't browse the site from a banned IP. */
export function isAdminUnbanRequest(request, env, pathname) {
  return pathname === ADMIN_UNBAN_PATH && isAdminRequest(request, env);
}
