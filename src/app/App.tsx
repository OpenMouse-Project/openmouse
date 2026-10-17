import { displayText } from "../i18n/index";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { ensureDisplayLocale } from "../i18n/index";
import { interfaceThemeSlug } from "../features/settings/interface-preferences";
import { AppSidebar, type DesktopPage } from "./AppSidebar";
import { OverviewPage } from "../features/devices/OverviewPage";
import { CaptureDialog } from "../features/capture/CaptureDialog";
import { GamesPage } from "../features/games/GamesPage";
import { HardwareTestPage } from "../features/hardware-test/HardwareTestPage";
import { InterfaceSettings } from "../features/settings/InterfaceSettings";
import { NewsBanner } from "../features/news/NewsBanner";
import { PendingBar } from "./PendingBar";
import { HelpPanel } from "./HelpPanel";
import { ShareProfileDialog } from "../features/profiles/ShareProfileDialog";
import { WhatsNewDialog } from "../features/news/WhatsNewDialog";
import { ToastHost } from "./Toasts";
import { useBridgeBatteryReporter } from "../features/bridge/useBridgeBatteryReporter";
import { useBridgeProfileApplier } from "../features/bridge/useBridgeProfileApplier";
import { useControl } from "./useControl";
import { setSoundsEnabled } from "../platform/sound-manager";
import { UiLocaleContext } from "../shared/ui-locale";

const SIDEBAR_KEY = "openmouse-sidebar-collapsed-v1";

function initialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function App(): ReactNode {
  const snapshot = useControl();
  useBridgeProfileApplier(snapshot);
  useBridgeBatteryReporter(snapshot);
  const panel = useRef<HTMLDivElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shareProfileOpen, setShareProfileOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [page, setPage] = useState<DesktopPage>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const { preferences, status } = snapshot;
  const locale = preferences.locale;
  const showingGames = page === "games";

  const showingSettings = page === "settings" || snapshot.interfaceSettingsOpen;

  const resolvedPage: DesktopPage = showingSettings
    ? "settings"
    : page === "hardware-test"
      ? "hardware-test"
      : showingGames
        ? "games"
        : (status !== null || snapshot.keyboard !== null) && snapshot.deviceView === "device"
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
        tr: "tr",
        en: "en",
      };
      const nextLang = htmlLang[locale] ?? "en";
      if (document.documentElement.lang !== nextLang) {
        document.documentElement.lang = nextLang;
      }
      const nextDir = locale === "ar" ? "rtl" : "ltr";
      if (document.documentElement.dir !== nextDir) {
        document.documentElement.dir = nextDir;
      }
    } catch {
    }
    // A stored non-English locale resolves its table after first paint;
    // re-render once it arrives instead of sticking on fallback strings.
    void ensureDisplayLocale(locale).then(() => {
      control.refreshInterface();
      window.dispatchEvent(new Event("openmouse-localechange"));
    });
  }, [locale]);

  useEffect(() => {
    try {
      document.documentElement.dataset.interfaceTheme = interfaceThemeSlug(preferences.theme);
    } catch {
    }
  }, [preferences.theme]);

  useEffect(() => {
    panel.current?.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" });
  }, [page, snapshot.workspaceTab, preferences.reducedMotion]);

  useEffect(() => {
    setSoundsEnabled(preferences.enabledSounds);
  }, [preferences.enabledSounds]);

  const toggleSidebar = (): void => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
      }
      return next;
    });
  };

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

  const openDevice = (index: number): void => {
    control.closeInterfaceSettings();
    setPage("home");
    void control.openDeviceOverview(index);
  };


  return (
    <UiLocaleContext.Provider value={locale}>
    <div
      className={[
        "control-shell",
        "om-shell",
        status || snapshot.keyboard ? "" : "is-empty",
        sidebarCollapsed ? "sidebar-collapsed" : "",
        preferences.reducedMotion ? "reduce-interface-motion" : "",
        snapshot.pending.count > 0 ? "has-pending-changes" : "",
      ].filter(Boolean).join(" ")}
      data-interface-theme={interfaceThemeSlug(preferences.theme)}
    >
      <AppSidebar
        snapshot={snapshot}
        page={resolvedPage}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        onNavigate={navigate}
        onOpenWhatsNew={() => setWhatsNewOpen(true)}
        onOpenDevice={openDevice}
      />

      <main className="om-main full-desktop-main">
        <NewsBanner locale={locale} />
        <div className="om-content full-desktop-content" ref={panel}>
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
            {displayText(locale, snapshot.readStatus)}
          </p>
        </div>
        <PendingBar snapshot={snapshot} />
      </main>

      <CaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} locale={locale} />
      <WhatsNewDialog open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} locale={locale} />
      <ShareProfileDialog open={shareProfileOpen} onClose={() => setShareProfileOpen(false)} snapshot={snapshot} />
      <HelpPanel locale={locale} />
      <ToastHost toasts={snapshot.toasts} locale={locale} />
    </div>
    </UiLocaleContext.Provider>
  );
}
