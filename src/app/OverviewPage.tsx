import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as control from "../device/controller";
import { WORKSPACE_TAB_ORDER, type ControlSnapshot, type WorkspaceTab } from "../device/types";
import { t, connectionText, type I18nKey } from "../i18n";
import { Diagnostics, LogitechDetails } from "./Diagnostics";
import { KeychronNapeLayers } from "./KeychronNapeLayers";
import { Profiles } from "./Profiles";
import { Superstrike } from "./Superstrike";
import { DpiCard } from "./cards/DpiCard";
import { LightforceCard, PollingCard, SensorCard } from "./cards/PerformanceCards";
import { LightingCard } from "./cards/LightingCard";
import { MxMasterButtonsCard, MxMasterCards } from "./cards/MxMasterCards";
import { AtkButtonCard, AtkProfileCard, AtkReceiverCard } from "./cards/AtkCards";
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
  RazerButtonCard,
  ButtonMappingCard,
  PowerModeCard,
  OnboardProfileCard,
  PulsarProCard,
  SignalCard,
  SleepCard,
  TeevolutionDpiLightingCard,
} from "./cards/AdvancedCards";
import { cardAvailability } from "./cards/availability";
import { deviceImage } from "../ui/device-images";
import { BatteryIcon } from "./ui";
import type { MouseStatus } from "@openmouse/protocol/drivers";

function on(tab: WorkspaceTab, tabs: readonly WorkspaceTab[]): boolean {
  return tabs.includes(tab);
}

const TAB_ICON_PATH: Record<WorkspaceTab, ReactNode> = {
  overview: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-.1 4.1h.2M12 10v6" />,
  performance: (
    <path d="M2 5h20M4 5v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5M2 18h20M9 5v13" />
  ),
  lighting: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.9.7 1.6 1.6 1.6 2.2h4c0-.6.7-1.5 1.6-2.2A6 6 0 0 0 12 3Z" />
    </>
  ),
  buttons: <path d="M4 5v14M20 5v14M4 12h16M8 19h8" />,
  profiles: (
    <>
      <path d="m12 3 9 5-9 5-9-5Z" />
      <path d="m3 13 9 5 9-5M3 18l9 5 9-5" />
    </>
  ),
  advanced: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
};

function TabIcon({ tab }: { tab: WorkspaceTab }): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TAB_ICON_PATH[tab]}
    </svg>
  );
}

function DeviceShowcase({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const image = snapshot.deviceArtwork;

  return (
    <div className="device-showcase">
      <h1 className="device-showcase-name">{status.name}</h1>
      <p className="device-showcase-brand">{status.brand}</p>
      <div className="device-showcase-visual">
        {image ? (
          <img
            className="device-showcase-image"
            src={image}
            onError={(event) => {
              // Some drivers resolve to artwork that hasn't been uploaded to
              // the R2 bucket yet (see public/devices/README.md); fall back to
              // the generic placeholder instead of dropping the thumbnail.
              event.currentTarget.onerror = null;
              event.currentTarget.src = deviceImage(null);
            }}
            alt={status.name}
          />
        ) : null}
      </div>
      <div className="device-showcase-status">
        <span className="device-showcase-dot" aria-hidden="true" />
        {t(locale, "side.connected")}
        {status.connectionType ? (
          <span className="device-showcase-status-detail">
            {" · "}{connectionText(locale, status.connectionType)}
          </span>
        ) : null}
        {status.batteryPercent !== null ? (
          <span className="device-showcase-status-detail">
            {" · "}
            <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />
            {status.batteryPercent}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DeviceInfoGrid({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;

  const currentRows: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: "DPI",
      value: status.dpi > 0 ? status.dpi.toLocaleString() : "—",
    },
    {
      label: "Polling rate",
      value: status.pollingRateHz ? `${status.pollingRateHz} Hz` : "—",
    },
  ];
  if (status.activeProfile !== null && status.activeProfile !== undefined) {
    currentRows.push({
      label: "Profile",
      value: status.onboardProfileFormat?.name
        ? `Profile ${status.activeProfile} (${status.onboardProfileFormat.name})`
        : status.activeProfile !== null
          ? `Profile ${status.activeProfile}`
          : "Default",
    });
  }
  if (status.batteryPercent !== null) {
    currentRows.push({
      label: "Battery",
      value: `${status.batteryPercent}%`,
      sub: status.batteryState !== "Unknown" ? String(status.batteryState) : undefined,
    });
  }
  if (status.connectionType) {
    currentRows.push({
      label: "Connection",
      value: status.connectionDetail
        ? `${connectionText(locale, status.connectionType)} (${status.connectionDetail})`
        : connectionText(locale, status.connectionType),
    });
  }

  const infoRows: Array<{ label: string; value: string; mono?: boolean }> = [];
  infoRows.push({ label: "Manufacturer", value: status.brand });
  if (status.firmware.length > 0) {
    infoRows.push({ label: "Firmware", value: status.firmware.join(" · "), mono: status.firmware.length === 1 });
  }
  if (status.modelId) infoRows.push({ label: "Model ID", value: status.modelId, mono: true });
  if (status.unitId) infoRows.push({ label: "Unit ID", value: status.unitId, mono: true });
  if (status.friendlyName) infoRows.push({ label: "Friendly name", value: status.friendlyName });

  if (currentRows.length === 0 && infoRows.length === 0) return null;

  return (
    <>
      {currentRows.length > 0 ? (
        <div className="info-section">
          <span className="info-section-title">Current Status</span>
          <div className="info-grid">
            {currentRows.map((row) => (
              <div className="info-row" key={row.label}>
                <span className="info-label">{row.label}</span>
                <span className="info-value">
                  {row.value}
                  {row.sub ? <span className="info-value-sub"> · {row.sub}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {infoRows.length > 0 ? (
        <div className="info-section">
          <span className="info-section-title">Device Information</span>
          <div className="info-grid">
            {infoRows.map((row) => (
              <div className="info-row" key={row.label}>
                <span className="info-label">{row.label}</span>
                <span className={`info-value${row.mono ? " info-value-mono" : ""}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function MouseDeviceSvg(): ReactNode {
  return (
    <svg className="add-device-mouse" viewBox="-8 175 190 345" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M85.292 505.94c-73.244 0-84.317-65.02-83.559-85.62 1.127-19.43 2.065-97.59-1.17-163.4.824-71.92 55.773-70.2 84.709-70.2 28.94 0 83.89-1.72 84.72 70.2-3.24 65.81-2.3 143.97-1.17 163.4.75 20.6-10.32 85.61-83.56 85.61Z"
        fill="color-mix(in srgb, currentColor 14%, transparent)"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M85.262 187.14v118.58" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.43 309.58h82.83" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M85.26 310.33h82.89" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="85.2" cy="247.6" rx="15.6" ry="43" fill="color-mix(in srgb, currentColor 18%, transparent)" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="85.5" cy="247" rx="11" ry="26" fill="color-mix(in srgb, currentColor 30%, transparent)" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

const KEYBOARD_ROWS: ReadonlyArray<{ y: number; h: number; widths: readonly number[] }> = [
  { y: 10, h: 14, widths: Array.from({ length: 13 }, () => 26) },
  { y: 29, h: 22, widths: Array.from({ length: 13 }, () => 26) },
  { y: 56, h: 22, widths: Array.from({ length: 13 }, () => 26) },
  { y: 83, h: 22, widths: Array.from({ length: 13 }, () => 26) },
  { y: 110, h: 22, widths: Array.from({ length: 13 }, () => 26) },
  { y: 137, h: 23, widths: [44, 130, 44, 44, 44, 56] },
];

const KEYBOARD_KEY_GAP = 3.5;
const KEYBOARD_X0 = 10;

function KeyboardDeviceSvg(): ReactNode {
  const rects: ReactNode[] = [];
  let keyIndex = 0;
  for (const row of KEYBOARD_ROWS) {
    let x = KEYBOARD_X0;
    for (const width of row.widths) {
      rects.push(
        <rect
          key={keyIndex++}
          x={x}
          y={row.y}
          width={width}
          height={row.h}
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />,
      );
      x += width + KEYBOARD_KEY_GAP;
    }
  }
  return (
    <svg className="add-device-keyboard" viewBox="0 0 400 232" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="2"
        width="396"
        height="168"
        rx="14"
        fill="color-mix(in srgb, currentColor 10%, transparent)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      {rects}
    </svg>
  );
}

function AddDeviceCard({ snapshot, kind }: { snapshot: ControlSnapshot; kind: "mouse" | "keyboard" }): ReactNode {
  const locale = snapshot.preferences.locale;
  const [busy, setBusy] = useState(false);
  const label = busy ? t(locale, "conn.connecting") : t(locale, "conn.add");
  const disabled = busy || snapshot.connectDisabled;
  return (
    <div
      className={`device-tile add-device-tile${kind === "keyboard" ? " is-keyboard" : ""}${busy ? " is-busy" : ""}`}
      aria-label={label}
    >
      <span className="device-tile-name">{label}</span>
      <div className="device-tile-visual" aria-hidden="true">
        {kind === "keyboard" ? <KeyboardDeviceSvg /> : <MouseDeviceSvg />}
      </div>
      <button
        type="button"
        className="add-device-button"
        disabled={disabled}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void control.connect().finally(() => setBusy(false));
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label}
      </button>
    </div>
  );
}

function OverviewEmpty({ snapshot, compact = false }: { snapshot: ControlSnapshot; compact?: boolean }): ReactNode {
  const locale = snapshot.preferences.locale;
  return (
    <div className={`welcome-screen${compact ? " is-compact" : ""}`}>
      <div className="welcome-aurora" aria-hidden="true">
        <i /><i /><i />
      </div>
      <div className="welcome-hero">
        <h2 className="welcome-title">{t(locale, "empty.title")}</h2>
        <p className="welcome-body">{t(locale, "empty.body")}</p>
        {!compact ? (
          <div className="add-device-grid">
            <AddDeviceCard snapshot={snapshot} kind="mouse" />
            <AddDeviceCard snapshot={snapshot} kind="keyboard" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OverviewContent({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return <OverviewEmpty snapshot={snapshot} />;
  return (
    <>
      <DeviceShowcase snapshot={snapshot} />
      <DeviceInfoGrid snapshot={snapshot} />
    </>
  );
}

export function Workspace({
  snapshot,
  onOpenCapture,
}: {
  snapshot: ControlSnapshot;
  onOpenCapture: () => void;
}): ReactNode {
  const status = snapshot.status;
  const tab = snapshot.workspaceTab;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
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
    show(has.finalmouse, ["advanced"]) ? <FinalmouseCard key="finalmouse" snapshot={snapshot} /> : null,
    show(has.eggFilter, ["performance"]) ? <EggFilterCard key="eggfilter" snapshot={snapshot} /> : null,
    show(has.eggSpdt, ["buttons"]) ? <EggSpdtCard key="eggspdt" snapshot={snapshot} /> : null,
    show(has.eggPolling, ["performance"]) ? <EggPollingCard key="eggpolling" snapshot={snapshot} /> : null,
    show(has.eggCpi, ["performance"]) ? <EggCpiCard key="eggcpi" snapshot={snapshot} /> : null,
    show(has.eggButtons, ["buttons"]) ? <EggButtonCard key="eggbuttons" snapshot={snapshot} /> : null,
    show(has.razerButtons, ["buttons"]) ? <RazerButtonCard key="razerbuttons" snapshot={snapshot} /> : null,
    show(has.mxMasterButtons, ["buttons"])
      ? <MxMasterButtonsCard key="mxmaster-buttons" snapshot={snapshot} /> : null,
    show(has.atkButtons, ["buttons"]) ? <AtkButtonCard key="atk-buttons" snapshot={snapshot} /> : null,
    show(has.atkProfile, ["profiles"]) ? <AtkProfileCard key="atk-profile" snapshot={snapshot} /> : null,
    show(has.atkReceiver, ["advanced"]) ? <AtkReceiverCard key="atk-receiver" snapshot={snapshot} /> : null,
    show(has.powerMode, ["performance"])
      ? <PowerModeCard key="power-mode" snapshot={snapshot} /> : null,
    show(has.buttonMapping, ["buttons"])
      ? <ButtonMappingCard key="button-mapping" snapshot={snapshot} /> : null,
    show(has.onboardProfiles, ["profiles"])
      ? <OnboardProfileCard key="onboard-profile" snapshot={snapshot} /> : null,
    show(has.pulsarPro, ["profiles"]) ? <PulsarProCard key="pulsarpro" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const lightingZones = status.lightingZones?.length ? status.lightingZones : status.lighting ? [status.lighting] : [];
  const lighting = [
    show(has.lighting, ["lighting"])
      ? <LightingCard key="lighting-tab" snapshot={snapshot} variant="tab" zones={lightingZones} /> : null,
    show(has.teevolutionDpiLighting, ["lighting"])
      ? <TeevolutionDpiLightingCard key="teevo" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const showProfiles = show(has.profiles, ["profiles"]);
  const showNapeLayers = show(has.keychronNapeLayers, ["profiles"]);
  const showSuperstrike = show(has.superstrike, ["buttons"]);
  const showLogitechDetails = show(has.logitechDetails, ["advanced"]);
  const showMxMaster = on(tab, ["advanced"])
    && (status.hapticIntensity != null || status.wheelMode != null || status.friendlyName != null || status.hostCount != null);
  const showDiagnostics = on(tab, ["advanced"]);
  const showOverview = on(tab, ["overview"]);

  const anyPanel = performance.length > 0 || advanced.length > 0 || lighting.length > 0
    || showProfiles || showNapeLayers || showSuperstrike || showLogitechDetails || showMxMaster
    || showDiagnostics || showOverview;

  const slotsAvailable = snapshot.profile.slotsAvailable;
  const stagesAvailable = Boolean(status.ui?.dpiStageEditor)
    && Array.isArray(status.dpiStages)
    && status.dpiStages.length > 0
    && !slotsAvailable;
  const showSeparateDpiAxes = snapshot.traits.logitech
    && status.supportsSeparateDpiAxes === true
    && !slotsAvailable;

  return (
    <>
      {showOverview ? <OverviewContent snapshot={snapshot} /> : null}

      {!anyPanel ? (
        <section id="workspace-tab-empty" className="workspace-tab-empty device-data" role="tabpanel">
          <p id="workspace-tab-empty-title">
            {`${tab[0].toUpperCase()}${tab.slice(1)}`} controls are not available for this mouse.
          </p>
          <small>Choose another tab to continue configuring the device.</small>
        </section>
      ) : null}

      {showProfiles ? <Profiles snapshot={snapshot} /> : null}
      {showNapeLayers ? <KeychronNapeLayers snapshot={snapshot} /> : null}

      {performance.length > 0 ? (
        <section
          id="performance-settings"
          className={[
            "settings-grid device-data",
            showSeparateDpiAxes ? "has-logitech-axis-controls" : "",
            slotsAvailable || stagesAvailable ? "has-dpi-slots" : "",
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
        <section id="logitech-mx-master-settings" className="settings-grid device-data" data-workspace-host role="tabpanel" aria-label="MX Master settings">
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
        <aside className="testing-note" aria-label={t(locale, "misc.devTesting")}>
          <strong>{t(locale, "misc.devTesting")}</strong>
          <span>
            {t(locale, "misc.devTestingBody")}
          </span>
        </aside>
      ) : null}

      {showDiagnostics ? <Diagnostics snapshot={snapshot} onOpenCapture={onOpenCapture} /> : null}
    </>
  );
}

function DeviceListView({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const devices = snapshot.devices;
  const locale = snapshot.preferences.locale;

  if (devices.length === 0) {
    return <OverviewEmpty snapshot={snapshot} />;
  }

  return (
    <div className="welcome-with-devices">
      <section className="detected-devices" aria-label={t(locale, "side.connectedDevices")}>
        <ul className="device-grid">
            {(() => {
              const ordered = devices.slice();
              const connectedIndex = ordered.findIndex((device) => device.selected);
              if (connectedIndex !== -1 && ordered.length > 1) {
                const [connected] = ordered.splice(connectedIndex, 1);
                ordered.splice(Math.floor(ordered.length / 2), 0, connected);
              }
              return ordered.map((device) => {
              const connected = device.selected && snapshot.deviceStatus !== null;
              const liveStatus = connected ? snapshot.deviceStatus : null;
              const pollText = liveStatus?.pollingRateHz ? `${liveStatus.pollingRateHz} Hz` : "–";
              const batteryText = liveStatus?.batteryPercent != null ? `${liveStatus.batteryPercent}%` : "–%";
              return (
                <li
                className={`device-tile${connected ? " is-connected" : ""}${device.kind === "keyboard" ? " is-keyboard" : ""}`}
                key={device.index}
                role="button"
                tabIndex={0}
                title={`Open ${device.name}`}
                onClick={() => void control.openDeviceOverview(device.index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void control.openDeviceOverview(device.index);
                  }
                }}
              >
                  <span className="device-tile-name">{device.name}</span>
                  <div className="device-tile-stats" aria-label="Device status">
                    <span className="device-tile-stat">
                      <svg className="device-tile-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M4 11.5a8.5 8.5 0 0 1 16 0M7.5 14.8a5 5 0 0 1 9 0" />
                        <circle cx="12" cy="18.4" r="1.2" fill="currentColor" />
                      </svg>
                    </span>
                    <span className="device-tile-stat">
                      <svg className="device-tile-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
                        <path d="M12 8v4.2l2.5 1.5" />
                      </svg>
                      <span className="device-tile-stat-text">{pollText}</span>
                    </span>
                    <span className="device-tile-stat">
                      <BatteryIcon
                        percent={liveStatus?.batteryPercent != null ? liveStatus.batteryPercent : null}
                        state={liveStatus?.batteryState ?? "Unknown"}
                      />
                      <span className="device-tile-stat-text">{batteryText}</span>
                    </span>
                  </div>
                  <div className="device-tile-visual">
                    <img
                      className="device-tile-image"
                      src={deviceImage({ vendorId: device.vendorId, productId: device.productId } as HIDDevice, device.name)}
                      alt={device.name}
                      loading="lazy"
                      draggable={false}
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = deviceImage(null);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="device-tile-gear"
                    aria-label="Open device settings"
                    title="Open device settings"
                    onClick={(event) => {
                      event.stopPropagation();
                      void control.openDeviceOverview(device.index);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
                    </svg>
                  </button>
                </li>
              );
            });
            })()}
            <li key="add-keyboard">
              <AddDeviceCard snapshot={snapshot} kind="keyboard" />
            </li>
          </ul>
        </section>
    </div>
  );
}

export function OverviewPage({
  snapshot,
  onOpenCapture,
  onShareProfile,
}: {
  snapshot: ControlSnapshot;
  onOpenCapture: () => void;
  onShareProfile: () => void;
}): ReactNode {
  const status = snapshot.status;
  const panel = useRef<HTMLElement>(null);
  const { preferences } = snapshot;
  const locale = preferences.locale;

  useEffect(() => {
    const element = panel.current?.closest<HTMLElement>(".full-desktop-content");
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      const target = panel.current;
      const source = event.target as Element;
      if (!target || target.contains(source) || source.closest("dialog") || event.deltaY === 0) return;
      target.scrollTop += event.deltaY;
      event.preventDefault();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const scrollTarget = panel.current?.closest<HTMLElement>(".full-desktop-content") ?? panel.current;
    scrollTarget?.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" });
  }, [snapshot.workspaceTab]);

  const filterTabs = (deviceStatus: MouseStatus | null): readonly WorkspaceTab[] => {
    let tempTabs = WORKSPACE_TAB_ORDER;
    const has = cardAvailability(snapshot);
    if (deviceStatus == null) return tempTabs;
    if (!has.lighting && !has.teevolutionDpiLighting) tempTabs = tempTabs.filter((tab) => tab !== "lighting");
    if (
      !has.eggButtons
      && !has.razerButtons
      && !has.mxMasterButtons
      && !has.atkButtons
      && !has.buttonMapping
      && !has.debounce
      && !has.lightforce
      && !has.eggSpdt
      && !has.superstrike
    ) tempTabs = tempTabs.filter((tab) => tab !== "buttons");
    return tempTabs;
  };
  const tabs = filterTabs(status);
  const showingDeviceDashboard = status !== null
    && (snapshot.deviceView === "device" || snapshot.previewMode !== null);

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
    <section className="page page-overview" ref={panel}>
      {showingDeviceDashboard ? (
        <>
          <nav className="device-tabs-bar" role="tablist" aria-label={t(locale, "panel.deviceSections")}>
            <button
              type="button"
              className="device-tab-back"
              onClick={() => control.showDeviceList()}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              {t(locale, "common.back")}
            </button>
            {tabs.map((tab) => (
              <button
                key={tab}
                id={`workspace-tab-${tab}`}
                type="button"
                role="tab"
                className={`device-tab-pill${snapshot.workspaceTab === tab ? " active" : ""}`}
                aria-selected={snapshot.workspaceTab === tab}
                tabIndex={snapshot.workspaceTab === tab ? 0 : -1}
                onClick={() => control.setWorkspaceTab(tab)}
                onKeyDown={(event) => onTabKey(event, tab)}
              >
                <TabIcon tab={tab} />
                {t(locale, `tab.${tab}` as I18nKey)}
              </button>
            ))}
            <button
              type="button"
              className="device-tab-back device-tab-back-right"
              onClick={onShareProfile}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h12v10H4zM16 9h3v6h-3" />
              </svg>
              {t(locale, "panel.shareProfile")}
            </button>
          </nav>

          <Workspace snapshot={snapshot} onOpenCapture={onOpenCapture} />
        </>
      ) : (
        <DeviceListView snapshot={snapshot} />
      )}
    </section>
  );
}
