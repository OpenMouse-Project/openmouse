// Lightweight "how many people are looking at this page right now" counter
// for the launch countdown. Each open tab heartbeats its own session id every
// ~20s; a key expires 40s after its last heartbeat, so the count is "sessions
// seen in the last ~40 seconds" rather than exact concurrency. Approximate on
// purpose — no analytics, no IPs stored, nothing tied to a person.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEARTBEAT_TTL_SECONDS = 40;
const KEY_PREFIX = "presence:";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json({ message: "Origin not allowed." }, 403);

  const { sessionId } = await request.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return json({ message: "Invalid session id." }, 400);
  }

  if (!env.PRESENCE_KV) return json({ count: null });

  await env.PRESENCE_KV.put(`${KEY_PREFIX}${sessionId}`, "1", { expirationTtl: HEARTBEAT_TTL_SECONDS });

  let count = 0;
  let cursor;
  do {
    const page = await env.PRESENCE_KV.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });
    count += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return json({ count });
}
