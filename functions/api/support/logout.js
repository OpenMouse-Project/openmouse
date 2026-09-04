import { clearSessionCookie, json } from "./_session.js";

/** POST /api/support/logout — clears the staff session cookie. */
export async function onRequest({ request }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}
