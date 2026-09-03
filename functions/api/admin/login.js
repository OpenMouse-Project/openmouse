import { createSessionCookie, json } from "./_session.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ message: "Origin not allowed." }, 403);

  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({ message: "Admin dashboard is not configured." }, 503);
  }

  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== "string" || password !== env.ADMIN_PASSWORD) {
    // Deliberately no rate limiting beyond what Cloudflare provides by
    // default — this sits behind noindex + an obscure path, not meant to
    // withstand sustained brute forcing. Rotate ADMIN_PASSWORD if abused.
    return json({ message: "Incorrect password." }, 401);
  }

  const cookie = await createSessionCookie(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}
