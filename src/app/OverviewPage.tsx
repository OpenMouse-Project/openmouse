import {
  ArrowLeft,
  BarChart3,
  Clock,
  Gauge,
  ImageUp,
  Keyboard,
  Layers,
  Lightbulb,
  MousePointerClick,
  Plus,
  Settings2,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as control from "../device/controller";
import { isNoirE1Status, isNoirKsnakeStatus, isNoirS1Status, noirBrandLabel } from "../device/noir.ts";
import type { ControlSnapshot, WorkspaceTab } from "../device/types";
import { t, tp, connectionText, type I18nKey } from "../i18n";
import { Diagnostics, LogitechDetails } from "./Diagnostics";
import { KeychronNapeLayers } from "./KeychronNapeLayers";
import { Profiles } from "./Profiles";
import { Superstrike } from "./Superstrike";
import { DpiCard } from "./cards/DpiCard";
import { LightforceCard, PollingCard, SensorCard } from "./cards/PerformanceCards";
import { LightingCard } from "./cards/LightingCard";
import { MxMasterButtonsCard, MxMasterCards } from "./cards/MxMasterCards";
import { AtkButtonCard, AtkDongleCard, AtkProfileCard, AtkReceiverCard, AtkSensorCard } from "./cards/AtkCards";
import {
  DebounceCard,
  EggButtonCard,
  EggCpiCard,
  EggFilterCard,
  EggPollingCard,
  EggSpdtCard,
  FinalmouseCard,
  IncottCard,
  LowPowerCard,
  NinjutsoClickCard,
  NinjutsoSensorCard,
  ProcessingCard,
  RazerButtonCard,
  ButtonMappingCard,
  KsnakeMacroCard,
  PowerModeCard,
  OnboardProfileCard,
  PulsarProCard,
  SignalCard,
  DongleLedCard,
  SleepCard,
  KsnakeScrollCard,
  DpiLightingCard,
} from "./cards/AdvancedCards";
import { cardAvailability } from "./cards/availability";
import { TeevolutionProfileCard } from "./cards/teevolution/ProfileCard";
import { deviceImage, deviceImageFilename, isUnknownDevice, showcaseDeviceImageUrls } from "../ui/device-images";
import { BatteryIcon } from "./ui";
import { availableWorkspaceTab, availableWorkspaceTabs } from "./workspace-tabs";

function on(tab: WorkspaceTab, tabs: readonly WorkspaceTab[]): boolean {
  return tabs.includes(tab);
}

const TAB_ICON: Record<WorkspaceTab, LucideIcon> = {
  overview: Gauge,
  performance: BarChart3,
  lighting: Lightbulb,
  buttons: MousePointerClick,
  macro: Keyboard,
  profiles: Layers,
  advanced: Settings2,
};

export function TabIcon({ tab }: { tab: WorkspaceTab }): ReactNode {
  const Icon = TAB_ICON[tab];
  return <Icon size={13} strokeWidth={1.8} aria-hidden="true" />;
}

interface ButtonMarkerPosition {
  x: number;
  y: number;
}

// The M2-NEX artwork is a fixed top-down render, so these coordinates keep
// the remap numbers attached to the physical controls instead of making a
// generic layout guess for every other mouse shape.
const M2_NEX_BUTTON_MARKER_POSITIONS: Readonly<Record<string, ButtonMarkerPosition>> = {
  left: { x: 0.23, y: 0.27 },
  right: { x: 0.77, y: 0.27 },
  middle: { x: 0.5, y: 0.19 },
  forward: { x: 0.045, y: 0.39 },
  backward: { x: 0.045, y: 0.51 },
  "scroll up": { x: 0.62, y: 0.14 },
  "scroll down": { x: 0.62, y: 0.29 },
};

const NOIR_S1_BUTTON_MARKER_POSITIONS: Readonly<Record<string, ButtonMarkerPosition>> = {
  left: { x: 0.39, y: 0.24 },
  right: { x: 0.61, y: 0.24 },
  middle: { x: 0.5, y: 0.31 },
  forward: { x: 0.27, y: 0.47 },
  backward: { x: 0.27, y: 0.59 },
  dpi: { x: 0.5, y: 0.42 },
};

const NOIR_E1_BUTTON_MARKER_POSITIONS: Readonly<Record<string, ButtonMarkerPosition>> = {
  left: { x: 0.28, y: 0.2 },
  right: { x: 0.72, y: 0.2 },
  middle: { x: 0.5, y: 0.18 },
  forward: { x: 0.08, y: 0.32 },
  backward: { x: 0.08, y: 0.5 },
};

function m2NexButtonMarkerPosition(button: string): ButtonMarkerPosition | null {
  return M2_NEX_BUTTON_MARKER_POSITIONS[button.trim().toLowerCase()] ?? null;
}

function noirS1ButtonMarkerPosition(button: string): ButtonMarkerPosition | null {
  return NOIR_S1_BUTTON_MARKER_POSITIONS[button.trim().toLowerCase()] ?? null;
}

function noirE1ButtonMarkerPosition(button: string): ButtonMarkerPosition | null {
  return NOIR_E1_BUTTON_MARKER_POSITIONS[button.trim().toLowerCase()] ?? null;
}

// Device artwork requests go straight to the documented GitHub issue form
// (public/devices/README.md, .github/ISSUE_TEMPLATE/device-artwork.yml).
const ARTWORK_ISSUE_URL = "https://github.com/OpenMouse-Project/openmouse/issues/new?template=device-artwork.yml";

function DeviceShowcase({ snapshot }: {
  snapshot: ControlSnapshot;
}): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const image = snapshot.deviceArtwork;
  const [imageFailed, setImageFailed] = useState(false);
  const [artSize, setArtSize] = useState<{ w: number; h: number } | null>(null);

  const activeDevice = control.getActiveDevice();
  const needsArtwork = activeDevice && (
    imageFailed || isUnknownDevice(
      { vendorId: activeDevice.vendorId, productId: activeDevice.productId } as HIDDevice,
      status.name,
    )
  );
  const artworkIssueHref = `${ARTWORK_ISSUE_URL}${status.name ? `&title=${encodeURIComponent(`Artwork request: ${status.name}`)}` : ""}`;

  return (
    <div className="device-showcase">
      <h1 className="device-showcase-name">{status.name}</h1>
      <p className="device-showcase-brand">{noirBrandLabel(status)}</p>
      <div className="device-diagram">
        <div
          className="device-diagram-canvas"
          style={{
            aspectRatio: artSize ? `${artSize.w} / ${artSize.h}` : "1 / 1",
            width: artSize ? `min(100%, ${Math.round((artSize.w / artSize.h) * 56)}vh)` : "min(100%, 480px)",
          }}
          >
          <div className="device-diagram-art">
            {image ? (
              <img
                className="device-showcase-image"
                src={image}
                onLoad={(event) => {
                  if (event.currentTarget.naturalWidth > 0) {
                    setArtSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight });
                  }
                }}
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = deviceImage(null);
                  setImageFailed(true);
                }}
                alt={status.name}
              />
            ) : null}
          </div>
        </div>
      </div>
      <div className="device-showcase-status-pill" aria-label="Device status">
        <span className="device-showcase-status-primary">
          <span className="device-showcase-dot" aria-hidden="true" />
          {t(locale, "side.connected")}
        </span>
        {status.connectionType ? (
          <>
            <span className="device-showcase-status-separator" aria-hidden="true">·</span>
            <span className="device-showcase-status-muted">{connectionText(locale, status.connectionType)}</span>
          </>
        ) : null}
        {status.dpi > 0 ? (
          <>
            <span className="device-showcase-status-separator" aria-hidden="true">·</span>
            <span className="device-showcase-status-item">
              <span className="device-showcase-status-label">DPI</span>
              <span className="device-showcase-status-value">{status.dpi.toLocaleString()}</span>
            </span>
          </>
        ) : null}
        {status.batteryPercent !== null ? (
          <>
            <span className="device-showcase-status-separator" aria-hidden="true">·</span>
            <span className="device-showcase-status-item">
              <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />
              <span className="device-showcase-status-value">{status.batteryPercent}%</span>
            </span>
          </>
        ) : null}
        {status.pollingRateHz > 0 ? (
          <>
            <span className="device-showcase-status-separator" aria-hidden="true">·</span>
            <span className="device-showcase-status-item">
              <span className="device-showcase-status-value">{status.pollingRateHz.toLocaleString()} Hz</span>
            </span>
          </>
        ) : null}
        {status.activeProfile != null ? (
          <>
            <span className="device-showcase-status-separator" aria-hidden="true">·</span>
            <span className="device-showcase-status-item">
              <span className="device-showcase-status-label">Profile</span>
              <span className="device-showcase-status-value">{status.activeProfile}</span>
            </span>
          </>
        ) : null}
      </div>
      {needsArtwork ? (
        <a
          className="artwork-upload-trigger"
          href={artworkIssueHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ImageUp size={14} strokeWidth={2.2} aria-hidden="true" />
          {t(locale, "artreq.request" as I18nKey)}
        </a>
      ) : null}
    </div>
  );
}

function M2NexProfileOverview({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
  const isNoirProfile = isNoirKsnakeStatus(status);
  const profileImportRef = useRef<HTMLInputElement>(null);
  if (!status || !isNoirProfile || snapshot.m2nexProfiles === null) return null;
  const profile = snapshot.m2nexProfiles[snapshot.activeM2NexProfile];
  if (!profile) return null;
  const applyDisabled = snapshot.settingInProgress || snapshot.pending.count > 0;
  return (
    <section
      id="m2nex-profile-overview"
      className="m2nex-profile-overview"
      aria-label={`${status.name} ${t(locale, "m2nex.controls")}`}
    >
      <div className="m2nex-profile-overview-title">
        <span>{t(locale, "m2nex.overline")}</span>
        <strong>{status.name}</strong>
      </div>
      <label className="m2nex-profile-overview-picker" htmlFor="m2nex-profile-overview-select">
        <select
          id="m2nex-profile-overview-select"
          aria-label={`${status.name} profile`}
          value={snapshot.activeM2NexProfile}
          disabled={snapshot.settingInProgress || snapshot.pending.busy}
          onChange={(event) => control.selectM2NexProfile(Number(event.currentTarget.value))}
        >
          {snapshot.m2nexProfiles.map((entry, index) => (
            <option key={entry.id} value={index}>{entry.name}</option>
          ))}
        </select>
      </label>
      <span className={`m2nex-profile-overview-state${snapshot.m2nexProfileDirty ? " is-dirty" : ""}`}>
        {snapshot.m2nexProfileDirty ? t(locale, "m2nex.pending") : t(locale, "m2nex.saved")}
      </span>
      <div className="m2nex-profile-overview-actions">
        <button
          type="button"
          disabled={snapshot.settingInProgress || snapshot.pending.busy}
          onClick={control.createM2NexProfile}
        >
          New
        </button>
        <button
          type="button"
          disabled={snapshot.settingInProgress || snapshot.pending.busy}
          onClick={() => profileImportRef.current?.click()}
        >
          Import
        </button>
        <button
          className="m2nex-profile-overview-apply"
          type="button"
          disabled={applyDisabled}
          onClick={() => void control.applyM2NexProfile()}
        >
          {t(locale, "m2nex.apply")}
        </button>
        <button
          type="button"
          disabled={snapshot.settingInProgress}
          onClick={control.saveCurrentM2NexProfile}
        >
          {t(locale, "m2nex.save")}
        </button>
      </div>
      <input
        ref={profileImportRef}
        className="m2nex-profile-import-input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          void file.text().then((text) => control.importM2NexProfiles(text));
        }}
      />
    </section>
  );
}

export function DeviceShowcaseSidebar({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const image = snapshot.deviceArtwork;
  const isNoirS1 = isNoirS1Status(status);
  const isNoirE1 = isNoirE1Status(status);
  const showButtonMarkers = snapshot.workspaceTab === "buttons"
    && isNoirKsnakeStatus(status)
    && status.buttonMappings != null;

  return (
    <div className="showcase-sidebar">
      <div className="showcase-sidebar-visual">
        {image ? showButtonMarkers ? (
          <div className="button-map-showcase-art">
            <img
              className="showcase-sidebar-image button-map-showcase-image"
              src={image}
              alt={status.name}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = deviceImage(null);
              }}
            />
            <div className="button-map-markers" aria-hidden="true">
              {Object.keys(status.buttonMappings ?? {})
                .filter((button) => !isNoirE1 || button.trim().toLowerCase() !== "dpi")
                .map((button, index) => {
                  const position = isNoirS1
                    ? noirS1ButtonMarkerPosition(button)
                    : isNoirE1
                      ? noirE1ButtonMarkerPosition(button)
                      : m2NexButtonMarkerPosition(button);
                  if (!position) return null;
                  return (
                    <span
                      key={button}
                      className="button-map-marker"
                      style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  );
                })}
            </div>
            {isNoirE1 ? (
              <div className="button-map-underside-callout" aria-hidden="true">
                <span className="button-map-underside-badge">
                  <span className="button-map-underside-number">06</span>
                  <span>DPI <small>UNDERSIDE</small></span>
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <img
            className="showcase-sidebar-image"
            src={image}
            alt={status.name}
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = deviceImage(null);
            }}
          />
        ) : null}
      </div>
      <div className="showcase-sidebar-info">
        <h2 className="showcase-sidebar-name">{status.name}</h2>
        <p className="showcase-sidebar-brand">{noirBrandLabel(status)}</p>
      </div>
      <div className="showcase-sidebar-status">
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

function OverviewContent({ snapshot }: {
  snapshot: ControlSnapshot;
}): ReactNode {
  const status = snapshot.status;
  if (!status) return <OverviewEmpty snapshot={snapshot} />;
  const has = cardAvailability(snapshot);
  const powerOverview = status.ui?.powerOverview === true;
  return (
    <>
      <M2NexProfileOverview snapshot={snapshot} />
      <DeviceShowcase snapshot={snapshot} />
      {powerOverview && (has.teevolutionDpiLighting || has.sleep) ? (
        <section id="power-overview-settings" className="settings-grid device-data" aria-label="Power settings">
          {has.teevolutionDpiLighting ? <DpiLightingCard snapshot={snapshot} /> : null}
          {has.sleep ? <SleepCard snapshot={snapshot} /> : null}
        </section>
      ) : null}
    </>
  );
}

/**
 * `gameProfile` renders the cards for editing a game profile on the Games
 * page: only settings, without the device showcase, diagnostics, or the
 * cards that manage the hardware itself (signal, receiver pairing, device
 * details), none of which belong to a per-game profile.
 */
export function Workspace({
  snapshot,
  onOpenCapture,
  onShareProfile,
  gameProfile = false,
}: {
  snapshot: ControlSnapshot;
  onOpenCapture: () => void;
  onShareProfile: () => void;
  gameProfile?: boolean;
}): ReactNode {
  const status = snapshot.status;
  const tab = snapshot.workspaceTab;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
  const has = cardAvailability(snapshot);
  const show = (available: boolean, tabs: readonly WorkspaceTab[]): boolean => available && on(tab, tabs);
  const device = !gameProfile;
  const powerOverview = status.ui?.powerOverview === true;

  const performance = [
    show(has.dpi, ["performance"]) ? <DpiCard key="dpi" snapshot={snapshot} /> : null,
    show(has.polling, ["performance"]) ? <PollingCard key="polling" snapshot={snapshot} /> : null,
    show(has.sensor, ["performance"]) ? <SensorCard key="sensor" snapshot={snapshot} /> : null,
    show(has.atkF1Sensor, ["performance"]) ? <AtkSensorCard key="atk-sensor" snapshot={snapshot} /> : null,
    show(has.lightforce, ["buttons"]) ? <LightforceCard key="lightforce" snapshot={snapshot} /> : null,
    show(has.ninjutsoSensor, ["performance"])
      ? <NinjutsoSensorCard key="ninjutso-sensor" snapshot={snapshot} /> : null,
    show(has.ninjutsoClick, ["performance"])
      ? <NinjutsoClickCard key="ninjutso-click" snapshot={snapshot} /> : null,
    show(has.processing, ["performance"]) ? <ProcessingCard key="processing" snapshot={snapshot} /> : null,
    show(has.eggFilter, ["performance"]) ? <EggFilterCard key="eggfilter" snapshot={snapshot} /> : null,
    show(has.eggPolling, ["performance"]) ? <EggPollingCard key="eggpolling" snapshot={snapshot} /> : null,
    show(has.eggCpi, ["performance"]) ? <EggCpiCard key="eggcpi" snapshot={snapshot} /> : null,
    show(has.powerMode, ["performance"])
      ? <PowerModeCard key="power-mode" snapshot={snapshot} /> : null,
    show(has.debounce, ["buttons"]) ? <DebounceCard key="debounce" snapshot={snapshot} /> : null,
    show(has.eggSpdt, ["buttons"]) ? <EggSpdtCard key="eggspdt" snapshot={snapshot} /> : null,
    show(has.eggButtons, ["buttons"]) ? <EggButtonCard key="eggbuttons" snapshot={snapshot} /> : null,
    show(has.razerButtons, ["buttons"]) ? <RazerButtonCard key="razerbuttons" snapshot={snapshot} /> : null,
    show(has.mxMasterButtons, ["buttons"])
      ? <MxMasterButtonsCard key="mxmaster-buttons" snapshot={snapshot} /> : null,
    show(has.atkButtons, ["buttons"]) ? <AtkButtonCard key="atk-buttons" snapshot={snapshot} /> : null,
    show(has.buttonMapping && !snapshot.traits.teevolution, ["buttons"])
      ? <ButtonMappingCard key="button-mapping" snapshot={snapshot} /> : null,
    show(has.ksnakeScroll, ["buttons"])
      ? <KsnakeScrollCard key="ksnake-scroll" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const macro = [
    show(has.ksnakeMacros, ["macro"]) ? <KsnakeMacroCard key="ksnake-macros" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const advanced = [
    device && show(has.signal, ["advanced"]) ? <SignalCard key="signal" snapshot={snapshot} /> : null,
    !powerOverview && show(has.sleep, ["advanced"]) ? <SleepCard key="sleep" snapshot={snapshot} /> : null,
    show(has.lightingAdvanced, ["advanced"])
      ? <LightingCard key="lighting" snapshot={snapshot} variant="advanced" /> : null,
    show(has.lowPower, ["advanced"]) ? <LowPowerCard key="lowpower" snapshot={snapshot} /> : null,
    show(has.finalmouse, ["advanced"]) ? <FinalmouseCard key="finalmouse" snapshot={snapshot} /> : null,
    show(has.incott, ["advanced"]) ? <IncottCard key="incott" snapshot={snapshot} /> : null,
    device && show(has.dongleLed, ["advanced"]) ? <DongleLedCard key="dongle-led" snapshot={snapshot} /> : null,
    show(has.atkProfile, ["profiles"]) ? <AtkProfileCard key="atk-profile" snapshot={snapshot} /> : null,
    device && show(has.atkReceiver, ["advanced"]) ? <AtkReceiverCard key="atk-receiver" snapshot={snapshot} /> : null,
    show(has.atkF1Dongle, ["advanced"]) ? <AtkDongleCard key="atk-dongle" snapshot={snapshot} /> : null,
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
  const showLogitechDetails = device && show(has.logitechDetails, ["advanced"]);
  const showMxMaster = on(tab, ["advanced"])
    && (status.hapticIntensity != null || status.wheelMode != null || status.friendlyName != null || status.hostCount != null);
  const showDiagnostics = device && on(tab, ["advanced"]);
  const showOverview = on(tab, ["overview"]);

  const anyPanel = performance.length > 0 || macro.length > 0 || advanced.length > 0 || lighting.length > 0
    || showProfiles || showTeevolutionProfiles || showNapeLayers || showSuperstrike
    || showLogitechDetails || showMxMaster || showDiagnostics || showOverview;

  const slotsAvailable = snapshot.profile.slotsAvailable;
  const stagesAvailable = Boolean(status.ui?.dpiStageEditor)
    && Array.isArray(status.dpiStages)
    && status.dpiStages.length > 0
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

      {showProfiles ? <Profiles snapshot={snapshot} onShareProfile={onShareProfile} /> : null}
      {showTeevolutionProfiles ? <TeevolutionProfileCard snapshot={snapshot} /> : null}
      {showNapeLayers ? <KeychronNapeLayers snapshot={snapshot} /> : null}

      {performance.length > 0 ? (
        <section
          id="performance-settings"
          className={[
            "performance-layout device-data",
            slotsAvailable || stagesAvailable ? "has-dpi-slots" : "",
          ].filter(Boolean).join(" ")}
          data-workspace-host
          role="tabpanel"
          aria-label="Mouse settings"
        >
          {device ? (
            <aside className="performance-sidebar">
              <DeviceShowcaseSidebar snapshot={snapshot} />
            </aside>
          ) : null}
          <div className="performance-controls">
            {performance}
          </div>
        </section>
      ) : null}

      {macro.length > 0 ? (
        <section
          id="macro-settings"
          className="settings-grid device-data"
          data-workspace-host
          role="tabpanel"
          aria-labelledby="workspace-tab-macro"
          aria-label="Macro settings"
        >
          {macro}
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

      {device && on(tab, ["advanced"]) ? (
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
              const imageSrc = deviceImage({ vendorId: device.vendorId, productId: device.productId } as HIDDevice, device.name);
              const imageFilename = deviceImageFilename(device.name);
              const imageClass = imageFilename === "noir-m2-nex.png" || imageFilename === "noir-s1.png" || imageFilename === "noir-e1.png"
                ? " device-tile-image-is-portrait"
                : "";
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
                  {device.transport === "bridge" ? (
                    <span className="device-tile-transport" title="Connected through OpenMouse Bridge">
                      Bridge
                    </span>
                  ) : null}
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
                      className={`device-tile-image${imageClass}`}
                      src={imageSrc}
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

  const tabs = availableWorkspaceTabs(status !== null, cardAvailability(snapshot), {
    hideLighting: isNoirKsnakeStatus(status),
  });
  const workspaceTab = availableWorkspaceTab(snapshot.workspaceTab, tabs);
  const workspaceSnapshot = workspaceTab === snapshot.workspaceTab
    ? snapshot
    : { ...snapshot, workspaceTab };

  useEffect(() => {
    const scrollTarget = panel.current?.closest<HTMLElement>(".full-desktop-content") ?? panel.current;
    scrollTarget?.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" });
  }, [workspaceTab]);

  useEffect(() => {
    if (workspaceTab === snapshot.workspaceTab) return;
    control.setWorkspaceTab(workspaceTab);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`#workspace-tab-${workspaceTab}`)?.focus();
    });
  }, [snapshot.workspaceTab, workspaceTab]);

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
            {(tabs.filter((tab) => tab !== "profiles")).map((tab) => (
              <button
                key={tab}
                id={`workspace-tab-${tab}`}
                type="button"
                role="tab"
                className={`device-tab-pill${workspaceTab === tab ? " active" : ""}`}
                aria-selected={workspaceTab === tab}
                tabIndex={workspaceTab === tab ? 0 : -1}
                onClick={() => control.setWorkspaceTab(tab)}
                onKeyDown={(event) => onTabKey(event, tab)}
              >
                <TabIcon tab={tab} />
                {t(locale, `tab.${tab}` as I18nKey)}
              </button>
            ))}
            {tabs.includes("profiles") ? (
              <button
                type="button"
                role="tab"
                id="workspace-tab-profiles"
                className={`device-tab-pill device-tab-profiles-nav${workspaceTab === "profiles" ? " active" : ""}`}
                aria-selected={workspaceTab === "profiles"}
                tabIndex={workspaceTab === "profiles" ? 0 : -1}
                onClick={() => control.setWorkspaceTab("profiles")}
                onKeyDown={(event) => onTabKey(event, "profiles")}
              >
                <TabIcon tab="profiles" />
                {t(locale, "tab.profiles")}
              </button>
            ) : null}
          </nav>

          <Workspace snapshot={workspaceSnapshot} onOpenCapture={onOpenCapture} onShareProfile={onShareProfile} />
        </>
      ) : (
        <DeviceListView snapshot={snapshot} />
      )}
    </section>
  );
}
