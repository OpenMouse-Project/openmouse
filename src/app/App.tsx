import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as control from "../device/controller";
import { WORKSPACE_TAB_ORDER, type ControlSnapshot, type WorkspaceTab } from "../device/types";
import { t, connectLabelText, connectionText, ensureLocale, type I18nKey } from "../i18n";
import { interfaceThemeSlug } from "../interface-preferences";
import { CaptureDialog } from "./CaptureDialog";
import { Diagnostics, LogitechDetails } from "./Diagnostics";
import { InterfaceSettings } from "./InterfaceSettings";
import { PendingBar } from "./PendingBar";
import { KeychronNapeLayers } from "./KeychronNapeLayers";
import { Profiles } from "./Profiles";
import { Sidebar } from "./Sidebar";
import { Superstrike } from "./Superstrike";
import { ShareProfileDialog } from "./ShareProfileDialog";
import { ToastHost } from "./Toasts";
import { useControl } from "./useControl";
import { BatteryIcon } from "./ui";
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
import { TeevolutionProfileCard } from "./cards/teevolution/ProfileCard";
import type { MouseStatus } from "@openmouse/protocol/drivers";

function on(tab: WorkspaceTab, tabs: readonly WorkspaceTab[]): boolean {
  return tabs.includes(tab);
}

function DeviceOverview({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
  const locale = snapshot.preferences.locale;
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
          <span>{t(locale, "ov.battery")}</span>
          <strong className="battery-readout">
            <span id="battery-icon-slot">
              <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />
            </span>
            <span id="battery-value">{status.batteryPercent === null ? "—" : `${status.batteryPercent}%`}</span>
          </strong>
          <small id="battery-detail">{control.batteryDetail(status, locale)}</small>
        </article>
      ) : null}
      <article className="summary-stat">
        <span>{t(locale, "ov.firmware")}</span>
        <strong id="firmware-value">{status.firmware[0] ?? "—"}</strong>
        <small id="firmware-detail">
          {status.firmware.length > 1
            ? status.firmware.slice(1).join(" · ")
            : status.firmware.length === 1
              ? t(locale, "ov.fwSingle")
              : t(locale, "ov.fwNone")}
        </small>
      </article>
      <article className="summary-stat" data-pending-key="dongle-led">
        <span>{t(locale, "ov.connection")}</span>
        <strong id="connection-value">{connectionText(locale, status.connectionType)}</strong>
        <small id="connection-detail">
          {status.connectionDetail
            ?? (status.activeProfile
              ? `${t(locale, "ov.conn24")} · ${t(locale, "ov.profile")} ${status.activeProfile}`
              : t(locale, "ov.connReceiver"))}
        </small>
        {supportsDongleLed ? (
          <button id="dongle-led-toggle" className="dongle-led-button" type="button" onClick={control.toggleDongleLed}>
            {t(locale, "ov.led")}: {status.dongleLedEnabled ? t(locale, "ov.on") : t(locale, "ov.off")}
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
    show(has.teevolutionDpiLighting, ["lighting"])
      ? <TeevolutionDpiLightingCard key="teevo" snapshot={snapshot} /> : null,
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

export function App(): ReactNode {
  const snapshot = useControl();
  const panel = useRef<HTMLElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shareProfileOpen, setShareProfileOpen] = useState(false);
  const { preferences, status } = snapshot;
  const locale = preferences.locale;

  useEffect(() => {
    const element = panel.current?.closest<HTMLElement>(".control-shell");
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
    panel.current?.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" });
  }, [snapshot.workspaceTab]);

  useEffect(() => {
    try {
      document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
    } catch {
      /* non-DOM environment (tests) */
    }
    // A stored non-English locale resolves its table after first paint;
    // re-render once it arrives instead of sticking on fallback strings.
    if (locale !== "en") void ensureLocale(locale).then(() => control.refreshInterface());
  }, [locale]);

  const filterTabs = (status:MouseStatus|null):readonly WorkspaceTab[] => {
    var tempTabs = WORKSPACE_TAB_ORDER;
    const has = cardAvailability(snapshot);
    if(status==null)return tempTabs;
    if(!has.lighting&&!has.teevolutionDpiLighting)tempTabs=tempTabs.filter(tab=>tab!="lighting")
    if(!has.eggButtons&&
       !has.razerButtons&&
       !has.mxMasterButtons&&
       !has.atkButtons&&
       !has.buttonMapping&&
       !has.debounce&&
       !has.lightforce&&
       !has.eggSpdt&&
       !has.superstrike
    )tempTabs=tempTabs.filter(tab=>tab!="buttons")
    return tempTabs;
  }
  const tabs = filterTabs(status);
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
        preferences.glassIntensity <= 0 ? "is-glass-min" : "",
      ].filter(Boolean).join(" ")}
      data-interface-theme={interfaceThemeSlug(preferences.theme)}
      style={{ "--glass-intensity": preferences.glassIntensity }}
    >
      <Sidebar snapshot={snapshot} />

      <main className={`control-panel${snapshot.interfaceSettingsOpen ? " showing-settings" : ""}`} ref={panel}>
        <div className="panel-top">
          <header className="panel-header">
            <div className="panel-title">
              <div>
                <p className="overline">{t(locale, "panel.overline")}</p>
                <h1 id="device-title">{status?.name ?? t(locale, "panel.connectMouse")}</h1>
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
            {status ? (
              <button
                type="button"
                className="live-status-share"
                onClick={() => setShareProfileOpen(true)}
              >
                {t(locale, "panel.shareProfile")}
              </button>
            ) : null}
          </p>
        </div>

        {status ? null : (
          <section className="empty-state" aria-labelledby="empty-state-title">
            <h2 id="empty-state-title">
              {snapshot.previewListMessage ? t(locale, "empty.previewsTitle") : t(locale, "empty.title")}
            </h2>
            <p>
              {snapshot.previewListMessage ? (
                <>
                  {t(locale, "empty.previewsBody")}{" "}
                  {snapshot.previewEntries.map(([key], index) => (
                    <span key={key}>
                      {index > 0 ? " · " : null}
                      <a href={`?preview=${key}`} style={{ color: "var(--ui-accent)" }}>{key}</a>
                    </span>
                  ))}
                </>
              ) : (
                t(locale, "empty.body")
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
              {connectLabelText(locale, snapshot.connectLabel)}
            </button>
          </section>
        )}

        {status ? (
          <nav className="workspace-tabs device-data" role="tablist" aria-label={t(locale, "panel.deviceSections")}>
            <i className="lg-glass__refract" aria-hidden="true" />
            <i className="lg-glass__tint" aria-hidden="true" />
            <i className="lg-glass__specular" aria-hidden="true" />
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
                {t(locale, `tab.${tab}` as I18nKey)}
              </button>
            ))}
          </nav>
        ) : null}

        <Workspace snapshot={snapshot} onOpenCapture={() => setCaptureOpen(true)} />
        <InterfaceSettings snapshot={snapshot} />
      </main>

      <PendingBar snapshot={snapshot} />
      <CaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} locale={locale} />
      <ShareProfileDialog open={shareProfileOpen} onClose={() => setShareProfileOpen(false)} snapshot={snapshot} />
      <ToastHost toasts={snapshot.toasts} locale={locale} />
    </div>
  );
}
