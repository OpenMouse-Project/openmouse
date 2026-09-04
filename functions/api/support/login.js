import { json, safeRedirect } from "./_session.js";

/**
 * GET /api/support/login?redirect=/support
 * Starts Discord OAuth2. Generates and stores a random anti-CSRF `state` in a
 * short-lived cookie, then redirects the browser to Discord's authorize URL.
 * Staff whitelist is checked on the callback, not here.
 */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);

  const { DISCORD_CLIENT_ID, SUPPORT_SESSION_SECRET, SUPPORT_BASE_URL } = env;
  if (!DISCORD_CLIENT_ID || !SUPPORT_SESSION_SECRET || !SUPPORT_BASE_URL) {
    return json({ message: "Support login is not configured." }, 503);
  }

  const url = new URL(request.url);
  const redirect = safeRedirect(url.searchParams.get("redirect"));

  const state = crypto.randomUUID();
  const stateCookie = `om_support_state=${state}; Path=/api/support/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

  const callbackUrl = `${SUPPORT_BASE_URL.replace(/\/$/, "")}/api/support/callback`;
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", DISCORD_CLIENT_ID);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", callbackUrl);
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);
  // Ask Discord which guild the user is in; we still authorize purely by
  // whitelist ids so no extra permission is strictly needed beyond identify.

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": stateCookie,
      "Cache-Control": "no-store",
    },
  });
}
