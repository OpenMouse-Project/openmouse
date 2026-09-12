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
// PNG/WebP only — JPEG can't carry an alpha channel, and this artwork is
// composited over the device panel, so it needs a transparent background.
const DATA_URL_RE = /^data:image\/(png|webp);base64,(.+)$/;

// VID:PID pairs (and, for WLMouse, a whole vendor id) known to be genuinely
// shared across different physical products — a receiver or ODM board reused
// by several models. Kept in sync by hand with the same list in
// src/ui/device-images.ts; duplicated here because these Functions run
// outside that module's build. For these, the object key includes a slug of
// the device's own reported name so two different models behind one shared
// id each get their own upload instead of clobbering one another the way a
// bare VID:PID key would.
const SHARED_PID_KEYS = new Set([
  "046d:c539", // Logitech Lightspeed receiver (G502 X, G703, G Pro Wireless, ...)
  "3151:402d", // GearHub 2.4 GHz receiver (Attack Shark R2, Lingbao M5 Pro)
  "3837:4030", "3837:4031", "3837:4032", "3837:4033", // MCHOSE A7 V3-generation receiver ids
  "093a:522c", "093a:622c", // Incott dongle / wired ids, shared by all six families
]);
const SHARED_PID_VENDOR_IDS = new Set([0x36a7]); // WLMouse — no single shared receiver PID

function isSharedPid(vendorId, productId, vendorHex, productHex) {
  return SHARED_PID_VENDOR_IDS.has(vendorId) || SHARED_PID_KEYS.has(`${vendorHex}:${productHex}`);
}

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

  const ext = dataUrlMatch[1];
  const contentType = `image/${ext}`;
  const base64Data = dataUrlMatch[2];
  const vendorHex = vendorId.toString(16).padStart(4, "0");
  const productHex = productId.toString(16).padStart(4, "0");

  const shared = isSharedPid(vendorId, productId, vendorHex, productHex);
  let keyBase = `${vendorHex}:${productHex}`;
  if (shared) {
    const nameSlug = slugifyName(displayName);
    if (!nameSlug) {
      return json({ message: "This device's id is shared with other models — a device name is required to tell them apart." }, 400);
    }
    keyBase += `:${nameSlug}`;
  }
  const filename = `${keyBase}.${ext}`;
  const objectKey = `crowd/${filename}`;

  // Checked by prefix, not by the exact key: the extension is part of the key
  // (crowd/{keyBase}.{ext}), so a .head() on this one key alone would miss an
  // existing upload in the *other* format and let both land in the bucket for
  // the same device — two objects the list endpoint can then only
  // arbitrarily pick between. For a shared id, keyBase already includes the
  // name slug, so this only matches the same model's other format, not a
  // different model sharing the same raw VID:PID.
  const existing = await env.ARTWORK_BUCKET.list({ prefix: `crowd/${keyBase}.` });
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
