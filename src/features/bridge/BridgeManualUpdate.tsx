import { Download, TriangleAlert, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { subscribeBridgeStatus } from "./bridge-status-store";
import type { BridgeStatus } from "./bridge";
import { BRIDGE_RELEASES_URL } from "./BridgeStatus";
import { manualInstallFor, needsManualBridgeUpdate } from "./manual-update";
import { t } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";
import { useBridgeActive } from "../games/GamesPage";

const STEP_KEY = {
  macos: "bridge.manualMac",
  windows: "bridge.manualWindows",
  linux: "bridge.manualLinux",
} as const;

/**
 * Shown when the connected Bridge is too old to update itself. Dismissing it
 * lasts until the panel reloads, so it returns while the version is still old.
 */
export function BridgeManualUpdate({ locale }: { locale: InterfaceLocale }): ReactNode {
  const active = useBridgeActive();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => (active ? subscribeBridgeStatus(setStatus) : (setStatus(null), undefined)), [active]);

  if (dismissed || !needsManualBridgeUpdate(status?.version)) return null;

  const install = manualInstallFor(status!.platform);

  return (
    <div className="news-banner news-banner-warning bridge-manual-update" role="alert">
      <TriangleAlert className="news-banner-icon" size={15} strokeWidth={2.2} aria-hidden="true" />
      <div className="news-banner-link">
        <p>{t(locale, "bridge.manualBody")}</p>
        {install ? <p className="bridge-manual-update-step">{t(locale, STEP_KEY[install.platform])}</p> : null}
        {install?.platform === "linux" ? <code className="bridge-manual-update-cmd" dir="ltr">{install.command}</code> : null}
      </div>
      {install?.platform === "linux" ? null : (
        <a className="om-btn is-primary" href={install?.url ?? BRIDGE_RELEASES_URL} target="_blank" rel="noreferrer">
          <Download strokeWidth={1.9} aria-hidden="true" />
          {t(locale, "bridge.download")}
        </a>
      )}
      <button type="button" className="news-banner-dismiss" onClick={() => setDismissed(true)} aria-label={t(locale, "common.close")}>
        <X size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
