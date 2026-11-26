import { Download } from "lucide-react";
import { displayText, t } from "../i18n/index";
import { useUiLocale } from "../shared/ui-locale";
import type { ReactNode } from "react";
import type { UnsupportedNotice as Notice } from "../platform/browser-support";
import { BRIDGE_RELEASES_URL } from "../features/bridge/BridgeStatus";

export function UnsupportedNotice({ notice }: { notice: Notice }): ReactNode {
  const __uiLocale = useUiLocale();
  return (
    <section className="small-screen-blocker">
      <img className="standalone-brand" src="/logo.png" alt="" width={28} height={42} />
      <h1>{displayText(__uiLocale, notice.headline)}</h1>
      <p>{displayText(__uiLocale, notice.detail)}</p>
      {notice.offerBridge ? (
        <a className="om-btn is-primary" href={BRIDGE_RELEASES_URL} target="_blank" rel="noreferrer">
          <Download strokeWidth={1.9} aria-hidden="true" />
          {t(__uiLocale, "bridge.download")}
        </a>
      ) : null}
    </section>
  );
}
