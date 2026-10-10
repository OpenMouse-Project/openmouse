import assert from "node:assert/strict";
import test from "node:test";
import { fetchDiscordCounts, renderDiscordCard } from "../functions/_lib/discord-card.js";
import { onRequest } from "../functions/api/discord-card.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("fetchDiscordCounts reads approximate member and online counts", async () => {
  const counts = await fetchDiscordCounts(async () =>
    jsonResponse({ approximate_member_count: 2140, approximate_presence_count: 312 }));
  assert.deepEqual(counts, { members: 2140, online: 312 });
});

test("fetchDiscordCounts returns null on errors and bad payloads", async () => {
  assert.equal(await fetchDiscordCounts(async () => jsonResponse({}, 404)), null);
  assert.equal(await fetchDiscordCounts(async () => jsonResponse({ approximate_member_count: 5 })), null);
  assert.equal(await fetchDiscordCounts(async () => { throw new Error("offline"); }), null);
});

test("renderDiscordCard shows formatted counts", () => {
  const svg = renderDiscordCard({ members: 12345, online: 678 });
  assert.match(svg, /678 online/);
  assert.match(svg, /12,345 members/);
  assert.doesNotMatch(svg, /dev updates/);
});

test("renderDiscordCard falls back to the tagline without counts", () => {
  const svg = renderDiscordCard(null);
  assert.match(svg, /Help, device requests &amp; dev updates/);
  assert.doesNotMatch(svg, /\d online/);
});

test("discord-card endpoint serves an embeddable SVG", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ approximate_member_count: 100, approximate_presence_count: 7 }));
  const response = await onRequest({ request: new Request("https://control.openmouse.app/api/discord-card") });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /^image\/svg\+xml/);
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.match(response.headers.get("Cache-Control") ?? "", /max-age=600/);
  assert.match(await response.text(), /7 online/);
});

test("discord-card endpoint caches failures briefly and rejects writes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({}, 500));
  const failed = await onRequest({ request: new Request("https://control.openmouse.app/api/discord-card") });
  assert.match(failed.headers.get("Cache-Control") ?? "", /max-age=60\b/);

  const post = await onRequest({ request: new Request("https://control.openmouse.app/api/discord-card", { method: "POST" }) });
  assert.equal(post.status, 405);
});
