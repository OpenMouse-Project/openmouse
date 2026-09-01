import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./control.css";
import "./launch.css";
import { App } from "./app/App";
import { LaunchCountdown } from "./app/LaunchCountdown";
import { UnsupportedNotice } from "./app/UnsupportedNotice";
import { unsupportedNotice } from "./browser-support";
import { start } from "./device/controller";
import { isBeforeLaunch } from "./launch";
import { MIN_HEIGHT, MIN_WIDTH, useViewportTooSmall } from "./app/useViewportTooSmall";

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

const notice = unsupportedNotice({
  hasWebHid: Boolean(navigator.hid),
  handheld: window.matchMedia("(pointer: coarse) and (hover: none)").matches,
  secureContext: window.isSecureContext,
  chromium: isChromium(),
});

if (import.meta.env.PROD) void navigator.serviceWorker?.register("/sw.js").catch(() => undefined);

function LaunchHero(): ReactNode {
  return (
    <div className="launch-shell">
      <div className="launch-bg" aria-hidden="true" />
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
  root.render(<LaunchHero />);
} else if (notice) {
  root.render(<UnsupportedNotice notice={notice} />);
} else {
  start();
  root.render(<Root />);
}
