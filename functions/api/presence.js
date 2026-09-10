// Lightweight "who's looking at this page right now" presence for the launch
// countdown and the control app. Each open tab heartbeats its own session id
// periodically (paused while the tab is hidden). Backed by a Cloudflare KV
// namespace bound as `PRESENCE_KV` (Pages dashboard → Settings → Functions →
// KV namespace bindings → variable name `PRESENCE_KV`) — approximate on
// purpose, no analytics, no IPs stored, nothing tied to a person. The session
// ids are only used client-side to animate a little critter per visitor;
// they're random and meaningless on their own.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A heartbeat that doesn't land within this window is considered stale.
// Comfortably longer than the client's heartbeat interval so a slow network
// tick doesn't drop someone from the count.
const PRESENCE_TTL_SECONDS = 90;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json({ message: "Origin not allowed." }, 403);

  const { sessionId } = await request.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return json({ message: "Invalid session id." }, 400);
  }

  const kv = env.PRESENCE_KV;
  if (!kv) return json({ count: null, ids: [] });

  await kv.put(`presence:${sessionId}`, "1", { expirationTtl: PRESENCE_TTL_SECONDS });

  const ids = [];
  const list = await kv.list({ prefix: "presence:" });
  for (const key of list.keys) ids.push(key.name.slice("presence:".length));

  return json({ count: ids.length, ids });
}
