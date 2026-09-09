/**
 * Uploads crowd-sourced artwork to the R2 bucket.
 * Validates that no artwork exists for the device before uploading.
 *
 * POST /api/artwork/upload
 * Body: { vendorId: number, productId: number, displayName: string, dataUrl: string }
 *
 * Response: { ok: boolean, message?: string }
 */

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  },
});

const VENDOR_RE = /^[0-9a-f]{4}$/i;
const DATA_URL_RE = /^data:image\/(png|webp|jpeg|jpg);base64,(.+)$/;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) {
    return json({ message: "Origin not allowed." }, 403);
  }

  if (!env.ARTWORK_BUCKET) {
    return json({ message: "Artwork storage not configured." }, 503);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return json({ message: "Invalid request body." }, 400);
  }

  const { vendorId, productId, displayName, dataUrl } = body;

  if (typeof vendorId !== "number" || typeof productId !== "number") {
    return json({ message: "Invalid vendorId or productId." }, 400);
  }

  if (typeof displayName !== "string" || displayName.length > 100) {
    return json({ message: "Invalid displayName." }, 400);
  }

  if (typeof dataUrl !== "string") {
    return json({ message: "Invalid data URL." }, 400);
  }

  const dataUrlMatch = dataUrl.match(DATA_URL_RE);
  if (!dataUrlMatch) {
    return json({ message: "Invalid image data URL format." }, 400);
  }

  const ext = dataUrlMatch[1] === "jpg" ? "png" : dataUrlMatch[1];
  const base64Data = dataUrlMatch[2];
  const vendorHex = vendorId.toString(16).padStart(4, "0");
  const productHex = productId.toString(16).padStart(4, "0");
  const filename = `${vendorHex}:${productHex}.${ext}`;
  const objectKey = `crowd/${filename}`;

  const existing = await env.ARTWORK_BUCKET.head(objectKey);
  if (existing) {
    return json({ ok: true, message: "Artwork already exists." });
  }

  try {
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const maxSize = 5 * 1024 * 1024;
    if (binaryData.length > maxSize) {
      return json({ message: "Image too large (max 5MB)." }, 400);
    }

    await env.ARTWORK_BUCKET.put(objectKey, binaryData, {
      httpMetadata: {
        contentType: `image/${ext}`,
        cacheControl: "public, max-age=31536000",
      },
      customMetadata: {
        displayName,
        vendorId: vendorHex,
        productId: productHex,
        uploadedAt: new Date().toISOString(),
      },
    });

    return json({ ok: true });
  } catch (err) {
    return json({ message: "Failed to upload artwork." }, 500);
  }
}
