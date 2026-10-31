import { slotCards } from "../../shared/CardSlot";
import { displayText } from "../../i18n/index";
import { useUiLocale } from "../../shared/ui-locale";
import {
  BarChart3,
  Gauge,
  Keyboard,
  Layers,
  Lightbulb,
  MousePointerClick,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import * as control from "../../device/controller";
import { isNoirE1Status, isNoirKsnakeStatus, isNoirS1Status, noirBrandLabel } from "../../device/noir.ts";
import type { ControlSnapshot, WorkspaceTab } from "../../device/types";
import { t, tp, connectionText, type I18nKey } from "../../i18n/index";
import { Diagnostics, LogitechDetails } from "./Diagnostics";
import { KeychronNapeLayers } from "./KeychronNapeLayers";
import { Profiles } from "../profiles/Profiles";
import { MagneticButtons } from "./MagneticButtons";
import { Superstrike } from "../superstrike/Superstrike";
import { ButtonMap, buttonMapAvailable } from "../buttons/ButtonMap";
import { DpiCard } from "./cards/DpiCard";
import { KeyboardPanel } from "./cards/KeyboardPanel";
import { FirmwareCard } from "./cards/FirmwareCard";
import { DynamicSensitivityCard, LightforceCard, PollingCard, SensorCard, SensorScanningCard } from "./cards/PerformanceCards";
import { LightingCard } from "./cards/LightingCard";
import { LunaFuryButtonsCard, LunaFuryWheelCard } from "./cards/LunaFuryCards";
import { MxMasterButtonsCard, MxMasterCards } from "./cards/MxMasterCards";
import { AtkButtonCard, AtkDongleCard, AtkProfileCard, AtkReceiverCard, AtkSensorCard } from "./cards/AtkCards";
import {
  DebounceCard,
  EggButtonCard,
  EggCpiCard,
  EggFilterCard,
  EggHandedCard,
  EggPollingCard,
  EggSpdtCard,
  EggV2SensorCard,
  FinalmouseCard,
  FinalmouseProfilesCard,
  IncottCard,
  LowPowerCard,
  NinjutsoClickCard,
  NinjutsoSensorCard,
  PerfectPollingCard,
  ProcessingCard,
  RazerButtonCard,
  ButtonMappingCard,
  KsnakeMacroCard,
  WallhackMacroCard,
  PowerModeCard,
  OnboardProfileCard,
  PulsarProCard,
  SignalCard,
  DongleLedCard,
  SleepCard,
  KsnakeScrollCard,
  DpiLightingCard,
  TmrDsCard,
} from "./cards/AdvancedCards";
import { cardAvailability } from "./cards/availability";
import { TeevolutionProfileCard } from "./cards/teevolution/ProfileCard";
import { deviceImage } from "../../shared/device-images";
import { BatteryIcon } from "../../shared/ui";
import { BatteryHistoryPanel, CurrentSetupPanel, DeviceHero } from "./DeviceHero";
import { DevicesHome } from "./DevicesHome";
import { availableKeyboardWorkspaceTabs, availableWorkspaceTab, availableWorkspaceTabs } from "./workspace-tabs";

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
  return <Icon size={15} strokeWidth={1.8} aria-hidden="true" />;
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
          aria-label={displayText(locale, `${status.name} profile`)}
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
        {displayText(locale, snapshot.m2nexProfileDirty ? t(locale, "m2nex.pending") : t(locale, "m2nex.saved"))}
      </span>
      <div className="m2nex-profile-overview-actions">
        <button
          type="button"
          disabled={snapshot.settingInProgress || snapshot.pending.busy}
          onClick={control.createM2NexProfile}
        > {displayText(locale, "New")} </button>
        <button
          type="button"
          disabled={snapshot.settingInProgress || snapshot.pending.busy}
          onClick={() => profileImportRef.current?.click()}
        > {displayText(locale, "Import")} </button>
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
  const batteryEstimate = control.batteryEstimateParts(status, locale);

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
                      {displayText(locale, String(index + 1).padStart(2, "0"))}
                    </span>
                  );
                })}
            </div>
            {isNoirE1 ? (
              <div className="button-map-underside-callout" aria-hidden="true">
                <span className="button-map-underside-badge">
                  <span className="button-map-underside-number">06</span>
                  <span>{displayText(locale, "DPI")} <small>{displayText(locale, "UNDERSIDE")}</small></span>
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
        <p className="showcase-sidebar-brand">{displayText(locale, noirBrandLabel(status))}</p>
      </div>
      <div className="showcase-sidebar-status">
        <span className="device-showcase-dot" aria-hidden="true" />
        {t(locale, "side.connected")}
        {status.connectionType ? (
          <span className="device-showcase-status-detail">
            {displayText(locale, " · ")}{displayText(locale, connectionText(locale, status.connectionType))}
          </span>
        ) : null}
        {status.batteryPercent !== null ? (
          <span className="device-showcase-status-detail">
            {displayText(locale, " · ")}
            <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />
            {status.batteryPercent}%
            {batteryEstimate ? (
              <span title={displayText(locale, `${displayText(locale, batteryEstimate.time)} ${displayText(locale, batteryEstimate.label)}`)}>{displayText(locale, " · ")}{displayText(locale, batteryEstimate.time)}</span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function OverviewContent({ snapshot }: {
  snapshot: ControlSnapshot;
}): ReactNode {
  const __uiLocale = useUiLocale();
  const status = snapshot.status;
  if (!status) return null;
  const has = cardAvailability(snapshot);
  const powerOverview = status.ui?.powerOverview === true;
  return (
    <>
      <M2NexProfileOverview snapshot={snapshot} />
      <CurrentSetupPanel snapshot={snapshot} />
      <div className={`om-overview-grid${status.batteryPercent === null ? " is-single" : ""}`}>
        <BatteryHistoryPanel snapshot={snapshot} />
        <section id="firmware-update-settings" className="device-data" aria-label={displayText(__uiLocale, "Firmware update")}>
          <FirmwareCard snapshot={snapshot} />
        </section>
      </div>
      {powerOverview && (has.teevolutionDpiLighting || has.sleep) ? (
        <section id="power-overview-settings" className="settings-grid device-data" aria-label={displayText(__uiLocale, "Power settings")}>
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
    show(has.wallhackScanning, ["performance"]) ? <SensorScanningCard key="wallhack-scanning" snapshot={snapshot} /> : null,
    show(has.wallhackCurves, ["performance"]) ? <DynamicSensitivityCard key="wallhack-curves" snapshot={snapshot} /> : null,
    show(has.atkF1Sensor, ["performance"]) ? <AtkSensorCard key="atk-sensor" snapshot={snapshot} /> : null,
    show(has.lightforce, ["buttons"]) ? <LightforceCard key="lightforce" snapshot={snapshot} /> : null,
    show(has.tmrDs, ["buttons"]) ? <TmrDsCard key="finalmouse-tmr" snapshot={snapshot} /> : null,
    show(has.ninjutsoSensor, ["performance"])
      ? <NinjutsoSensorCard key="ninjutso-sensor" snapshot={snapshot} /> : null,
    show(has.ninjutsoClick, ["performance"])
      ? <NinjutsoClickCard key="ninjutso-click" snapshot={snapshot} /> : null,
    show(has.processing, ["performance"]) ? <ProcessingCard key="processing" snapshot={snapshot} /> : null,
    show(has.eggFilter, ["performance"]) ? <EggFilterCard key="eggfilter" snapshot={snapshot} /> : null,
    show(has.eggV2Sensor, ["performance"]) ? <EggV2SensorCard key="eggsensor" snapshot={snapshot} /> : null,
    show(has.eggPolling, ["performance"]) ? <EggPollingCard key="eggpolling" snapshot={snapshot} /> : null,
    show(has.eggCpi, ["performance"]) ? <EggCpiCard key="eggcpi" snapshot={snapshot} /> : null,
    show(has.powerMode, ["performance"])
      ? <PowerModeCard key="power-mode" snapshot={snapshot} /> : null,
    show(has.debounce, ["buttons"]) ? <DebounceCard key="debounce" snapshot={snapshot} /> : null,
    show(has.eggSpdt, ["buttons"]) ? <EggSpdtCard key="eggspdt" snapshot={snapshot} /> : null,
    show(has.eggHanded, ["buttons"]) ? <EggHandedCard key="egghanded" snapshot={snapshot} /> : null,
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
    show(has.wallhackMacros, ["macro"]) ? <WallhackMacroCard key="wallhack-macros" snapshot={snapshot} /> : null,
  ].filter((node) => node !== null);

  const advanced = [
    device && show(has.signal, ["advanced"]) ? <SignalCard key="signal" snapshot={snapshot} /> : null,
    !powerOverview && show(has.sleep, ["advanced"]) ? <SleepCard key="sleep" snapshot={snapshot} /> : null,
    show(has.lightingAdvanced, ["advanced"])
      ? <LightingCard key="lighting" snapshot={snapshot} variant="advanced" /> : null,
    show(has.lowPower, ["advanced"]) ? <LowPowerCard key="lowpower" snapshot={snapshot} /> : null,
    show(has.perfectPolling, ["advanced"]) ? <PerfectPollingCard key="finalmouse-pp" snapshot={snapshot} /> : null,
    show(has.finalmouse, ["advanced"]) ? <FinalmouseCard key="finalmouse" snapshot={snapshot} /> : null,
    show(has.finalmouseProfiles, ["advanced"]) ? <FinalmouseProfilesCard key="finalmouse-profiles" snapshot={snapshot} /> : null,
    show(has.incott, ["advanced"]) ? <IncottCard key="incott" snapshot={snapshot} /> : null,
    show(has.lunafuryButtons, ["buttons"]) ? <LunaFuryButtonsCard key="lunafury-buttons" snapshot={snapshot} /> : null,
    show(has.lunafuryWheelGuard, ["buttons"]) ? <LunaFuryWheelCard key="lunafury-wheel" snapshot={snapshot} /> : null,
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
  const showButtonMap = show(buttonMapAvailable(snapshot), ["buttons"]);
  const showMagnetic = show(has.magnetic, ["buttons"]);
  const showLogitechDetails = device && show(has.logitechDetails, ["advanced"]);
  const showMxMaster = on(tab, ["advanced"])
    && (status.hapticIntensity != null || status.wheelMode != null || status.friendlyName != null || status.hostCount != null);
  const showDiagnostics = device && on(tab, ["advanced"]);
  const showOverview = on(tab, ["overview"]);
  const showButtonMarkers = on(tab, ["buttons"]) && isNoirKsnakeStatus(status) && status.buttonMappings != null;

  const anyPanel = performance.length > 0 || macro.length > 0 || advanced.length > 0 || lighting.length > 0
    || showProfiles || showTeevolutionProfiles || showNapeLayers || showSuperstrike || showMagnetic
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

      {performance.length > 0 || showSuperstrike || showButtonMap ? (
        <section
          id="performance-settings"
          className={[
            "performance-layout device-data",
            slotsAvailable || stagesAvailable ? "has-dpi-slots" : "",
            // The button map has its own mouse, so the side panel's would be a second one.
            showButtonMap || !showButtonMarkers ? "has-no-sidebar" : "",
          ].filter(Boolean).join(" ")}
          data-workspace-host
          role="tabpanel"
          aria-label={displayText(locale, "Mouse settings")}
        >
          {device && !showButtonMap && showButtonMarkers ? (
            <aside className="performance-sidebar">
              <DeviceShowcaseSidebar snapshot={snapshot} />
            </aside>
          ) : null}
          <div className="performance-main">
            {/* The HITS card keeps its own card chrome, first, beside the mouse panel. */}
            {showSuperstrike ? <Superstrike snapshot={snapshot} /> : null}
            {showButtonMap ? <ButtonMap snapshot={snapshot} /> : null}
            {performance.length > 0 ? (
              <div className="performance-controls card-flow">
                {slotCards(performance)}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {macro.length > 0 ? (
        <section
          id="macro-settings"
          className="settings-grid card-flow device-data"
          data-workspace-host
          role="tabpanel"
          aria-labelledby="workspace-tab-macro"
          aria-label={displayText(locale, "Macro settings")}
        >
          {slotCards(macro)}
        </section>
      ) : null}

      {lighting.length > 0 ? (
        <section
          id="lighting-settings"
          className="settings-grid card-flow device-data"
          data-workspace-host
          role="tabpanel"
          aria-label={displayText(locale, "Lighting settings")}
        >
          {slotCards(lighting)}
        </section>
      ) : null}

      {showLogitechDetails ? <LogitechDetails snapshot={snapshot} /> : null}
      {showMxMaster ? (
        <section id="logitech-mx-master-settings" className="settings-grid card-flow device-data" data-workspace-host role="tabpanel" aria-label={displayText(locale, "MX Master settings")}>
          <MxMasterCards snapshot={snapshot} />
        </section>
      ) : null}
      {showMagnetic ? <MagneticButtons snapshot={snapshot} /> : null}

      {advanced.length > 0 ? (
        <section
          id="pulsar-advanced"
          className={`device-data card-flow${snapshot.traits.eggControls ? " egg-advanced-layout" : ""}`}
          data-workspace-host
          role="tabpanel"
          aria-label={displayText(locale, "Device settings")}
        >
          {slotCards(advanced)}
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

/** The device overview: status, workspace tabs and the active device's cards. */
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

  const tabs = snapshot.keyboard ? availableKeyboardWorkspaceTabs(snapshot.keyboard.family) : availableWorkspaceTabs(status !== null, cardAvailability(snapshot), {
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

  const showingDeviceDashboard = (status !== null || snapshot.keyboard !== null)
    && snapshot.deviceView === "device";

  const visibleTabs: readonly WorkspaceTab[] = tabs.includes("profiles")
    ? [...tabs.filter((tab) => tab !== "profiles"), "profiles"]
    : [...tabs];

  return (
    <section className={`page page-overview${showingDeviceDashboard ? " om-page om-device-page" : ""}`} ref={panel}>
      {showingDeviceDashboard ? (
        <>
          <DeviceHero
            snapshot={snapshot}
            tabs={status === null && snapshot.keyboard === null ? [] : visibleTabs}
            activeTab={workspaceTab}
            tabIcon={(tab) => <TabIcon tab={tab} />}
          >
            <div className="om-device-body" role="tabpanel" aria-labelledby={`workspace-tab-${workspaceTab}`}>
              {status === null && snapshot.keyboard !== null ? (
                <KeyboardPanel snapshot={workspaceSnapshot} />
              ) : (
                <Workspace snapshot={workspaceSnapshot} onOpenCapture={onOpenCapture} onShareProfile={onShareProfile} />
              )}
            </div>
          </DeviceHero>
        </>
      ) : (
        <DevicesHome snapshot={snapshot} />
      )}
    </section>
  );
}
