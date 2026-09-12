/** Site-wide news banner. The message itself lives outside this repo's
    build — it is fetched from a CDN mirror of `public/news.json` so an
    announcement (an outage, a known-issue notice) can go out instantly
    without shipping a new app build. See `public/news.json` for the source
    file and how to publish an instant update. */

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

const LEVELS: NewsLevel[] = ["info", "warning", "critical"];

export async function fetchNews(signal?: AbortSignal): Promise<NewsItem | null> {
  const response = await fetch(NEWS_URL, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`News CDN returned HTTP ${response.status}.`);
  const body = await response.json() as NewsResponse;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!id || !message) return null;
  const level: NewsLevel = LEVELS.includes(body.level as NewsLevel) ? (body.level as NewsLevel) : "info";
  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : undefined;
  return { id, level, message, url };
}
