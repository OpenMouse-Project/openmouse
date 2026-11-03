import { displayText } from "../../i18n/index";
import { AlertTriangle, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { fetchNews, type NewsItem, type NewsLevel } from "./news";
import { t } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";

const LEVEL_ICON: Record<NewsLevel, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  critical: OctagonAlert,
};

const DISMISSED_STORAGE_KEY = "openmouse.news.dismissed";
const POLL_INTERVAL_MS = 10 * 60 * 1000;
const BACKOFF_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Warnings and critical notices (a known issue users keep hitting) are only
 * dismissed for the current session, so closing them cannot permanently hide
 * the message from someone who needs it. Info notices stay dismissed forever.
 */
function dismissalStore(level: NewsLevel): Storage {
  return level === "info" ? window.localStorage : window.sessionStorage;
}

function dismissedId(level: NewsLevel): string | null {
  try {
    return dismissalStore(level).getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberDismissed(id: string, level: NewsLevel): void {
  try {
    dismissalStore(level).setItem(DISMISSED_STORAGE_KEY, id);
  } catch {
  }
}

export function NewsBanner({ locale }: { locale: InterfaceLocale }): ReactNode {
  const [news, setNews] = useState<NewsItem | null>(null);

  useEffect(() => {
    let mounted = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    function schedule(delay: number): void {
      clearTimeout(timer as unknown as ReturnType<typeof setTimeout>);
      timer = setTimeout(() => void load(), delay);
    }

    async function load(): Promise<void> {
      if (!mounted || controller.signal.aborted) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule(failures >= 3 ? BACKOFF_INTERVAL_MS : POLL_INTERVAL_MS);
        return;
      }
      const attempt = new AbortController();
      const onAbort = (): void => attempt.abort();
      controller.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const item = await fetchNews(attempt.signal);
        if (!mounted || controller.signal.aborted) return;
        failures = 0;
        setNews(item && item.id !== dismissedId(item.level) ? item : null);
        schedule(POLL_INTERVAL_MS);
      } catch {
        if (!mounted || controller.signal.aborted) return;
        failures += 1;
        schedule(failures >= 3 ? BACKOFF_INTERVAL_MS : POLL_INTERVAL_MS);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
    }

    function onVisible(): void {
      if (!document.hidden) load();
    }
    document.addEventListener("visibilitychange", onVisible);

    void load();
    return () => {
      mounted = false;
      controller.abort();
      clearTimeout(timer as unknown as ReturnType<typeof setTimeout>);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!news) return null;

  function dismiss(): void {
    rememberDismissed(news!.id, news!.level);
    setNews(null);
  }

  const body = news.url ? (
    <a className="news-banner-link" href={news.url} target="_blank" rel="noreferrer">
      {displayText(locale, news.message)}
    </a>
  ) : (
    <span className="news-banner-link">{displayText(locale, news.message)}</span>
  );
  const Icon = LEVEL_ICON[news.level];

  return (
    <div
      className={`news-banner news-banner-${news.level}`}
      role={news.level === "critical" ? "alert" : "status"}
    >
      <Icon className="news-banner-icon" size={15} strokeWidth={2.2} aria-hidden="true" />
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
