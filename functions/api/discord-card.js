// GET /api/discord-card — the README's Discord card with live member and
// online counts (see functions/_lib/discord-card.js).
//
// GitHub serves README images through its camo proxy, which fetches this URL
// server-side and caches it, so traffic here is light. The rendered card is
// also kept in Cloudflare's edge cache for CACHE_SECONDS so Discord is asked
// at most a few times an hour per colo.

import { fetchDiscordCounts, renderDiscordCard } from "../_lib/discord-card.js";

const CACHE_SECONDS = 600;

export async function onRequest({ request, waitUntil }) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("405 Method Not Allowed", {
      status: 405,
      headers: { "Content-Type": "text/plain", Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(new URL(request.url).origin + "/api/discord-card", { method: "GET" });
  const cached = cache ? await cache.match(cacheKey) : undefined;
  if (cached) return method === "HEAD" ? new Response(null, cached) : cached;

  const counts = await fetchDiscordCounts();
  const ok = !counts.error;
  // A failed lookup is cached briefly so a Discord outage can't pin the
  // fallback card for the full window.
  const maxAge = ok ? CACHE_SECONDS : 60;
  const response = new Response(renderDiscordCard(ok ? counts : null), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      // The card is embedded cross-origin (GitHub), and as an SVG it only
      // needs its own inline <style>; no scripts or external loads.
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      // Which lookup produced the counts, or why none did; for diagnosing the
      // fallback card without access to the Worker logs.
      "X-Discord-Counts": ok ? counts.source : `failed: ${counts.error}`.slice(0, 200),
    },
  });

  if (cache) {
    const store = cache.put(cacheKey, response.clone());
    if (typeof waitUntil === "function") waitUntil(store);
    else await store;
  }
  return method === "HEAD" ? new Response(null, response) : response;
}
