import type { ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { connectLabelText, t } from "../i18n";

export const OPENMOUSE_URL = "https://openmouse.app/";

export type DesktopPage = "home" | "dashboard" | "settings";

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
          <span className="app-sidebar-brand-version">{snapshot.buildLabel}</span>
        </a>

        <nav className="app-sidebar-nav">
          <button
            className={`app-sidebar-nav-item${page === "home" ? " active" : ""}`}
            type="button"
            title={t(locale, "nav.home")}
            onClick={() => onNavigate("home")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 22V12h6v10" />
            </svg>
            <span className="app-sidebar-nav-label">{t(locale, "nav.home")}</span>
          </button>
          <button
            className={`app-sidebar-nav-item${page === "dashboard" ? " active" : ""}`}
            type="button"
            title={t(locale, "nav.dashboard")}
            onClick={() => onNavigate("dashboard")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="2" width="14" height="20" rx="7" />
              <path d="M12 6v4" />
            </svg>
            <span className="app-sidebar-nav-label">{t(locale, "nav.dashboard")}</span>
          </button>
          <span className="app-sidebar-nav-sep" aria-hidden="true" />
          <a
            className="app-sidebar-nav-item"
            href="https://docs.openmouse.app"
            target="_blank"
            rel="noreferrer"
            title={t(locale, "nav.docs")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
            <span className="app-sidebar-nav-label">{t(locale, "nav.docs")}</span>
          </a>
          <a
            className="app-sidebar-nav-item"
            href="https://openmouse.app/supported"
            target="_blank"
            rel="noreferrer"
            title={t(locale, "nav.supported")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="app-sidebar-nav-label">{t(locale, "nav.supported")}</span>
          </a>
          <button
            className="app-sidebar-nav-item"
            type="button"
            title={t(locale, "nav.whatsNew")}
            onClick={onOpenWhatsNew}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l2 5.2 5.7.4-4.4 3.7 1.4 5.6L12 14.8 7.3 17.9l1.4-5.6L4.3 8.6l5.7-.4 2-5.2z" />
            </svg>
            <span className="app-sidebar-nav-label">{t(locale, "nav.whatsNew")}</span>
          </button>
        </nav>
      </div>

      <div className="app-sidebar-bottom">
        <button
          className="app-sidebar-nav-item"
          type="button"
          title={t(locale, "nav.feedback")}
          onClick={onOpenFeedback}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="app-sidebar-nav-label">{t(locale, "nav.feedback")}</span>
        </button>
        <button
          className={`app-sidebar-nav-item${page === "settings" ? " active" : ""}`}
          type="button"
          title={t(locale, "nav.settings")}
          onClick={() => onNavigate("settings")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="app-sidebar-nav-label">{t(locale, "nav.settings")}</span>
        </button>
        <button
          className="app-sidebar-nav-item connect-nav"
          type="button"
          title={connectLabelText(locale, snapshot.connectLabel)}
          disabled={snapshot.connectDisabled}
          onClick={() => void control.connect()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="app-sidebar-nav-label">{snapshot.connectLabel}</span>
        </button>
      </div>
    </aside>
  );
}