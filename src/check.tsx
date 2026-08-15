import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./check.css";
import { interfaceThemeSlug, loadInterfacePreferences } from "./interface-preferences";
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

function DeviceCard({ result }: { result: DeviceResult }): ReactNode {
  const name = result.device.productName || `${result.brand} Mouse`;
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
          <div className="iface-label">HID COLLECTIONS</div>
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
          <div className="tx-label">RAZER TX-ID TEST</div>
          {result.txResults.map((t) => (
            <div className="tx-row" key={t.txId}>
              <span className="tx-id">TX 0x{hex(t.txId, 2)}</span>
              <span className={t.ok ? "tx-ok" : "tx-fail"}>{t.ok ? "✓ responded" : "✗ no response"}</span>
              {t.firmware ? <span className="tx-fw">FW {t.firmware}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {result.opened ? (
        <div className="open-result ok"><span className="open-dot" />Device opened successfully</div>
      ) : (
        <div className="open-result err">
          <span className="open-dot" />{result.openError ?? "Could not open"}
        </div>
      )}

      <div style={{ marginTop: ".6rem", color: "#55555b", fontSize: ".68rem" }}>{result.verdictNote}</div>
    </div>
  );
}

function CopyButton({ summary }: { summary: string }): ReactNode {
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
      {copied ? "Copied!" : "Copy for Discord"}
    </button>
  );
}

type ScanState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "done"; results: DeviceResult[] };

function CheckApp(): ReactNode {
  const supportsWebHid = "hid" in navigator;
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  const [scanned, setScanned] = useState(false);

  async function runScan(): Promise<void> {
    if (!navigator.hid) return;
    setState({ kind: "busy", message: "Waiting for browser prompt…" });

    let devices: HIDDevice[];
    try {
      devices = await navigator.hid.requestDevice({ filters: SCAN_FILTERS });
    } catch {
      setState({ kind: "empty", message: "Scan cancelled or no device selected." });
      setScanned(true);
      return;
    }
    if (devices.length === 0) {
      setState({ kind: "empty", message: "No matching devices selected." });
      setScanned(true);
      return;
    }

    setState({ kind: "busy", message: `Testing ${devices.length} device${devices.length !== 1 ? "s" : ""}…` });
    try {
      setState({ kind: "done", results: await scanDevices(devices) });
    } catch (err) {
      setState({
        kind: "empty",
        message: `Scan error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    setScanned(true);
  }

  return (
    <div className="check-shell">
      <header className="check-header">
        <a className="check-wordmark" href="/">OpenMouse <span>/ Mouse Check</span></a>
        <a className="check-back" href="/">← Back to site</a>
      </header>

      <section className="check-hero">
        <p className="overline">HID DIAGNOSTICS</p>
        <h1>Mouse Check</h1>
        <p>
          Scan your connected gaming mice to see which interfaces are accessible via WebHID — and which
          require a native driver.
        </p>
      </section>

      <div id="compat-banner">
        <div className={`compat-banner ${supportsWebHid ? "ok" : "warn"}`}>
          <span className="compat-banner-dot" />
          {supportsWebHid
            ? "WebHID is available in this browser — device scanning is supported."
            : "WebHID is not available. Use Chrome or Edge on desktop to run the diagnostics."}
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
          {state.kind === "busy" ? "Scanning…" : scanned ? "Scan again" : "Scan for mice"}
        </button>
        <span className="scan-note">You'll see a browser prompt to select devices.</span>
      </div>

      <div id="results-area">
        {state.kind === "busy" ? <div className="scanning-state">{state.message}</div> : null}
        {state.kind === "empty" ? <div className="check-empty">{state.message}</div> : null}
        {state.kind === "done" ? (
          <>
            <div className="results-heading">
              <span>RESULTS — {state.results.length} DEVICE{state.results.length !== 1 ? "S" : ""}</span>
            </div>
            <div className="results-list">
              {state.results.map((result, index) => <DeviceCard key={index} result={result} />)}
            </div>
            <div className="copy-section">
              <p>Share these results with the OpenMouse team on Discord.</p>
              <CopyButton summary={buildDiscordSummary(state.results)} />
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
