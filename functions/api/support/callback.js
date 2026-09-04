import { createSessionCookie, json, STAFF_ROLE, isStaffMember, safeEqual, safeRedirect } from "./_session.js";

/**
 * GET /api/support/callback?code=...&state=...
 * Discord OAuth2 callback. Validates state (anti-CSRF), exchanges the code for
 * a token, fetches the user's Discord identity, then authorizes against the
 * staff whitelist BEFORE issuing a session. Sets the signed staff cookie and
 * redirects back to the dashboard.
 */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);

  const {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    SUPPORT_SESSION_SECRET,
    SUPPORT_BASE_URL,
  } = env;
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !SUPPORT_SESSION_SECRET || !SUPPORT_BASE_URL) {
    return json({ message: "Support login is not configured." }, 503);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const redirect = safeRedirect(url.searchParams.get("redirect"));

  if (!code || !state) return json({ message: "Missing OAuth parameters." }, 400);

  // Verify the anti-CSRF state cookie matches what we issued.
  const cookie = request.headers.get("Cookie") ?? "";
  const stateMatch = cookie.match(/(?:^|;\s*)om_support_state=([^;]+)/);
  const expectedState = stateMatch ? decodeURIComponent(stateMatch[1]) : null;
  if (!expectedState || !safeEqual(expectedState, state)) {
    return json({ message: "Invalid OAuth state." }, 403);
  }

  // Exchange code for a bearer token.
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${SUPPORT_BASE_URL.replace(/\/$/, "")}/api/support/callback`,
    }),
  });
  if (!tokenRes.ok) return json({ message: "Discord token exchange failed." }, 502);
  const token = await tokenRes.json().catch(() => null);
  if (!token?.access_token) return json({ message: "Discord token exchange failed." }, 502);

  // Fetch the user's identity.
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) return json({ message: "Could not fetch Discord identity." }, 502);
  const me = await meRes.json().catch(() => null);
  if (!me?.id) return json({ message: "Could not fetch Discord identity." }, 502);

  // Authorize: only holders of the configured Discord staff role may enter.
  if (!(await isStaffMember(env, me.id))) {
    return new Response("You are not authorized to access this support dashboard.", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const role = STAFF_ROLE;
  const sessionCookie = await createSessionCookie(env.SUPPORT_SESSION_SECRET, {
    discordId: me.id,
    role,
    name: me.username ?? "Staff",
  });

  // Persist/refresh the staff member in Supabase (best effort).
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/support_staff`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        discord_id: me.id,
        role,
        discord_username: me.username ?? null,
        last_login_at: new Date().toISOString(),
      }),
    }).catch(() => undefined);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirect,
      "Set-Cookie": sessionCookie,
      "Cache-Control": "no-store",
    },
  });
}
