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
import { MIN_HEIGHT, MIN_WIDTH, useViewportTooSmall } from "./app/useViewportTooSmall";
import { usePresence } from "./app/usePresence";

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

function LaunchHero(): ReactNode {
  return (
    <div className="launch-shell">
      <LaunchCountdown />
    </div>
  );
}

function Root(): ReactNode {
  // Keeps the "who's using this right now" presence heartbeat running for
  // the real app, not just the pre-launch countdown screen — otherwise the
  // admin dashboard's live count only ever reflects whoever is stuck on
  // that one screen.
  usePresence();
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
  root.render(<LaunchHero />);
} else {
  // A browser without WebHID can still reach a mouse through OpenMouse Bridge,
  // so whether this browser is supported is only known once that has been tried.
  // Bridge answers on loopback in a few milliseconds, or not at all.
  void installBridgeHid().then((hasHid) => {
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
