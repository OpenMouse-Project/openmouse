/**
 * Crowd-sourced artwork upload. The read/cache side lives in device-images.ts
 * (`loadCrowdArtworkCache`/`refreshCrowdArtworkCache`/`deviceImage`) — this
 * module only submits a new upload and asks that cache to refresh.
 */

export async function uploadArtwork(
  displayName: string,
  dataUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/artwork/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, dataUrl }),
    });

    const text = await response.text();
    if (!text) {
      if (!response.ok) return { ok: false, error: "Upload failed" };
      return { ok: true };
    }
    const result = JSON.parse(text);

    if (!response.ok) {
      return { ok: false, error: result.message ?? "Upload failed" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}
