import {
  ArrowLeft,
  BarChart3,
  Clock,
  Gauge,
  Layers,
  Lightbulb,
  MousePointerClick,
  Plus,
  Settings2,
  Share2,
  Upload,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as control from "../device/controller";
import { WORKSPACE_TAB_ORDER, type ControlSnapshot, type WorkspaceTab } from "../device/types";
import { t, tp, connectionText, type I18nKey } from "../i18n";
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
  DpiLightingCard,
} from "./cards/AdvancedCards";
import { cardAvailability } from "./cards/availability";
import { TeevolutionProfileCard } from "./cards/teevolution/ProfileCard";
import { deviceImage, isUnknownDevice, showcaseDeviceImageUrls } from "../ui/device-images";
import { BatteryIcon } from "./ui";
import { ArtworkUploadDialog } from "./ArtworkUploadDialog";
import type { MouseStatus } from "@openmouse/protocol/drivers";

function on(tab: WorkspaceTab, tabs: readonly WorkspaceTab[]): boolean {
  return tabs.includes(tab);
}

const TAB_ICON: Record<WorkspaceTab, LucideIcon> = {
  overview: Gauge,
  performance: BarChart3,
  lighting: Lightbulb,
  buttons: MousePointerClick,
  profiles: Layers,
  advanced: Settings2,
};

function TabIcon({ tab }: { tab: WorkspaceTab }): ReactNode {
  const Icon = TAB_ICON[tab];
  return <Icon size={13} strokeWidth={1.8} aria-hidden="true" />;
}

function DeviceShowcase({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const image = snapshot.deviceArtwork;
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const activeDevice = control.getActiveDevice();
  const needsArtwork = activeDevice && (
    imageFailed || isUnknownDevice(
      { vendorId: activeDevice.vendorId, productId: activeDevice.productId } as HIDDevice,
      status.name,
    )
  );

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
              event.currentTarget.onerror = null;
              event.currentTarget.src = deviceImage(null);
              setImageFailed(true);
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
      {needsArtwork ? (
        <button
          type="button"
          className="artwork-upload-trigger"
          onClick={() => setShowUploadDialog(true)}
        >
          <Upload size={14} strokeWidth={2.2} aria-hidden="true" />
          {t(locale, "artwork.upload" as I18nKey)}
        </button>
      ) : null}
      {activeDevice ? (
        <ArtworkUploadDialog
          isOpen={showUploadDialog}
          onClose={() => setShowUploadDialog(false)}
          locale={locale}
          vendorId={activeDevice.vendorId}
          productId={activeDevice.productId}
          displayName={status.name}
          onArtworkUploaded={() => {
            control.refreshArtwork();
          }}
        />
      ) : null}
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

const SHOWCASE_IMAGES = showcaseDeviceImageUrls();
const SHOWCASE_INTERVAL_MS = 3800;

function MouseArtworkShowcase({ reducedMotion }: { reducedMotion: boolean }): ReactNode {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion || SHOWCASE_IMAGES.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % SHOWCASE_IMAGES.length);
    }, SHOWCASE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  return (
    <div className="add-device-mouse-showcase">
      {SHOWCASE_IMAGES.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className={`add-device-mouse-showcase-frame${i === index ? " is-active" : ""}`}
        />
      ))}
    </div>
  );
}

function AddDeviceCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const [busy, setBusy] = useState(false);
  const label = busy ? t(locale, "conn.connecting") : t(locale, "conn.addMouse");
  const disabled = busy || snapshot.connectDisabled;
  return (
    <div className={`device-tile add-device-tile${busy ? " is-busy" : ""}`} aria-label={label}>
      <span className="device-tile-name">{label}</span>
      <div className="device-tile-visual" aria-hidden="true">
        <MouseArtworkShowcase reducedMotion={snapshot.preferences.reducedMotion} />
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
        <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
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
            <AddDeviceCard snapshot={snapshot} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OverviewContent({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return <OverviewEmpty snapshot={snapshot} />;
  const has = cardAvailability(snapshot);
  const powerOverview = status.ui?.powerOverview === true;
  return (
    <>
      <DeviceShowcase snapshot={snapshot} />
      <DeviceInfoGrid snapshot={snapshot} />
      {powerOverview && (has.teevolutionDpiLighting || has.sleep) ? (
        <section id="power-overview-settings" className="settings-grid device-data" aria-label="Power settings">
          {has.teevolutionDpiLighting ? <DpiLightingCard snapshot={snapshot} /> : null}
          {has.sleep ? <SleepCard snapshot={snapshot} /> : null}
        </section>
      ) : null}
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
  const powerOverview = status.ui?.powerOverview === true;

  const performance = [
    show(has.dpi, ["performance"]) ? <DpiCard key="dpi" snapshot={snapshot} /> : null,
    show(has.polling, ["performance"]) ? <PollingCard key="polling" snapshot={snapshot} /> : null,
    show(has.sensor, ["performance"]) ? <SensorCard key="sensor" snapshot={snapshot} /> : null,
    show(has.lightforce, ["buttons"]) ? <LightforceCard key="lightforce" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const advanced = [
    show(has.signal, ["advanced"]) ? <SignalCard key="signal" snapshot={snapshot} /> : null,
    show(has.debounce, ["buttons"]) ? <DebounceCard key="debounce" snapshot={snapshot} /> : null,
    !powerOverview && show(has.sleep, ["advanced"]) ? <SleepCard key="sleep" snapshot={snapshot} /> : null,
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
    show(has.buttonMapping && !snapshot.traits.teevolution, ["buttons"])
      ? <ButtonMappingCard key="button-mapping" snapshot={snapshot} /> : null,
    show(has.onboardProfiles && !snapshot.traits.teevolution, ["profiles"])
      ? <OnboardProfileCard key="onboard-profile" snapshot={snapshot} /> : null,
    show(has.pulsarPro, ["profiles"]) ? <PulsarProCard key="pulsarpro" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const lightingZones = status.lightingZones?.length ? status.lightingZones : status.lighting ? [status.lighting] : [];
  const lighting = [
    show(has.lighting, ["lighting"])
      ? <LightingCard key="lighting-tab" snapshot={snapshot} variant="tab" zones={lightingZones} /> : null,
    !powerOverview && show(has.teevolutionDpiLighting, ["lighting"])
      ? <DpiLightingCard key="dpi-indicator" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const showProfiles = show(has.profiles, ["profiles"]);
  const showTeevolutionProfiles = show(snapshot.traits.teevolution && has.onboardProfiles, ["profiles"]);
  const showNapeLayers = show(has.keychronNapeLayers, ["profiles"]);
  const showSuperstrike = show(has.superstrike, ["buttons"]);
  const showLogitechDetails = show(has.logitechDetails, ["advanced"]);
  const showMxMaster = on(tab, ["advanced"])
    && (status.hapticIntensity != null || status.wheelMode != null || status.friendlyName != null || status.hostCount != null);
  const showDiagnostics = on(tab, ["advanced"]);
  const showOverview = on(tab, ["overview"]);

  const anyPanel = performance.length > 0 || advanced.length > 0 || lighting.length > 0
    || showProfiles || showTeevolutionProfiles || showNapeLayers || showSuperstrike
    || showLogitechDetails || showMxMaster || showDiagnostics || showOverview;

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
            {tp(locale, "tab.unavailable", {
              tab: t(locale, `tab.${tab}` as I18nKey),
            })}
          </p>
          <small>{t(locale, "tab.chooseAnother")}</small>
        </section>
      ) : null}

      {showProfiles ? <Profiles snapshot={snapshot} /> : null}
      {showTeevolutionProfiles ? <TeevolutionProfileCard snapshot={snapshot} /> : null}
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
                      <Wifi className="device-tile-stat-icon" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="device-tile-stat">
                      <Clock className="device-tile-stat-icon" strokeWidth={1.8} aria-hidden="true" />
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
                    <Settings2 size={16} strokeWidth={1.7} aria-hidden="true" />
                  </button>
                </li>
              );
            });
            })()}
            <li key="add-mouse">
              <AddDeviceCard snapshot={snapshot} />
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
    const scrollTarget = panel.current?.closest<HTMLElement>(".full-desktop-content") ?? panel.current;
    scrollTarget?.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" });
  }, [snapshot.workspaceTab]);

  const filterTabs = (deviceStatus: MouseStatus | null): readonly WorkspaceTab[] => {
    let tempTabs = WORKSPACE_TAB_ORDER;
    const has = cardAvailability(snapshot);
    if (deviceStatus == null) return tempTabs;
    if (!has.lighting && (!has.teevolutionDpiLighting || deviceStatus.ui?.powerOverview === true)) tempTabs = tempTabs.filter((tab) => tab !== "lighting");
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
              <ArrowLeft size={13} strokeWidth={1.8} aria-hidden="true" />
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
              <Share2 size={13} strokeWidth={1.8} aria-hidden="true" />
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
