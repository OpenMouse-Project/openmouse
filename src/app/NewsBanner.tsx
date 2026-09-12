import { useEffect, useState, type ReactNode } from "react";
import { fetchNews, type NewsItem } from "../news";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

const DISMISSED_STORAGE_KEY = "openmouse.news.dismissed";
const POLL_INTERVAL_MS = 10 * 60 * 1000;

function dismissedId(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberDismissed(id: string): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, id);
  } catch {
    /* private mode / storage disabled */
  }
}

export function NewsBanner({ locale }: { locale: InterfaceLocale }): ReactNode {
  const [news, setNews] = useState<NewsItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const item = await fetchNews(controller.signal);
        if (!cancelled) setNews(item && item.id !== dismissedId() ? item : null);
      } catch {
        // The CDN being unreachable should never break the app; just skip
        // the banner for this cycle and try again on the next poll.
      }
    }

    void load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  if (!news) return null;

  function dismiss(): void {
    rememberDismissed(news!.id);
    setNews(null);
  }

  const body = news.url ? (
    <a className="news-banner-link" href={news.url} target="_blank" rel="noreferrer">
      {news.message}
    </a>
  ) : (
    <span className="news-banner-link">{news.message}</span>
  );

  return (
    <div className={`news-banner news-banner-${news.level}`} role="status">
      {body}
      <button
        type="button"
        className="news-banner-dismiss"
        onClick={dismiss}
        aria-label={t(locale, "common.close")}
      >
        ×
      </button>
    </div>
  );
}
