import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { ensureLocale } from "../i18n";
import { interfaceThemeSlug } from "../interface-preferences";
import { AppSidebar, type DesktopPage } from "./AppSidebar";
import { OverviewPage } from "./OverviewPage";
import { CaptureDialog } from "./CaptureDialog";
import { FeedbackDialog } from "./FeedbackDialog";
import { InterfaceSettings } from "./InterfaceSettings";
import { MouseTestPage } from "./MouseTestPage";
import { PendingBar } from "./PendingBar";
import { ShareProfileDialog } from "./ShareProfileDialog";
import { WhatsNewDialog } from "./WhatsNewDialog";
import { AiOverlay } from "./AiOverlay";
import { ToastHost } from "./Toasts";
import { useControl } from "./useControl";

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
    : page === "test"
      ? "test"
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
    } else if (next === "test") {
      control.showDeviceList();
      setPage("test");
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
          ) : page === "test" ? (
            <MouseTestPage snapshot={snapshot} />
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
        <PendingBar snapshot={snapshot} />
      </main>

      <CaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} locale={locale} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} locale={locale} canAttachDiagnostics={status !== null} />
      <WhatsNewDialog open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} locale={locale} />
      <ShareProfileDialog open={shareProfileOpen} onClose={() => setShareProfileOpen(false)} snapshot={snapshot} />
      <AiOverlay locale={locale} />
      <ToastHost toasts={snapshot.toasts} locale={locale} />
    </div>
  );
}