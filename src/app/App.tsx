import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { ensureLocale } from "../i18n";
import { interfaceThemeSlug } from "../interface-preferences";
import { AppSidebar, type DesktopPage } from "./AppSidebar";
import { OverviewPage } from "./OverviewPage";
import { CaptureDialog } from "./CaptureDialog";
import { FeedbackDialog } from "./FeedbackDialog";
import { GamesPage, useBridgeActive } from "./GamesPage";
import { HardwareTestPage } from "./HardwareTestPage";
import { InterfaceSettings } from "./InterfaceSettings";
import { NewsBanner } from "./NewsBanner";
import { PendingBar } from "./PendingBar";
import { ShareProfileDialog } from "./ShareProfileDialog";
import { WhatsNewDialog } from "./WhatsNewDialog";
import { AiOverlay } from "./AiOverlay";
import { ToastHost } from "./Toasts";
import { useBridgeBatteryReporter } from "./useBridgeBatteryReporter";
import { useBridgeProfileApplier } from "./useBridgeProfileApplier";
import { useControl } from "./useControl";
import { setSoundsEnabled } from "../sound-manager";

export function App(): ReactNode {
  const snapshot = useControl();
  useBridgeProfileApplier(snapshot);
  useBridgeBatteryReporter(snapshot);
  const panel = useRef<HTMLDivElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shareProfileOpen, setShareProfileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [page, setPage] = useState<DesktopPage>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { preferences, status } = snapshot;
  const locale = preferences.locale;
  const bridgeActive = useBridgeActive();
  // Games only exists while Bridge does — if it goes away, fall back to Home.
  const showingGames = page === "games" && bridgeActive;

  const showingSettings = page === "settings" || snapshot.interfaceSettingsOpen;

  const resolvedPage: DesktopPage = showingSettings
    ? "settings"
    : page === "hardware-test"
      ? "hardware-test"
        : showingGames
          ? "games"
          : status !== null && snapshot.deviceView === "device"
          ? "dashboard"
          : "home";

  useEffect(() => {
    try {
      const htmlLang: Record<typeof locale, string> = {
        pt: "pt-BR",
        es: "es",
        fr: "fr",
        de: "de",
        zh: "zh-CN",
        ja: "ja",
        ko: "ko",
        ru: "ru",
        vi: "vi",
        ar: "ar",
        en: "en",
      };
      const nextLang = htmlLang[locale] ?? "en";
      if (document.documentElement.lang !== nextLang) {
        document.documentElement.lang = nextLang;
      }
      // Arabic reads right-to-left; every other locale is left-to-right.
      const nextDir = locale === "ar" ? "rtl" : "ltr";
      if (document.documentElement.dir !== nextDir) {
        document.documentElement.dir = nextDir;
      }
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

  useEffect(() => {
    setSidebarCollapsed(resolvedPage === "dashboard");
  }, [resolvedPage]);

  useEffect(() => {
    setSoundsEnabled(preferences.enabledSounds);
  }, [preferences.enabledSounds]);

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
    } else if (next === "hardware-test") {
      control.showDeviceList();
      setPage("hardware-test");
    } else if (next === "games") {
      control.showDeviceList();
      setPage("games");
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
        sidebarCollapsed ? "sidebar-collapsed" : "",
        preferences.reducedMotion ? "reduce-interface-motion" : "",
        snapshot.pending.count > 0 ? "has-pending-changes" : "",
      ].filter(Boolean).join(" ")}
      data-interface-theme={interfaceThemeSlug(preferences.theme)}
    >
      <NewsBanner locale={locale} />
      <AppSidebar snapshot={snapshot} page={resolvedPage} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)} onNavigate={navigate} onOpenFeedback={() => setFeedbackOpen(true)} onOpenWhatsNew={() => setWhatsNewOpen(true)} />

      <main className="full-desktop-main">
        <div className="full-desktop-content" ref={panel}>
          {showingSettings ? (
            <InterfaceSettings snapshot={snapshot} />
          ) : page === "hardware-test" ? (
            <HardwareTestPage snapshot={snapshot} />
          ) : showingGames ? (
            <GamesPage snapshot={snapshot} />
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