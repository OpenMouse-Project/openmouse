import { Download, ExternalLink, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { subscribeBridgeStatus } from "./bridge-status-store";
import type { BridgeStatus } from "./bridge";
import { displayText, t } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";
import { latestRelease } from "./updates";
import { useBridgeActive } from "../games/GamesPage";

export const BRIDGE_REPOSITORY = "OpenMouse-Project/OpenMouse-Bridge";
export const BRIDGE_RELEASES_URL = `https://github.com/${BRIDGE_REPOSITORY}/releases/latest`;

function useBridgeStatus(active: boolean): BridgeStatus | null {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  useEffect(() => (active ? subscribeBridgeStatus(setStatus) : (setStatus(null), undefined)), [active]);
  return status;
}

function useLatestBridge(enabled: boolean): string | null | undefined {
  const [latest, setLatest] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || latest !== undefined) return;
    const controller = new AbortController();
    latestRelease(BRIDGE_REPOSITORY, controller.signal)
      .then((release) => setLatest(release?.version ?? null))
      .catch(() => setLatest(null));
    return () => controller.abort();
  }, [enabled]);
  return latest;
}

export function BridgeStatusButton({ locale, collapsed }: { locale: InterfaceLocale; collapsed: boolean }): ReactNode {
  const active = useBridgeActive();
  const status = useBridgeStatus(active);
  const [open, setOpen] = useState(false);
  const latest = useLatestBridge(open);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const measure = (): void => {
      const rect = trigger.current!.getBoundingClientRect();
      const rtl = getComputedStyle(trigger.current!).direction === "rtl";
      const bottom = collapsed ? window.innerHeight - rect.bottom : window.innerHeight - rect.top + 8;
      const edge = collapsed
        ? (rtl ? window.innerWidth - rect.left + 12 : rect.right + 12)
        : (rtl ? window.innerWidth - rect.right : rect.left);
      setPlace(rtl ? { bottom, right: edge } : { bottom, left: edge });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, collapsed]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const away = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [open]);

  const label = t(locale, active ? "bridge.statusOn" : "bridge.statusOff");
  const outdated = Boolean(status?.version && latest && status.version !== latest);

  return (
    <div className="om-bridge" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`om-bridge-line${active ? " is-on" : ""}${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={collapsed ? label : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`om-dot${active ? " is-ok" : ""}`} aria-hidden="true" />
        <span className="om-bridge-line-text">{label}</span>
        {outdated ? <span className="om-bridge-line-flag">{t(locale, "bridge.update")}</span> : null}
      </button>
      {open ? (
        <div className="om-bridge-pop" role="dialog" aria-labelledby="om-bridge-pop-title" style={place}>
          <header className="om-bridge-pop-head">
            <span className={`om-dot${active ? " is-ok" : ""}`} aria-hidden="true" />
            <h2 id="om-bridge-pop-title">{t(locale, "bridge.title")}</h2>
            <button type="button" className="om-icon-btn" aria-label={t(locale, "common.close")} onClick={() => setOpen(false)}>
              <X strokeWidth={2} aria-hidden="true" />
            </button>
          </header>
          <p className="om-bridge-pop-body">{t(locale, active ? "bridge.bodyOn" : "bridge.body")}</p>
          <ul className="om-kv om-bridge-pop-facts">
            <li>
              <span>{t(locale, "bridge.statusLabel")}</span>
              <span>{t(locale, active ? "bridge.running" : "bridge.notRunning")}</span>
            </li>
            {status?.version ? (
              <li>
                <span>{t(locale, "set.version")}</span>
                <span><bdi>{displayText(locale, status.version)}</bdi></span>
              </li>
            ) : null}
            <li>
              <span>{t(locale, "bridge.latest")}</span>
              <span><bdi>{latest === undefined ? "…" : latest ?? "–"}</bdi></span>
            </li>
          </ul>
          <footer className="om-bridge-pop-foot">
            <a className={`om-btn${active && !outdated ? "" : " is-primary"}`} href={BRIDGE_RELEASES_URL} target="_blank" rel="noreferrer">
              {active && !outdated ? <ExternalLink strokeWidth={1.9} aria-hidden="true" /> : <Download strokeWidth={1.9} aria-hidden="true" />}
              {t(locale, active && !outdated ? "bridge.releaseNotes" : outdated ? "bridge.update" : "bridge.download")}
            </a>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
