// Lightweight "who's looking at this page right now" presence for the launch
// countdown. Each open tab heartbeats its own session id periodically
// (paused while the tab is hidden); backed by Supabase (the same project
// mouse-vote/mouse-request already use) via a single locked-down RPC —
// see supabase/migrations/20260901000000_page_presence.sql. Approximate on
// purpose — no analytics, no IPs stored, nothing tied to a person. The
// session ids are only used client-side to animate a little critter per
// visitor; they're random and meaningless on their own.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json({ message: "Origin not allowed." }, 403);

  const { sessionId } = await request.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return json({ message: "Invalid session id." }, 400);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ count: null, ids: [] });
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/heartbeat_page_presence`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    // request.cf.country is a Cloudflare-supplied ISO code, not derived
    // from anything we store client-side — feeds the admin dashboard's
    // region breakdown only, never surfaced to visitors.
    body: JSON.stringify({ p_session_id: sessionId, p_country: request.cf?.country ?? null }),
  });

  if (!response.ok) return json({ count: null, ids: [] });

  const result = await response.json().catch(() => null);
  const count = result && typeof result.count === "number" ? result.count : null;
  const ids = result && Array.isArray(result.ids) ? result.ids : [];
  return json({ count, ids });
}
