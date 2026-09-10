/**
 * Crowd-sourced artwork storage layer.
 * Fetches artwork list from API and caches in localStorage for quick access.
 */

const CACHE_KEY = "openmouse.crowd-artwork-cache";
const CACHE_TTL = 5 * 60 * 1000;

interface ArtworkEntry {
  vendorId: number;
  productId: number;
  filename: string;
}

interface ArtworkCache {
  entries: ArtworkEntry[];
  fetchedAt: number;
}

let cachedEntries: Map<string, string> | null = null;

function getCacheKey(vendorId: number, productId: number): string {
  const hex = (v: number) => v.toString(16).padStart(4, "0");
  return `${hex(vendorId)}:${hex(productId)}`;
}

function loadCacheFromStorage(): ArtworkCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: ArtworkCache = JSON.parse(raw);
    if (Date.now() - cache.fetchedAt > CACHE_TTL) return null;
    return cache;
  } catch {
    return null;
  }
}

function saveCacheToStorage(entries: ArtworkEntry[]): void {
  const cache: ArtworkCache = { entries, fetchedAt: Date.now() };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or blocked — silently continue
  }
}

function buildMap(entries: ArtworkEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    map.set(getCacheKey(entry.vendorId, entry.productId), entry.filename);
  }
  return map;
}

async function fetchArtworkList(): Promise<Map<string, string>> {
  try {
    const response = await fetch("/api/artwork/list", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return new Map();
    const text = await response.text();
    if (!text) return new Map();
    const data = JSON.parse(text);
    if (!Array.isArray(data.artworks)) return new Map();
    const entries: ArtworkEntry[] = data.artworks;
    saveCacheToStorage(entries);
    return buildMap(entries);
  } catch {
    return new Map();
  }
}

export async function loadCrowdArtworkCache(): Promise<void> {
  if (cachedEntries) return;
  cachedEntries = await fetchArtworkList();
}

export async function getArtworkMap(): Promise<Map<string, string>> {
  if (cachedEntries) return cachedEntries;

  const cached = loadCacheFromStorage();
  if (cached) {
    cachedEntries = buildMap(cached.entries);
    return cachedEntries;
  }

  cachedEntries = await fetchArtworkList();
  return cachedEntries;
}

export function getCrowdArtworkFilename(vendorId: number, productId: number): string | null {
  if (!cachedEntries) return null;
  return cachedEntries.get(getCacheKey(vendorId, productId)) ?? null;
}

export function hasCrowdArtwork(vendorId: number, productId: number): boolean {
  return getCrowdArtworkFilename(vendorId, productId) !== null;
}

export async function refreshArtworkCache(): Promise<void> {
  cachedEntries = await fetchArtworkList();
}

export async function uploadArtwork(
  vendorId: number,
  productId: number,
  displayName: string,
  dataUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/artwork/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, productId, displayName, dataUrl }),
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

    await refreshArtworkCache();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}
