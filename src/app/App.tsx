import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { ensureLocale, t } from "../i18n";
import { interfaceThemeSlug } from "../interface-preferences";
import { AppSidebar, type DesktopPage } from "./AppSidebar";
import { OverviewPage } from "./OverviewPage";
import { CaptureDialog } from "./CaptureDialog";
import { FeedbackDialog } from "./FeedbackDialog";
import { InterfaceSettings } from "./InterfaceSettings";
import { ShareProfileDialog } from "./ShareProfileDialog";
import { WhatsNewDialog } from "./WhatsNewDialog";
import { AiOverlay } from "./AiOverlay";
import { ToastHost } from "./Toasts";
import { useControl } from "./useControl";
import { DiscordIcon, DISCORD_URL, GitHubIcon, GITHUB_URL, TwitterIcon, TWITTER_URL } from "./social-links";

export function App(): ReactNode {
  const snapshot = useControl();
  const panel = useRef<HTMLDivElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shareProfileOpen, setShareProfileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [page, setPage] = useState<DesktopPage>("home");
  const { preferences, status } = snapshot;
  const locale = preferences.locale;

  const showingSettings = page === "settings" || snapshot.interfaceSettingsOpen;

  const resolvedPage: DesktopPage = showingSettings
    ? "settings"
    : status !== null && snapshot.deviceView === "device"
      ? "dashboard"
      : "home";

  useEffect(() => {
    try {
      document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
    } catch {
      /* non-DOM environment (tests) */
    }
    // A stored non-English locale resolves its table after first paint;
    // re-render once it arrives instead of sticking on fallback strings.
    if (locale !== "en") void ensureLocale(locale).then(() => control.refreshInterface());
  }, [locale]);

  useEffect(() => {
    panel.current?.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" });
  }, [page, snapshot.workspaceTab, preferences.reducedMotion]);

  function navigate(next: DesktopPage): void {
    if (next === "settings") {
      control.openInterfaceSettings();
      setPage("settings");
      return;
    }
    control.closeInterfaceSettings();
    if (next === "dashboard") {
      void control.showDeviceDashboard();
      setPage("dashboard");
    } else {
      control.showDeviceList();
      setPage("home");
    }
  }

  return (
    <div
      className={[
        "control-shell",
        "full-desktop-shell",
        status ? "" : "is-empty",
        preferences.reducedMotion ? "reduce-interface-motion" : "",
        snapshot.pending.count > 0 ? "has-pending-changes" : "",
      ].filter(Boolean).join(" ")}
      data-interface-theme={interfaceThemeSlug(preferences.theme)}
    >
      <AppSidebar snapshot={snapshot} page={resolvedPage} onNavigate={navigate} onOpenFeedback={() => setFeedbackOpen(true)} onOpenWhatsNew={() => setWhatsNewOpen(true)} />

      <main className="full-desktop-main">
        <div className="full-desktop-content" ref={panel}>
          {showingSettings ? (
            <InterfaceSettings snapshot={snapshot} />
          ) : (
            <OverviewPage
              snapshot={snapshot}
              onOpenCapture={() => setCaptureOpen(true)}
              onShareProfile={() => setShareProfileOpen(true)}
            />
          )}
          <p className="app-live-region" role="status" aria-live="polite">
            {snapshot.readStatus}
          </p>
        </div>
        <footer className="app-footer">
          <a className="app-donate" href="https://openmouse.app/donate.html" target="_blank" rel="noreferrer">
            <span className="app-donate-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.5 6H16V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5V11c0 3.31 2.69 6 6 6h2c3.31 0 6-2.69 6-6v-.5h1a2.5 2.5 0 0 0 0-5h-1.5zm0 3.5h-1V7h1a1 1 0 0 1 0 2zM7.5 13.5V7h9v4.5c0 2.48-2.02 4.5-4.5 4.5h-2c-2.48 0-4.5-2.02-4.5-4.5zM6 19a1 1 0 0 1 1-1h10a1 1 0 0 1 0 2H7a1 1 0 0 1-1-1z"/></svg>
            </span>
            <span className="app-donate-text">{t(locale, "nav.support")}</span>
            <span className="app-donate-heart">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </span>
          </a>
          <span className="app-footer-socials">
            <a href={DISCORD_URL} target="_blank" rel="noreferrer" title="OpenMouse on Discord" aria-label="OpenMouse on Discord"><DiscordIcon /></a>
            <a href={TWITTER_URL} target="_blank" rel="noreferrer" title="OpenMouse on X" aria-label="OpenMouse on X"><TwitterIcon /></a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" title="OpenMouse on GitHub" aria-label="OpenMouse on GitHub"><GitHubIcon /></a>
          </span>
        </footer>
      </main>

      <CaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} locale={locale} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} locale={locale} />
      <WhatsNewDialog open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} locale={locale} />
      <ShareProfileDialog open={shareProfileOpen} onClose={() => setShareProfileOpen(false)} snapshot={snapshot} />
      <AiOverlay locale={locale} />
      <ToastHost toasts={snapshot.toasts} locale={locale} />
    </div>
  );
}