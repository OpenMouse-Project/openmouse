import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./check.css";
import { mountOfflineBanner } from "./offline-banner";
import { registerServiceWorker } from "./register-sw";
import { interfaceThemeSlug, loadInterfacePreferences } from "./interface-preferences";
import { t, tp } from "./i18n";
import type { InterfaceLocale } from "./interface-preferences";
import { PageLocaleToggle, usePageLocale } from "./app/page-locale";
import {
  SCAN_FILTERS,
  VERDICT_LABEL,
  buildDiscordSummary,
  hex,
  reportSummary,
  scanDevices,
  usagePageLabel,
  type DeviceResult,
} from "./check-scan";

document.documentElement.setAttribute(
  "data-interface-theme",
  interfaceThemeSlug(loadInterfacePreferences(window.localStorage).theme),
);

function DeviceCard({ result, locale }: { result: DeviceResult; locale: InterfaceLocale }): ReactNode {
  const name = result.device.productName || tp(locale, "chk.mouseFallback", { brand: result.brand });
  return (
    <div className="device-card">
      <div className="device-card-head">
        <div className="device-card-identity">
          <strong>{name}</strong>
          <small>{result.brand} · VID_{hex(result.vendorId)} · PID_{hex(result.productId)}</small>
        </div>
        <div style={{ display: "flex", gap: ".4rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {result.openmouseSupported ? (
            <span className="verdict-badge verdict-full" style={{ fontSize: ".52rem" }}>OPENMOUSE</span>
          ) : null}
          <span className={`verdict-badge verdict-${result.verdict}`}>{VERDICT_LABEL[result.verdict]}</span>
        </div>
      </div>

      {result.device.collections.length > 0 ? (
        <div className="iface-section">
          <div className="iface-label">{t(locale, "chk.collections")}</div>
          {result.device.collections.map((col, index) => (
            <div className="iface-row" key={index}>
              <span className="iface-page">{usagePageLabel(col.usagePage)}</span>
              <span className="iface-type">Usage 0x{hex(col.usage, 2)}</span>
              <span className="iface-reports">{reportSummary(col)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {result.txResults.length > 0 ? (
        <div className="tx-section">
          <div className="tx-label">{t(locale, "chk.txTest")}</div>
          {result.txResults.map((tx) => (
            <div className="tx-row" key={tx.txId}>
              <span className="tx-id">TX 0x{hex(tx.txId, 2)}</span>
              <span className={tx.ok ? "tx-ok" : "tx-fail"}>{tx.ok ? t(locale, "chk.responded") : t(locale, "chk.noResponse")}</span>
              {tx.firmware ? <span className="tx-fw">FW {tx.firmware}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {result.opened ? (
        <div className="open-result ok"><span className="open-dot" />{t(locale, "chk.openedOk")}</div>
      ) : (
        <div className="open-result err">
          <span className="open-dot" />{result.openError ?? t(locale, "chk.couldNotOpen")}
        </div>
      )}

      <div style={{ marginTop: ".6rem", color: "#55555b", fontSize: ".68rem" }}>{result.verdictNote}</div>
    </div>
  );
}

function CopyButton({ summary, locale }: { summary: string; locale: InterfaceLocale }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <button
      id="copy-btn"
      className={`copy-button${copied ? " copied" : ""}`}
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(summary).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? t(locale, "chk.copied") : t(locale, "chk.copyDiscord")}
    </button>
  );
}

type ScanState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "done"; results: DeviceResult[] };

function CheckApp(): ReactNode {
  const [locale, setLocale] = usePageLocale();
  const supportsWebHid = "hid" in navigator;
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  const [scanned, setScanned] = useState(false);

  async function runScan(): Promise<void> {
    if (!navigator.hid) return;
    setState({ kind: "busy", message: t(locale, "chk.waitPrompt") });

    let devices: HIDDevice[];
    try {
      devices = await navigator.hid.requestDevice({ filters: SCAN_FILTERS });
    } catch {
      setState({ kind: "empty", message: t(locale, "chk.cancelled") });
      setScanned(true);
      return;
    }
    if (devices.length === 0) {
      setState({ kind: "empty", message: t(locale, "chk.noMatch") });
      setScanned(true);
      return;
    }

    setState({ kind: "busy", message: tp(locale, "chk.testing", { n: devices.length, s: devices.length !== 1 ? "s" : "" }) });
    try {
      setState({ kind: "done", results: await scanDevices(devices, locale) });
    } catch (err) {
      setState({
        kind: "empty",
        message: tp(locale, "chk.scanError", { msg: err instanceof Error ? err.message : String(err) }),
      });
    }
    setScanned(true);
  }

  return (
    <div className="check-shell">
      <header className="check-header">
        <a className="check-wordmark" href="/">OpenMouse <span>/ Mouse Check</span></a>
        <PageLocaleToggle locale={locale} onChange={setLocale} />
        <a className="check-back" href="/">{t(locale, "chk.back")}</a>
      </header>

      <section className="check-hero">
        <p className="overline">{t(locale, "chk.overline")}</p>
        <h1>Mouse Check</h1>
        <p>
          {t(locale, "chk.heroBody")}
        </p>
      </section>

      <div id="compat-banner">
        <div className={`compat-banner ${supportsWebHid ? "ok" : "warn"}`}>
          <span className="compat-banner-dot" />
          {supportsWebHid
            ? t(locale, "chk.webhidOk")
            : t(locale, "chk.webhidMissing")}
        </div>
      </div>

      <div className="scan-row">
        <button
          id="scan-btn"
          className="scan-button"
          type="button"
          disabled={!supportsWebHid || state.kind === "busy"}
          onClick={() => void runScan()}
        >
          {state.kind === "busy" ? t(locale, "chk.scanning") : scanned ? t(locale, "chk.scanAgain") : t(locale, "chk.scanBtn")}
        </button>
        <span className="scan-note">{t(locale, "chk.scanNote")}</span>
      </div>

      <div id="results-area">
        {state.kind === "busy" ? <div className="scanning-state">{state.message}</div> : null}
        {state.kind === "empty" ? <div className="check-empty">{state.message}</div> : null}
        {state.kind === "done" ? (
          <>
            <div className="results-heading">
              <span>{state.results.length !== 1 ? tp(locale, "chk.resultsMany", { n: state.results.length }) : tp(locale, "chk.resultsOne", { n: state.results.length })}</span>
            </div>
            <div className="results-list">
              {state.results.map((result, index) => <DeviceCard key={index} result={result} locale={locale} />)}
            </div>
            <div className="copy-section">
              <p>{t(locale, "chk.shareDiscord")}</p>
              <CopyButton summary={buildDiscordSummary(state.results)} locale={locale} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

const root = document.querySelector<HTMLDivElement>("#check-app");
if (!root) throw new Error("check-app root not found");
createRoot(root).render(<CheckApp />);

registerServiceWorker();
mountOfflineBanner();
