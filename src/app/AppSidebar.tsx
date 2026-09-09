import type { ReactNode } from "react";
import type { ControlSnapshot } from "../device/types";
import { t } from "../i18n";

export const OPENMOUSE_URL = "https://openmouse.app/";

export type DesktopPage = "home" | "dashboard" | "settings";

function NavIcon({ d, color }: { d: string; color: string }): ReactNode {
  return (
    <svg className="app-sidebar-nav-icon" viewBox="0 0 24 24" fill="currentColor" style={{ color }} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function NavArrow(): ReactNode {
  return (
    <svg
      className="app-sidebar-nav-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </svg>
  );
}

export function AppSidebar({
  snapshot,
  page,
  onNavigate,
  onOpenFeedback,
  onOpenWhatsNew,
}: {
  snapshot: ControlSnapshot;
  page: DesktopPage;
  onNavigate: (page: DesktopPage) => void;
  onOpenFeedback: () => void;
  onOpenWhatsNew: () => void;
}): ReactNode {
  const locale = snapshot.preferences.locale;
  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-top">
        <a
          className="app-sidebar-brand"
          href={OPENMOUSE_URL}
          target="_blank"
          rel="noreferrer"
          title="OpenMouse"
          aria-label="OpenMouse"
        >
          <img className="brand-mark" src="/logo.png" alt="" width={16} height={24} />
          <span className="app-sidebar-brand-text">OpenMouse</span>
          <span className="app-sidebar-brand-version" title={snapshot.buildLabel}>
            {snapshot.buildLabel}
          </span>
        </a>

        <nav className="app-sidebar-nav">
          <button
            className={`app-sidebar-nav-item${page === "home" ? " active" : ""}`}
            type="button"
            title={t(locale, "nav.home")}
            onClick={() => onNavigate("home")}
          >
            <NavIcon d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" color="#5dde89" />
            <span className="app-sidebar-nav-label">{t(locale, "nav.home")}</span>
            <NavArrow />
          </button>
          <button
            className={`app-sidebar-nav-item${page === "dashboard" ? " active" : ""}`}
            type="button"
            title={t(locale, "nav.dashboard")}
            onClick={() => onNavigate("dashboard")}
          >
            <NavIcon d="M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z" color="#67d8ff" />
            <span className="app-sidebar-nav-label">{t(locale, "nav.dashboard")}</span>
            <NavArrow />
          </button>
          <a
            className="app-sidebar-nav-item"
            href="https://docs.openmouse.app"
            target="_blank"
            rel="noreferrer"
            title={t(locale, "nav.docs")}
          >
            <NavIcon d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" color="#e8b267" />
            <span className="app-sidebar-nav-label">{t(locale, "nav.docs")}</span>
            <NavArrow />
          </a>
        </nav>
      </div>

      <div className="app-sidebar-bottom">
        <button
          className="app-sidebar-nav-item"
          type="button"
          title={t(locale, "nav.whatsNew")}
          onClick={onOpenWhatsNew}
        >
          <NavIcon d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" color="#fbbf24" />
          <span className="app-sidebar-nav-label">{t(locale, "nav.whatsNew")}</span>
          <NavArrow />
        </button>
        <button
          className="app-sidebar-nav-item"
          type="button"
          title={t(locale, "nav.feedback")}
          onClick={onOpenFeedback}
        >
          <NavIcon d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" color="#fb923c" />
          <span className="app-sidebar-nav-label">{t(locale, "nav.feedback")}</span>
          <NavArrow />
        </button>
        <button
          className={`app-sidebar-nav-item${page === "settings" ? " active" : ""}`}
          type="button"
          title={t(locale, "nav.settings")}
          onClick={() => onNavigate("settings")}
        >
          <NavIcon d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" color="#94a3b8" />
          <span className="app-sidebar-nav-label">{t(locale, "nav.settings")}</span>
          <NavArrow />
        </button>
      </div>
    </aside>
  );
}