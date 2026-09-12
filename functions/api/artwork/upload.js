/**
 * Uploads crowd-sourced artwork to the R2 bucket.
 * Validates that no artwork exists for this device name before uploading.
 *
 * Keyed purely by the device's own reported name — never by VID:PID. A USB
 * id is not always unique to one physical product (several brands reuse the
 * same receiver or ODM board), while the name is what's actually specific to
 * the product connected. The panel already resolves its built-in art the
 * same way (see src/ui/device-images.ts), so crowd art follows suit.
 *
 * POST /api/artwork/upload
 * Body: { displayName: string, dataUrl: string }
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

// PNG/WebP only — JPEG can't carry an alpha channel, and this artwork is
// composited over the device panel, so it needs a transparent background.
const DATA_URL_RE = /^data:image\/(png|webp);base64,(.+)$/;

function slugifyName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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

  const { displayName, dataUrl } = body;

  if (typeof displayName !== "string" || displayName.length > 100) {
    return json({ message: "Invalid displayName." }, 400);
  }

  const nameSlug = slugifyName(displayName);
  if (!nameSlug) {
    return json({ message: "This device has no usable name yet — reconnect it and try again once it's fully read." }, 400);
  }

  if (typeof dataUrl !== "string") {
    return json({ message: "Invalid data URL." }, 400);
  }

  const dataUrlMatch = dataUrl.match(DATA_URL_RE);
  if (!dataUrlMatch) {
    return json({ message: "Invalid image data URL format." }, 400);
  }

  const ext = dataUrlMatch[1];
  const contentType = `image/${ext}`;
  const base64Data = dataUrlMatch[2];
  const filename = `${nameSlug}.${ext}`;
  const objectKey = `crowd/${filename}`;

  // Checked by prefix, not by the exact key: the extension is part of the key
  // (crowd/{nameSlug}.{ext}), so a .head() on this one key alone would miss
  // an existing upload in the *other* format and let both land in the
  // bucket for the same device.
  const existing = await env.ARTWORK_BUCKET.list({ prefix: `crowd/${nameSlug}.` });
  if (existing.objects.length > 0) {
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
        contentType,
        cacheControl: "public, max-age=31536000",
      },
      customMetadata: {
        displayName,
        uploadedAt: new Date().toISOString(),
      },
    });

    return json({ ok: true });
  } catch (err) {
    return json({ message: "Failed to upload artwork." }, 500);
  }
}
