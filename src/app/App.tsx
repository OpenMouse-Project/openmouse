import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as control from "../device/controller";
import { WORKSPACE_TAB_ORDER, type ControlSnapshot, type WorkspaceTab } from "../device/types";
import { interfaceThemeSlug } from "../interface-preferences";
import { CaptureDialog } from "./CaptureDialog";
import { Diagnostics, LogitechDetails } from "./Diagnostics";
import { InterfaceSettings } from "./InterfaceSettings";
import { PendingBar } from "./PendingBar";
import { Profiles } from "./Profiles";
import { Sidebar } from "./Sidebar";
import { Superstrike } from "./Superstrike";
import { useControl } from "./useControl";
import { BatteryIcon } from "./ui";
import { DpiCard } from "./cards/DpiCard";
import { LightforceCard, PollingCard, SensorCard } from "./cards/PerformanceCards";
import { LightingCard } from "./cards/LightingCard";
import { MxMasterCards } from "./cards/MxMasterCards";
import {
  DebounceCard,
  EggButtonCard,
  EggCpiCard,
  EggFilterCard,
  EggPollingCard,
  EggSpdtCard,
  FinalmouseCard,
  LowPowerCard,
  NinjutsoClickCard,
  NinjutsoSensorCard,
  ProcessingCard,
  PulsarProCard,
  SignalCard,
  SleepCard,
  TeevolutionDpiLightingCard,
} from "./cards/AdvancedCards";
import { cardAvailability } from "./cards/availability";

function on(tab: WorkspaceTab, tabs: readonly WorkspaceTab[]): boolean {
  return tabs.includes(tab);
}

function DeviceOverview({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const isWired = status.connectionType === "Wired";
  const showBattery = !snapshot.traits.eggControls
    && (status.ui?.forceShowBattery || !isWired || status.batteryPercent !== null);
  const stats = showBattery ? 3 : 2;
  const supportsDongleLed = status.brand === "Pulsar"
    && status.dongleLedEnabled !== null
    && status.dongleLedEnabled !== undefined;

  return (
    <section
      id="device-overview"
      className="device-overview device-data"
      role="tabpanel"
      aria-labelledby="workspace-tab-overview"
      aria-label="Device status"
      style={{ gridTemplateColumns: `repeat(${stats}, 1fr)` }}
    >
      {showBattery ? (
        <article id="battery-summary" className="summary-stat" style={{ display: "flex" }}>
          <span>BATTERY</span>
          <strong className="battery-readout">
            <span id="battery-icon-slot">
              <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />
            </span>
            <span id="battery-value">{status.batteryPercent === null ? "—" : `${status.batteryPercent}%`}</span>
          </strong>
          <small id="battery-detail">{control.batteryDetail(status)}</small>
        </article>
      ) : null}
      <article className="summary-stat">
        <span>FIRMWARE</span>
        <strong id="firmware-value">{status.firmware[0] ?? "—"}</strong>
        <small id="firmware-detail">
          {status.firmware.length > 1
            ? status.firmware.slice(1).join(" · ")
            : status.firmware.length === 1
              ? "Firmware reported by mouse"
              : "Not reported"}
        </small>
      </article>
      <article className="summary-stat" data-pending-key="dongle-led">
        <span>CONNECTION</span>
        <strong id="connection-value">{status.connectionType ?? "Wireless"}</strong>
        <small id="connection-detail">
          {status.connectionDetail
            ?? (status.activeProfile ? `2.4 GHz · Profile ${status.activeProfile}` : "2.4 GHz receiver")}
        </small>
        {supportsDongleLed ? (
          <button id="dongle-led-toggle" className="dongle-led-button" type="button" onClick={control.toggleDongleLed}>
            Receiver LED: {status.dongleLedEnabled ? "On" : "Off"}
          </button>
        ) : null}
      </article>
    </section>
  );
}

function Workspace({
  snapshot,
  onOpenCapture,
}: {
  snapshot: ControlSnapshot;
  onOpenCapture: () => void;
}): ReactNode {
  const status = snapshot.status;
  const tab = snapshot.workspaceTab;
  if (!status) return null;
  const has = cardAvailability(snapshot);

  const show = (available: boolean, tabs: readonly WorkspaceTab[]): boolean => available && on(tab, tabs);

  const performance = [
    show(has.dpi, ["performance"]) ? <DpiCard key="dpi" snapshot={snapshot} /> : null,
    show(has.polling, ["performance"]) ? <PollingCard key="polling" snapshot={snapshot} /> : null,
    show(has.sensor, ["performance"]) ? <SensorCard key="sensor" snapshot={snapshot} /> : null,
    show(has.lightforce, ["buttons"]) ? <LightforceCard key="lightforce" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const advanced = [
    show(has.signal, ["advanced"]) ? <SignalCard key="signal" snapshot={snapshot} /> : null,
    show(has.debounce, ["buttons"]) ? <DebounceCard key="debounce" snapshot={snapshot} /> : null,
    show(has.sleep, ["advanced"]) ? <SleepCard key="sleep" snapshot={snapshot} /> : null,
    show(has.lightingAdvanced, ["advanced"])
      ? <LightingCard key="lighting" snapshot={snapshot} variant="advanced" /> : null,
    show(has.ninjutsoSensor, ["performance"])
      ? <NinjutsoSensorCard key="ninjutso-sensor" snapshot={snapshot} /> : null,
    show(has.ninjutsoClick, ["performance"])
      ? <NinjutsoClickCard key="ninjutso-click" snapshot={snapshot} /> : null,
    show(has.lowPower, ["advanced"]) ? <LowPowerCard key="lowpower" snapshot={snapshot} /> : null,
    show(has.processing, ["performance"]) ? <ProcessingCard key="processing" snapshot={snapshot} /> : null,
    show(has.teevolutionDpiLighting, ["advanced"])
      ? <TeevolutionDpiLightingCard key="teevo" snapshot={snapshot} /> : null,
    show(has.finalmouse, ["advanced"]) ? <FinalmouseCard key="finalmouse" snapshot={snapshot} /> : null,
    show(has.eggFilter, ["performance"]) ? <EggFilterCard key="eggfilter" snapshot={snapshot} /> : null,
    show(has.eggSpdt, ["buttons"]) ? <EggSpdtCard key="eggspdt" snapshot={snapshot} /> : null,
    show(has.eggPolling, ["performance"]) ? <EggPollingCard key="eggpolling" snapshot={snapshot} /> : null,
    show(has.eggCpi, ["performance"]) ? <EggCpiCard key="eggcpi" snapshot={snapshot} /> : null,
    show(has.eggButtons, ["buttons"]) ? <EggButtonCard key="eggbuttons" snapshot={snapshot} /> : null,
    show(has.pulsarPro, ["profiles"]) ? <PulsarProCard key="pulsarpro" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const lighting = show(has.lighting, ["lighting"])
    ? [<LightingCard key="lighting-tab" snapshot={snapshot} variant="tab" />]
    : [];

  const showProfiles = show(has.profiles, ["profiles"]);
  const showSuperstrike = show(has.superstrike, ["buttons"]);
  const showLogitechDetails = show(has.logitechDetails, ["advanced"]);
  const showMxMaster = on(tab, ["advanced"])
    && (status.hapticIntensity != null || status.wheelMode != null || status.friendlyName != null || status.hostCount != null);
  const showDiagnostics = on(tab, ["advanced"]);
  const showOverview = on(tab, ["overview"]);

  const anyPanel = performance.length > 0 || advanced.length > 0 || lighting.length > 0
    || showProfiles || showSuperstrike || showLogitechDetails || showMxMaster || showDiagnostics || showOverview;

  const slotsAvailable = snapshot.profile.slotsAvailable;
  const showSeparateDpiAxes = snapshot.traits.logitech
    && status.supportsSeparateDpiAxes === true
    && !slotsAvailable;

  return (
    <>
      {showOverview ? <DeviceOverview snapshot={snapshot} /> : null}

      {!anyPanel ? (
        <section id="workspace-tab-empty" className="workspace-tab-empty device-data" role="tabpanel">
          <p id="workspace-tab-empty-title">
            {`${tab[0].toUpperCase()}${tab.slice(1)}`} controls are not available for this mouse.
          </p>
          <small>Choose another tab to continue configuring the device.</small>
        </section>
      ) : null}

      {showProfiles ? <Profiles snapshot={snapshot} /> : null}

      {performance.length > 0 ? (
        <section
          id="performance-settings"
          className={[
            "settings-grid device-data",
            showSeparateDpiAxes ? "has-logitech-axis-controls" : "",
            slotsAvailable ? "has-dpi-slots" : "",
          ].filter(Boolean).join(" ")}
          data-workspace-host
          role="tabpanel"
          aria-label="Mouse settings"
        >
          {performance}
        </section>
      ) : null}

      {lighting.length > 0 ? (
        <section
          id="lighting-settings"
          className="settings-grid device-data"
          data-workspace-host
          role="tabpanel"
          aria-label="Lighting settings"
        >
          {lighting}
        </section>
      ) : null}

      {showLogitechDetails ? <LogitechDetails snapshot={snapshot} /> : null}
      {showMxMaster ? (
        <section className="settings-grid device-data" data-workspace-host role="tabpanel" aria-label="MX Master settings">
          <MxMasterCards snapshot={snapshot} />
        </section>
      ) : null}
      {showSuperstrike ? <Superstrike snapshot={snapshot} /> : null}

      {advanced.length > 0 ? (
        <section
          id="pulsar-advanced"
          className={`device-data${snapshot.traits.eggControls ? " egg-advanced-layout" : ""}`}
          data-workspace-host
          role="tabpanel"
          aria-label="Device settings"
          style={{ display: "grid" }}
        >
          {advanced}
        </section>
      ) : null}

      {on(tab, ["advanced"]) ? (
        <aside className="testing-note" aria-label="Development testing guidance">
          <strong>Development testing</strong>
          <span>
            Record the device identifier, protocol version, and any failing setting in the issue or pull
            request. Do not use factory reset during initial testing.
          </span>
        </aside>
      ) : null}

      {showDiagnostics ? <Diagnostics snapshot={snapshot} onOpenCapture={onOpenCapture} /> : null}
    </>
  );
}

export function App(): ReactNode {
  const snapshot = useControl();
  const panel = useRef<HTMLElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const { preferences, status } = snapshot;

  useEffect(() => {
    const element = panel.current?.closest<HTMLElement>(".control-shell");
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      const target = panel.current;
      if (!target || target.contains(event.target as Node) || event.deltaY === 0) return;
      target.scrollTop += event.deltaY;
      event.preventDefault();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    panel.current?.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" });
  }, [snapshot.workspaceTab]);

  const tabs = WORKSPACE_TAB_ORDER;
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: WorkspaceTab): void => {
    const index = tabs.indexOf(current);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    control.setWorkspaceTab(tabs[next]);
    const button = document.querySelector<HTMLButtonElement>(`#workspace-tab-${tabs[next]}`);
    button?.focus();
  };

  return (
    <div
      className={[
        "control-shell",
        status ? "" : "is-empty",
        preferences.reducedMotion ? "reduce-interface-motion" : "",
        snapshot.sidebarHidden ? "sidebar-hidden" : "",
        snapshot.pending.count > 0 ? "has-pending-changes" : "",
      ].filter(Boolean).join(" ")}
      data-interface-theme={interfaceThemeSlug(preferences.theme)}
    >
      <Sidebar snapshot={snapshot} />

      <main className={`control-panel${snapshot.interfaceSettingsOpen ? " showing-settings" : ""}`} ref={panel}>
        <div className="panel-top">
          <header className="panel-header">
            <div className="panel-title">
              <div>
                <p className="overline">DEVICE CONTROL</p>
                <h1 id="device-title">{status?.name ?? "Connect a mouse"}</h1>
              </div>
            </div>
            <div className="device-status">
              <span className={`status-dot${status ? "" : " is-idle"}`} />
              <span id="device-status">{snapshot.deviceStatusText}</span>
            </div>
          </header>
          <p className="live-status">
            <i aria-hidden="true" />
            <span id="read-status" role="status" aria-live="polite">{snapshot.readStatus}</span>
          </p>
        </div>

        {status ? null : (
          <section className="empty-state" aria-labelledby="empty-state-title">
            <h2 id="empty-state-title">
              {snapshot.previewListMessage ? "Driver previews" : "Connect a mouse."}
            </h2>
            <p>
              {snapshot.previewListMessage ? (
                <>
                  Render any supported driver without its hardware:{" "}
                  {snapshot.previewEntries.map(([key], index) => (
                    <span key={key}>
                      {index > 0 ? " · " : null}
                      <a href={`?preview=${key}`} style={{ color: "var(--ui-accent)" }}>{key}</a>
                    </span>
                  ))}
                </>
              ) : (
                "Pick your mouse in the browser prompt to adjust its onboard settings."
              )}
            </p>
            <button
              id="empty-connect-button"
              className="empty-connect-action"
              type="button"
              disabled={snapshot.connectDisabled}
              onClick={() => {
                control.closeInterfaceSettings();
                void control.connect();
              }}
            >
              {snapshot.connectLabel}
            </button>
          </section>
        )}

        {status ? (
          <nav className="workspace-tabs device-data" role="tablist" aria-label="Device sections">
            {tabs.map((tab) => (
              <button
                key={tab}
                id={`workspace-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={snapshot.workspaceTab === tab}
                tabIndex={snapshot.workspaceTab === tab ? 0 : -1}
                onClick={() => control.setWorkspaceTab(tab)}
                onKeyDown={(event) => onTabKey(event, tab)}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        ) : null}

        <Workspace snapshot={snapshot} onOpenCapture={() => setCaptureOpen(true)} />
        <InterfaceSettings snapshot={snapshot} />
      </main>

      <PendingBar snapshot={snapshot} />
      <CaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  );
}
