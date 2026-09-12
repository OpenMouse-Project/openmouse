/**
 * Lists all crowd-sourced artworks from the R2 bucket.
 * Returns a JSON array of artwork entries with vendorId, productId, and filename.
 *
 * GET /api/artwork/list
 *
 * Response: { artworks: Array<{ vendorId: number, productId: number, filename: string, nameSlug?: string }> }
 *
 * A device whose id is shared across different physical products (see
 * upload.js's SHARED_PID_KEYS) uploads under `{vid}:{pid}:{nameSlug}.{ext}`
 * instead of the plain `{vid}:{pid}.{ext}` every other device uses, so two
 * different models behind one id each get their own entry here rather than
 * one clobbering the other.
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
      const named = filename.match(/^([0-9a-f]{4}):([0-9a-f]{4}):([a-z0-9-]+)\.(png|webp)$/i);
      if (named) {
        const vendorId = parseInt(named[1], 16);
        const productId = parseInt(named[2], 16);
        artworks.push({ vendorId, productId, filename, nameSlug: named[3].toLowerCase() });
        continue;
      }
      const plain = filename.match(/^([0-9a-f]{4}):([0-9a-f]{4})\.(png|webp)$/i);
      if (plain) {
        const vendorId = parseInt(plain[1], 16);
        const productId = parseInt(plain[2], 16);
        artworks.push({ vendorId, productId, filename });
      }
    }

    return json({ artworks });
  } catch {
    return json({ artworks: [] });
  }
}
