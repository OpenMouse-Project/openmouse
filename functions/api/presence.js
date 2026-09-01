// Lightweight "who's looking at this page right now" presence for the launch
// countdown. Each open tab heartbeats its own session id every few seconds; a
// key expires 60s after its last heartbeat, so the list is "sessions seen in
// the last ~60 seconds" rather than exact concurrency. Approximate on
// purpose — no analytics, no IPs stored, nothing tied to a person. The
// session ids are only used client-side to animate a little critter per
// visitor; they're random and meaningless on their own.
//
// Reactions are a fixed emoji palette only — no free text is ever accepted
// or broadcast, so there's nothing here to moderate.
//
// 60s is also Cloudflare KV's minimum expirationTtl — anything lower throws.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_REACTIONS = new Set(["👀", "🔥", "🎉", "🐭", "👍"]);
const HEARTBEAT_TTL_SECONDS = 60;
const REACTION_TTL_SECONDS = 60;
const PRESENCE_PREFIX = "presence:";
const REACTION_PREFIX = "reaction:";
const MAX_IDS_RETURNED = 24;
const MAX_REACTIONS_RETURNED = 24;

async function listAll(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json({ message: "Origin not allowed." }, 403);

  const { sessionId, reaction } = await request.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return json({ message: "Invalid session id." }, 400);
  }

  if (!env.PRESENCE_KV) return json({ count: null, ids: [], reactions: {} });

  await env.PRESENCE_KV.put(`${PRESENCE_PREFIX}${sessionId}`, "1", { expirationTtl: HEARTBEAT_TTL_SECONDS });

  if (typeof reaction === "string" && ALLOWED_REACTIONS.has(reaction)) {
    await env.PRESENCE_KV.put(
      `${REACTION_PREFIX}${sessionId}`,
      JSON.stringify({ emoji: reaction, ts: Date.now() }),
      { expirationTtl: REACTION_TTL_SECONDS },
    );
  }

  const presenceKeys = await listAll(env.PRESENCE_KV, PRESENCE_PREFIX);
  const ids = presenceKeys.slice(0, MAX_IDS_RETURNED).map((key) => key.name.slice(PRESENCE_PREFIX.length));

  const reactionKeys = (await listAll(env.PRESENCE_KV, REACTION_PREFIX)).slice(0, MAX_REACTIONS_RETURNED);
  const reactionValues = await Promise.all(reactionKeys.map((key) => env.PRESENCE_KV.get(key.name)));
  const reactions = {};
  reactionKeys.forEach((key, index) => {
    const raw = reactionValues[index];
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.emoji === "string" && typeof parsed.ts === "number") {
        reactions[key.name.slice(REACTION_PREFIX.length)] = parsed;
      }
    } catch {
      // Ignore a corrupt entry rather than failing the whole request.
    }
  });

  return json({ count: presenceKeys.length, ids, reactions });
}
