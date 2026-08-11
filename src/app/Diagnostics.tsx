import type { ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { Collapsible } from "./ui";

export function LogitechDetails({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status || status.brand !== "Logitech") return null;
  const transports = Object.entries(status.transportIds ?? {})
    .map(([name, id]) => `${name}: ${id}`)
    .join(" · ") || "Not reported";
  const rates = status.supportedPollingRates
    ?.map((rate) => `${rate >= 1000 ? `${rate / 1000}K` : rate} Hz`)
    .join(", ") || "Not reported";
  const items: Array<[string, string]> = [
    ["Mode", status.deviceMode ?? "Unknown"],
    ["Active profile", status.activeProfile === null ? "None in host mode" : `Profile ${status.activeProfile}`],
    ["Profile format", status.onboardProfileFormat
      ? `${status.onboardProfileFormat.id} · ${status.onboardProfileFormat.name} (base ${status.onboardProfileFormat.base})`
      : "Not reported"],
    ["Model ID", status.modelId ?? "Not reported"],
    ["Unit ID", status.unitId ?? "Not reported"],
    ["Transport IDs", transports],
    ["Advertised polling", rates],
    ["DPI axes", status.supportsSeparateDpiAxes
      ? `X ${status.dpi} · Y ${status.dpiY ?? status.dpi}`
      : "Linked X/Y"],
  ];
  return (
    <section id="logitech-device-details" className="device-data" role="tabpanel" aria-labelledby="workspace-tab-advanced">
      <Collapsible
        className="egg-collapsible"
        overline="LOGITECH HID++"
        title="Device details"
        open={snapshot.preferences.expandSections}
      >
        <article className="setting-card">
          <div id="logitech-detail-list">
            {items.map(([label, value]) => (
              <div key={label}>
                <small>{label.toUpperCase()}</small>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </article>
      </Collapsible>
    </section>
  );
}

export function Diagnostics({
  snapshot,
  onOpenCapture,
}: {
  snapshot: ControlSnapshot;
  onOpenCapture: () => void;
}): ReactNode {
  const { diagnostics } = snapshot;
  return (
    <section
      id="device-debug-details"
      className="device-data"
      role="tabpanel"
      aria-labelledby="workspace-tab-advanced"
      aria-label="Device diagnostics"
    >
      <Collapsible
        className="egg-collapsible"
        overline="DEVELOPMENT"
        title="Diagnostics"
        open={snapshot.diagnosticsOpen}
        onToggle={control.setDiagnosticsOpen}
      >
        <article className="setting-card device-debug-card">
          <div id="device-debug-overview" className="device-debug-overview">
            {diagnostics.overview.map(([label, value]) => (
              <div key={label}>
                <small>{label.toUpperCase()}</small>
                <span>{value}</span>
              </div>
            ))}
          </div>
          <div className="device-debug-actions">
            <button
              id="download-diagnostics"
              type="button"
              disabled={!diagnostics.downloadReady}
              onClick={control.downloadDiagnostics}
            >
              Download diagnostics
            </button>
            {snapshot.captureAvailable ? (
              <button id="capture-open" type="button" onClick={onOpenCapture}>Verify profile format</button>
            ) : null}
            <span id="diagnostic-download-status" role="status" aria-live="polite">
              {diagnostics.downloadStatus}
            </span>
          </div>
          <details id="device-debug-readlog" className="device-debug-raw">
            <summary>Reads</summary>
            <pre id="device-debug-reads" className="device-debug-snapshot">{diagnostics.reads}</pre>
          </details>
          <details id="device-debug-raw" className="device-debug-raw">
            <summary>Raw snapshot</summary>
            <pre id="device-debug-snapshot" className="device-debug-snapshot">{diagnostics.snapshot}</pre>
          </details>
        </article>
      </Collapsible>
    </section>
  );
}
