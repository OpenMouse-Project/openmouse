/**
 * Lists all crowd-sourced artworks from the R2 bucket.
 * Returns a JSON array of artwork entries with nameSlug and filename.
 *
 * GET /api/artwork/list
 *
 * Response: { artworks: Array<{ nameSlug: string, filename: string }> }
 */

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300",
  },
});

export async function onRequest({ env }) {
  if (!env.ARTWORK_BUCKET) {
    return json({ artworks: [] });
  }

  try {
    const listed = await env.ARTWORK_BUCKET.list({ prefix: "crowd/" });
    const artworks = [];

    for (const object of listed.objects) {
      const filename = object.key.replace("crowd/", "");
      const match = filename.match(/^([a-z0-9-]+)\.(png|webp)$/i);
      if (match) {
        artworks.push({ nameSlug: match[1].toLowerCase(), filename });
      }
    }

    return json({ artworks });
  } catch {
    return json({ artworks: [] });
  }
}
