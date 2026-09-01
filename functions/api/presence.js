// Lightweight "who's looking at this page right now" presence for the launch
// countdown. Each open tab heartbeats its own session id every few seconds; a
// key expires 60s after its last heartbeat, so the list is "sessions seen in
// the last ~60 seconds" rather than exact concurrency. Approximate on
// purpose — no analytics, no IPs stored, nothing tied to a person. The
// session ids are only used client-side to animate a little critter per
// visitor; they're random and meaningless on their own.
//
// 60s is also Cloudflare KV's minimum expirationTtl — anything lower throws.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEARTBEAT_TTL_SECONDS = 60;
const KEY_PREFIX = "presence:";
const MAX_IDS_RETURNED = 24;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json({ message: "Origin not allowed." }, 403);

  const { sessionId } = await request.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return json({ message: "Invalid session id." }, 400);
  }

  if (!env.PRESENCE_KV) return json({ count: null, ids: [] });

  await env.PRESENCE_KV.put(`${KEY_PREFIX}${sessionId}`, "1", { expirationTtl: HEARTBEAT_TTL_SECONDS });

  let count = 0;
  const ids = [];
  let cursor;
  do {
    const page = await env.PRESENCE_KV.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });
    count += page.keys.length;
    for (const key of page.keys) {
      if (ids.length < MAX_IDS_RETURNED) ids.push(key.name.slice(KEY_PREFIX.length));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return json({ count, ids });
}
