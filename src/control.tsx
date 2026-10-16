import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./control.css";
import "./launch.css";
import { App } from "./app/App";
import { LaunchCountdown } from "./app/LaunchCountdown";
import { UnsupportedNotice } from "./app/UnsupportedNotice";
import { installBridgeHid } from "./bridge-hid";
import { unsupportedNotice } from "./browser-support";
import { start } from "./device/controller";
import { isBeforeLaunch } from "./launch";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
import { startSelfXssGuard } from "./self-xss-guard";
import { MIN_HEIGHT, MIN_WIDTH, useViewportTooSmall } from "./app/useViewportTooSmall";
import { ensureDisplayLocale } from "./i18n";
import { initialUiLocale } from "./app/ui-locale";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

function isChromium(): boolean {
  const brands = (navigator as Navigator & {
    userAgentData?: { brands?: { brand: string }[] };
  }).userAgentData?.brands;
  if (brands) return brands.some((entry) => /chromium/i.test(entry.brand));
  return /Chrom(e|ium)\/|Edg\//.test(navigator.userAgent);
}

registerServiceWorker();
mountOfflineBanner();
if (import.meta.env.PROD) startSelfXssGuard();

function LaunchHero(): ReactNode {
  return (
    <div className="launch-shell">
      <LaunchCountdown />
    </div>
  );
}

function Root(): ReactNode {
  const tooSmall = useViewportTooSmall();
  if (tooSmall) {
    return (
      <UnsupportedNotice
        notice={{
          headline: "Make the window bigger.",
          detail: `OpenMouse lays its device controls out side by side and needs at least ${MIN_WIDTH} × ${MIN_HEIGHT} pixels. Resize the window, or move to a larger display.`,
        }}
      />
    );
  }
  return <App />;
}

const root = createRoot(controlApp);
if (import.meta.env.PROD && isBeforeLaunch()) {
  void ensureDisplayLocale(initialUiLocale()).then(() => root.render(<LaunchHero />));
} else {
  // Prefer Bridge when it is installed: native HID can reach protected mouse
  // collections that Chrome 153+ correctly withholds from WebHID. If Bridge is
  // absent, installation falls back to the browser's own WebHID implementation.
  void installBridgeHid({ force: true }).then(async (hasHid) => {
    await ensureDisplayLocale(initialUiLocale());
    const notice = unsupportedNotice({
      hasWebHid: hasHid,
      handheld: window.matchMedia("(pointer: coarse) and (hover: none)").matches,
      secureContext: window.isSecureContext,
      chromium: isChromium(),
    });
    if (notice) {
      root.render(<UnsupportedNotice notice={notice} />);
      return;
    }
    start();
    root.render(<Root />);
  });
}
