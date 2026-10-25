export type NewsLevel = "info" | "warning" | "critical";

export interface NewsItem {
  id: string;
  level: NewsLevel;
  message: string;
  url?: string;
}

interface NewsResponse {
  id?: unknown;
  level?: unknown;
  message?: unknown;
  url?: unknown;
}

const NEWS_URL = "https://cdn.jsdelivr.net/gh/OpenMouse-Project/openmouse@main/public/news.json";

// Same-origin copy, shipped with every build. If the CDN is unreachable —
// offline, blocked by an ad blocker, or filtered on a corporate network — the
// notice still reaches users instead of silently disappearing.
const NEWS_FALLBACK_URL = "/news.json";

const LEVELS: NewsLevel[] = ["info", "warning", "critical"];

/** The notice text comes from a remote JSON file, so its link must not be able
    to become a `javascript:` (or other non-web) URL in the banner anchor. */
function safeNewsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw, "https://openmouse.app/");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

async function fetchNewsFrom(url: string, signal?: AbortSignal): Promise<NewsItem | null> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`News endpoint returned HTTP ${response.status}.`);
  const body = await response.json() as NewsResponse;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!id || !message) return null;
  const level: NewsLevel = LEVELS.includes(body.level as NewsLevel) ? (body.level as NewsLevel) : "info";
  return { id, level, message, url: safeNewsUrl(body.url) };
}

export async function fetchNews(signal?: AbortSignal): Promise<NewsItem | null> {
  try {
    return await fetchNewsFrom(NEWS_URL, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return fetchNewsFrom(NEWS_FALLBACK_URL, signal);
  }
}

