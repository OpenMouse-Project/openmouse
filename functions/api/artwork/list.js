/**
 * Lists all crowd-sourced artworks from the R2 bucket.
 * Returns a JSON array of artwork entries with vendorId, productId, and filename.
 *
 * GET /api/artwork/list
 *
 * Response: { artworks: Array<{ vendorId: number, productId: number, filename: string }> }
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
      const match = filename.match(/^([0-9a-f]{4}):([0-9a-f]{4})\.(png|webp)$/i);
      if (match) {
        const vendorId = parseInt(match[1], 16);
        const productId = parseInt(match[2], 16);
        artworks.push({ vendorId, productId, filename });
      }
    }

    return json({ artworks });
  } catch {
    return json({ artworks: [] });
  }
}
