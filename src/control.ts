import "./control.css";
import { estimateBatteryTime, saveBatterySample, type BatteryMode } from "./battery-history";
import { controlTemplate } from "./control-template";
import { bindControlEvents } from "./control-events";
import {
  clientSupportScore,
  createSupportedClient,
  describeHidDevice,
  listLogicalDevices,
  type PulsarClient,
  type SupportedClient,
} from "./device-clients";
import { renderDeviceSidebar as renderDeviceSidebarView } from "./device-sidebar";
import { renderEggControls } from "./devices/endgame/egg-controls-view";
import { formatHex, setControlValue, setText, setToggleValue } from "./ui/dom";
import {
  DEFAULT_INTERFACE_PREFERENCES,
  loadInterfacePreferences,
  saveInterfacePreferences as persistInterfacePreferences,
  type InterfaceDensity,
  type InterfaceTheme,
} from "./interface-preferences";
import {
  EGG_BUTTON_NAMES,
  EggOp1HidClient,
  type EggButtonIndex,
  type EggButtonMapping,
  type EggSpdtMode,
} from "./devices/endgame/egg-op1-hid";
import {
  EGG_WE_DISPLAY_NAME,
  eggWeAuthorizedPool,
  eggWeFromAuthorized,
  eggWeIsSupported,
  eggWeOwnsDevice,
  eggWePrepare,
  eggWeResolveConnect,
  isEggWeClient,
  type EggWeHidClient,
} from "./devices/endgame/egg-we-control";
import { LogitechHidppClient } from "./devices/logitech/hidpp";
import type { MouseStatus } from "./devices/mouse-types";
import { PulsarProHidClient } from "./devices/pulsar/pulsar-pro-hid";
import { OrbitalHidClient } from "./devices/orbital/hid";
import { SUPPORTED_HID_FILTERS } from "./devices/vendors";
import { WLMouseHidClient } from "./devices/wlmouse/hid";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

const appRoot = controlApp;

const BUILD_LABEL = `${__BUILD_CHANNEL__.toUpperCase()} · v${__APP_VERSION__}`;
let activeClient: LogitechHidppClient | null = null;
let activePulsarClient: PulsarClient | null = null;
let activeEggClient: EggOp1HidClient | null = null;
let activeEggWeClient: EggWeHidClient | null = null;
let activeWLMouseClient: WLMouseHidClient | null = null;
let activeOrbitalClient: OrbitalHidClient | null = null;
let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;
let lastRenderedStatusKey: string | null = null;
let activeDevice: HIDDevice | null = null;
const deviceStatuses = new Map<HIDDevice, MouseStatus>();
let latestDiagnosticsSnapshot = "";
let latestDiagnosticStatus: MouseStatus | null = null;
let lastDiagnosticCommand: string | null = null;
let lastDiagnosticError: string | null = null;
/** Prevents overlapping reconnect loops from leaving the UI stuck on "Reconnecting…". */
let reconnectInFlight = false;

function activeSettingsClient(): SupportedClient | null {
  return activeClient ?? activePulsarClient ?? activeEggClient ?? activeEggWeClient ?? activeWLMouseClient ?? activeOrbitalClient;
}

function hasActiveClient(): boolean {
  return activeSettingsClient() !== null;
}

let interfacePreferences = loadInterfacePreferences(localStorage);

function saveInterfacePreferences(): void {
  persistInterfacePreferences(localStorage, interfacePreferences);
  applyInterfacePreferences();
}

function applyInterfacePreferences(): void {
  const shell = document.querySelector<HTMLElement>(".control-shell");
  if (!shell) return;
  shell.classList.toggle("density-comfortable", interfacePreferences.density === "Comfortable");
  shell.classList.toggle("reduce-interface-motion", interfacePreferences.reducedMotion);
  shell.dataset.interfaceTheme = interfacePreferences.theme.toLowerCase();
  document.querySelectorAll<HTMLDetailsElement>(".egg-collapsible, .egg-experimental").forEach((details) => {
    details.open = interfacePreferences.expandSections;
  });
  const experimental = document.querySelector<HTMLElement>("#egg-polling-settings");
  if (experimental && activeEggClient && !activeEggWeClient) {
    experimental.style.display = interfacePreferences.showExperimental ? "block" : "none";
  }
}

function renderControl(): void {
  appRoot.innerHTML = controlTemplate(BUILD_LABEL);

  bindControlEvents({
    connect,
    selectAuthorizedDevice,
    openInterfaceSettings,
    closeInterfaceSettings,
    setInterfaceDensity: (value) => {
      interfacePreferences.density = value as InterfaceDensity;
      saveInterfacePreferences();
    },
    setInterfaceTheme: (value) => {
      interfacePreferences.theme = value as InterfaceTheme;
      saveInterfacePreferences();
    },
    setReducedMotion: (enabled) => {
      interfacePreferences.reducedMotion = enabled;
      saveInterfacePreferences();
    },
    setExpandSections: (enabled) => {
      interfacePreferences.expandSections = enabled;
      saveInterfacePreferences();
    },
    setShowExperimental: (enabled) => {
      interfacePreferences.showExperimental = enabled;
      saveInterfacePreferences();
    },
    resetInterfacePreferences: () => {
      interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES };
      saveInterfacePreferences();
      populateInterfaceSettings();
    },
    copyDiagnostics,
    chooseCustomDpi,
    finishCustomDpiEditing,
    applyLogitechAxisDpi,
    toggleDongleLed,
    applyPulsarValue,
    toggleSleep: (enabled) => applyPulsarValue("sleep", enabled ? lastSleepSeconds : WLMOUSE_SLEEP_NEVER),
    applyPulsarToggle,
    applyEggFilter,
    applyEggSpdtMode,
    applyEggCpiLevels,
    updateCustomPollingPreview,
    applyEggPollingDivider,
    applyProSetting,
    applyPollingRate,
    applyLiftOffDistance,
  });
  populateInterfaceSettings();
  applyInterfacePreferences();
  navigator.hid?.addEventListener("connect", handleHidConnect);
  navigator.hid?.addEventListener("disconnect", handleHidDisconnect);
  void reconnectAuthorizedDevice();
}

function openInterfaceSettings(): void {
  populateInterfaceSettings();
  document.querySelector<HTMLElement>("#interface-settings-page")?.classList.add("is-open");
  document.querySelector<HTMLElement>(".control-panel")?.scrollTo({ top: 0 });
}

function closeInterfaceSettings(): void {
  document.querySelector<HTMLElement>("#interface-settings-page")?.classList.remove("is-open");
}

function populateInterfaceSettings(): void {
  setControlValue("#interface-density", interfacePreferences.density);
  setControlValue("#interface-theme", interfacePreferences.theme);
  const reducedMotion = document.querySelector<HTMLInputElement>("#interface-reduced-motion");
  const expandSections = document.querySelector<HTMLInputElement>("#interface-expand-sections");
  const showExperimental = document.querySelector<HTMLInputElement>("#interface-show-experimental");
  if (reducedMotion) reducedMotion.checked = interfacePreferences.reducedMotion;
  if (expandSections) expandSections.checked = interfacePreferences.expandSections;
  if (showExperimental) showExperimental.checked = interfacePreferences.showExperimental;
}

function batteryMode(state: MouseStatus["batteryState"]): BatteryMode | null {
  if (state === "Charging" || state === "Charging slowly" || state === "Almost full") return "charging";
  if (state === "Discharging") return "discharging";
  return null;
}

function batteryDetail(status: MouseStatus): string {
  const voltage = status.batteryVoltageMv ? `${(status.batteryVoltageMv / 1000).toFixed(3)} V` : null;
  const withVoltage = (detail: string): string => voltage ? `${detail} · ${voltage}` : detail;
  if (status.batteryPercent === null) return withVoltage(status.batteryState);
  if (status.batteryState === "Full") return withVoltage("Fully charged");
  const mode = batteryMode(status.batteryState);
  if (!mode) return withVoltage(status.batteryState);
  const now = Date.now();
  const samples = saveBatterySample(localStorage, status.name, status.batteryPercent, mode, now);
  const estimate = estimateBatteryTime(samples, status.batteryPercent, mode, now);
  const label = mode === "charging" ? "until full" : "remaining";
  return withVoltage(estimate ? `${status.batteryState} · ${estimate} ${label}` : `${status.batteryState} · Calculating estimate`);
}

const WLMOUSE_SLEEP_NEVER = 0xffff;
const PULSAR_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [1, "10 seconds"], [3, "30 seconds"], [6, "1 minute"], [12, "2 minutes"],
  [30, "5 minutes"], [60, "10 minutes"], [180, "30 minutes"],
];
const WLMOUSE_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"], [300, "5 minutes"],
  [600, "10 minutes"], [1800, "30 minutes"],
];
const WLMOUSE_SLEEP_DEFAULT = 60;
let lastSleepSeconds = WLMOUSE_SLEEP_DEFAULT;

function fillSleepOptions(options: ReadonlyArray<readonly [number, string]>): void {
  const select = document.querySelector<HTMLSelectElement>("#sleep-select");
  if (!select || select.dataset.options === String(options[0][0])) return;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, String(value))));
  select.dataset.options = String(options[0][0]);
}

function resetDeviceSpecificPanels(): void {
  for (const selector of [
    "#egg-filter-settings",
    "#egg-spdt-settings",
    "#egg-polling-settings",
    "#egg-cpi-settings",
    "#egg-button-settings",
    "#pulsar-pro-settings",
  ]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.style.display = "none";
  }
  document.querySelector<HTMLElement>("#pulsar-advanced")?.classList.remove("egg-advanced-layout");
}

function diagnosticErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function recordDiagnosticCommand(command: string): void {
  lastDiagnosticCommand = command;
  lastDiagnosticError = null;
  if (latestDiagnosticStatus) renderDeviceDiagnostics(latestDiagnosticStatus);
}

function recordDiagnosticError(error: unknown, fallback: string): void {
  lastDiagnosticError = diagnosticErrorMessage(error, fallback);
  if (latestDiagnosticStatus) renderDeviceDiagnostics(latestDiagnosticStatus);
}

function renderDeviceDiagnostics(status: MouseStatus): void {
  const output = document.querySelector<HTMLPreElement>("#device-debug-snapshot");
  if (!output) return;

  const serializeCollection = (collection: HIDCollectionInfo): object => ({
    usagePage: `0x${formatHex(collection.usagePage, 4)}`,
    usage: `0x${formatHex(collection.usage, 4)}`,
    inputReports: collection.inputReports.map((report) => `0x${formatHex(report.reportId)}`),
    outputReports: collection.outputReports.map((report) => `0x${formatHex(report.reportId)}`),
    featureReports: collection.featureReports.map((report) => `0x${formatHex(report.reportId)}`),
    children: collection.children.map(serializeCollection),
  });

  const device = activeDevice;
  const driver = status.ui?.family ? `${status.brand} · ${status.ui.family}` : status.brand;
  const transport = [status.connectionType, status.connectionDetail].filter(Boolean).join(" · ") || "Not reported";
  const firmware = status.firmware.join(" · ") || "Not reported";
  const protocol = status.firmware.find((value) => /protocol/i.test(value)) ?? status.ui?.family ?? "Not reported";
  const overview = document.querySelector<HTMLElement>("#device-debug-overview");
  if (overview) {
    const items = [
      ["Driver", driver],
      ["VID / PID", device ? `0x${formatHex(device.vendorId, 4)} / 0x${formatHex(device.productId, 4)}` : "Not reported"],
      ["Transport", transport],
      ["Firmware", firmware],
      ["Protocol", protocol],
      ["Last command", lastDiagnosticCommand ?? "None"],
      ["Last error", lastDiagnosticError ?? "None"],
    ];
    overview.replaceChildren(...items.map(([label, value]) => {
      const item = document.createElement("div");
      const heading = document.createElement("small");
      const content = document.createElement("span");
      heading.textContent = label.toUpperCase();
      content.textContent = value;
      item.append(heading, content);
      return item;
    }));
  }
  const snapshot = {
    driver: {
      brand: status.brand,
      family: status.ui?.family ?? null,
      description: device ? describeHidDevice(device) : null,
    },
    webhid: device ? {
      productName: device.productName || null,
      vendorId: `0x${formatHex(device.vendorId, 4)}`,
      productId: `0x${formatHex(device.productId, 4)}`,
      opened: device.opened,
      collections: device.collections.map(serializeCollection),
    } : null,
    status,
    diagnostics: {
      lastCommand: lastDiagnosticCommand,
      lastError: lastDiagnosticError,
    },
  };
  latestDiagnosticsSnapshot = JSON.stringify(snapshot, null, 2);
  output.textContent = latestDiagnosticsSnapshot;
  const copyButton = document.querySelector<HTMLButtonElement>("#copy-diagnostics");
  if (copyButton) copyButton.disabled = false;
}

async function copyDiagnostics(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#diagnostic-copy-status");
  if (!latestDiagnosticsSnapshot) return;
  try {
    if (!navigator.clipboard) throw new Error("Clipboard access is unavailable.");
    await navigator.clipboard.writeText(latestDiagnosticsSnapshot);
    if (status) status.textContent = "Copied";
  } catch {
    const raw = document.querySelector<HTMLDetailsElement>("#device-debug-raw");
    const output = document.querySelector<HTMLPreElement>("#device-debug-snapshot");
    if (raw) raw.open = true;
    if (output) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(output);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (status) status.textContent = "Snapshot selected — press ⌘C / Ctrl+C";
  }
}

function showStatus(status: MouseStatus): void {
  latestDiagnosticStatus = status;
  lastRenderedStatusKey = JSON.stringify(status);
  // Driver UI hints (e.g. status.ui.family === "egg-we") avoid brand-specific imports.
  const ui = status.ui;
  const isEgg8k = activeEggClient !== null
    || (status.brand === "Endgame Gear" && Array.isArray(status.eggCpiStages));
  const isEggWe = ui?.family === "egg-we" || activeEggWeClient !== null;
  const isEgg = isEgg8k || isEggWe;
  const isWLMouse = ui?.family === "wlmouse" || activeWLMouseClient !== null;
  const settingsPending = ui?.settingsReady === false;
  const isWired = status.connectionType === "Wired";
  // Always clear device-specific panels first. A status read from the previous
  // mouse may have left these visible when WebHID switches devices.
  resetDeviceSpecificPanels();
  const batterySummary = document.querySelector<HTMLElement>("#battery-summary");
  if (batterySummary) {
    // 8K is wired-only (no battery). Drivers may force the column via ui.forceShowBattery.
    const hideBattery = isEgg8k
      || (isWired && !ui?.forceShowBattery && status.batteryPercent === null);
    batterySummary.hidden = hideBattery;
    batterySummary.style.display = hideBattery ? "none" : "flex";
  }
  const overview = document.querySelector<HTMLElement>(".device-overview");
  if (overview) {
    const showBatteryColumn = !isEgg8k
      && (ui?.forceShowBattery || !isWired || status.batteryPercent !== null);
    overview.style.gridTemplateColumns = showBatteryColumn ? "repeat(3, 1fr)" : "repeat(2, 1fr)";
  }
  setText("#polling-note", ui?.pollingNote
    ?? (isEgg8k
      ? "Higher rates update cursor movement more often and increase CPU/USB processing load."
      : "Higher rates update cursor movement more often, but use more battery."));
  const pollingCard = document.querySelector<HTMLElement>("[data-rate]")?.closest<HTMLElement>(".setting-card");
  if (pollingCard) {
    pollingCard.hidden = false;
    pollingCard.style.display = "";
  }
  for (const selector of ["#signal-settings", "#sleep-settings"]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.hidden = isEgg;
  }
  const debounceSettings = document.querySelector<HTMLElement>("#debounce-settings");
  if (debounceSettings) {
    const showDebounce = status.debounceMs !== null && status.debounceMs !== undefined
      && (status.brand === "Pulsar" || isWLMouse);
    debounceSettings.hidden = !showDebounce;
  }
  const signalSettings = document.querySelector<HTMLElement>("#signal-settings");
  if (signalSettings) signalSettings.hidden = isEgg || isWLMouse;
  const performanceModeSetting = document.querySelector<HTMLElement>("#performance-mode-setting");
  if (performanceModeSetting) {
    const hidePerformanceMode = isEgg || isWLMouse;
    performanceModeSetting.hidden = hidePerformanceMode;
    performanceModeSetting.style.display = hidePerformanceMode ? "none" : "flex";
  }
  const processingCard = document.querySelector<HTMLElement>("#motion-sync-toggle")?.closest<HTMLElement>(".setting-card");
  if (processingCard && processingCard.id !== "egg-filter-settings") {
    processingCard.style.display = ui?.hideProcessingCard ? "none" : "";
  }
  const battery = status.batteryPercent === null ? "—" : `${status.batteryPercent}%`;
  const dpiOutputField = document.querySelector<HTMLInputElement>("#dpi-output");
  if (dpiOutputField?.readOnly) dpiOutputField.value = `${status.dpi.toLocaleString()} DPI`;
  setText("#battery-value", battery);
  setText("#battery-detail", batteryDetail(status));
  setText("#firmware-value", status.firmware[0] ?? "—");
  setText("#firmware-detail", status.firmware.length > 1
    ? status.firmware.slice(1).join(" · ")
    : status.firmware.length === 1
      ? "Firmware reported by mouse"
      : "Not reported");
  setText("#connection-value", status.connectionType ?? "Wireless");
  setText("#connection-detail", status.connectionDetail
    ?? (status.activeProfile ? `2.4 GHz · Profile ${status.activeProfile}` : "2.4 GHz receiver"));
  const dongleLedButton = document.querySelector<HTMLButtonElement>("#dongle-led-toggle");
  if (dongleLedButton) {
    const supported = status.brand === "Pulsar" && status.dongleLedEnabled !== null && status.dongleLedEnabled !== undefined;
    dongleLedButton.hidden = !supported;
    dongleLedButton.disabled = !supported;
    dongleLedButton.dataset.enabled = status.dongleLedEnabled ? "true" : "false";
    dongleLedButton.textContent = status.dongleLedEnabled ? "Receiver LED: On" : "Receiver LED: Off";
  }
  const advanced = document.querySelector<HTMLElement>("#pulsar-advanced");
  if (advanced) {
    const showAdvanced = status.brand === "Pulsar" || isEgg8k || isWLMouse;
    advanced.style.display = showAdvanced ? "grid" : "none";
    advanced.classList.toggle("egg-advanced-layout", isEgg8k);
  }
  const settingsGrid = document.querySelector<HTMLElement>(".settings-grid.device-data");
  if (settingsGrid) settingsGrid.style.display = settingsPending ? "none" : "";

  const sleepToggle = document.querySelector<HTMLElement>("#sleep-toggle");
  if (sleepToggle) sleepToggle.hidden = !isWLMouse;
  if (isWLMouse) {
    fillSleepOptions(WLMOUSE_SLEEP_OPTIONS);
    if (status.sleepTimeout) lastSleepSeconds = status.sleepTimeout;
    setToggleValue("#sleep-toggle", status.sleepTimeout !== null && status.sleepTimeout !== undefined);
    setControlValue("#debounce-select", status.debounceMs);
    setControlValue("#sleep-select", status.sleepTimeout);
    setToggleValue("#motion-sync-toggle", status.motionSync);
    setToggleValue("#angle-snapping-toggle", status.angleSnapping);
    setToggleValue("#ripple-control-toggle", status.rippleControl);
  }
  if (status.brand === "Pulsar" || status.brand === "Endgame Gear") {
    fillSleepOptions(PULSAR_SLEEP_OPTIONS);
    const strength = status.signalStrength;
    setText("#signal-output", strength === null || strength === undefined ? "—" : `${strength}/4`);
    setText("#signal-detail", strength === null || strength === undefined
      ? "Receiver signal is unavailable."
      : ["Very weak", "Weak", "Fair", "Good", "Excellent"][strength] ?? `Level ${strength}`);
    setControlValue("#debounce-select", status.debounceMs);
    setControlValue("#sleep-select", status.sleepTimeout);
    setToggleValue("#motion-sync-toggle", status.motionSync);
    setToggleValue("#angle-snapping-toggle", status.angleSnapping);
    setToggleValue("#ripple-control-toggle", status.rippleControl);
    setToggleValue("#performance-mode-toggle", status.performanceMode);
    const eggFilterSettings = document.querySelector<HTMLElement>("#egg-filter-settings");
    const eggSpdtSettings = document.querySelector<HTMLElement>("#egg-spdt-settings");
    const eggPollingSettings = document.querySelector<HTMLElement>("#egg-polling-settings");
    const eggCpiSettings = document.querySelector<HTMLElement>("#egg-cpi-settings");
    const eggButtonSettings = document.querySelector<HTMLElement>("#egg-button-settings");
    if (eggFilterSettings) eggFilterSettings.style.display = isEgg8k ? "block" : "none";
    if (eggSpdtSettings) eggSpdtSettings.style.display = isEgg8k ? "block" : "none";
    if (eggPollingSettings) eggPollingSettings.style.display = isEgg8k && interfacePreferences.showExperimental ? "block" : "none";
    if (eggCpiSettings) eggCpiSettings.style.display = isEgg8k ? "block" : "none";
    if (eggButtonSettings) eggButtonSettings.style.display = isEgg8k ? "block" : "none";
    if (isEgg8k) {
      setToggleValue("#slamclick-filter-toggle", status.slamclickFilter);
      setToggleValue("#motion-jitter-filter-toggle", status.motionJitterFilter);
      setControlValue("#left-spdt-select", status.leftSpdtMode);
      setControlValue("#right-spdt-select", status.rightSpdtMode);
      setControlValue("#egg-cpi-levels", status.eggCpiLevels);
      setControlValue("#egg-polling-divider", status.eggPollingDivider);
      updateCustomPollingPreview();
      renderEggControls(status, {
        applyCpiStage: applyEggCpiStage,
        applyMulticlick: applyEggMulticlick,
        applyButtonMapping: applyEggButtonMapping,
      });
    }
    const proSettings = document.querySelector<HTMLElement>("#pulsar-pro-settings");
    const isPro = status.connectionDetail?.includes("Pulsar Pro protocol") === true;
    if (proSettings) proSettings.style.display = isPro ? "block" : "none";
    if (isPro) {
      setToggleValue("#wheel-acceleration-toggle", status.wheelAcceleration);
      setControlValue("#angle-tuning-select", status.angleTuning);
      setControlValue("#profile-select", status.activeProfile);
    }
  }
  setText("#device-title", status.name);
  if (activeDevice) {
    deviceStatuses.set(activeDevice, status);
    void renderDeviceSidebar();
  }
  setText("#device-status", "Connected");
  // Same banner copy as other brands — no RE/debug messaging in the chrome.
  setText("#connection-banner", "Connected directly through WebHID. Supported settings can be adjusted here.");
  if (settingsPending) {
    setText("#read-status", status.batteryPercent === null
      ? "Connected"
      : `Battery ${status.batteryPercent}%`);
  } else {
    setText("#read-status", `Current: ${status.dpi.toLocaleString()} DPI · ${status.pollingRateHz.toLocaleString()} Hz`);
  }
  const meter = document.querySelector<HTMLElement>("#battery-meter");
  if (meter) meter.style.width = status.batteryPercent === null ? "0%" : `${status.batteryPercent}%`;
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.rate) === status.pollingRateHz));
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => button.classList.toggle("selected", button.dataset.lod === status.liftOffDistance));
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    const rate = Number(button.dataset.rate);
    const supportedRates = status.supportedPollingRates;
    const unsupportedForEgg8k = isEgg8k && rate < 1000;
    const unsupportedForListed = Array.isArray(supportedRates) && !supportedRates.includes(rate);
    const hideListed = (status.brand === "Logitech" || ui?.hideUnsupportedPollingRates) && unsupportedForListed;
    const hide = unsupportedForEgg8k || hideListed || settingsPending;
    button.hidden = hide;
    button.disabled = hide || settingsPending;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    const hideLow = button.dataset.lod === "Low"
      && (isEgg || ui?.hideLodLow === true);
    button.hidden = hideLow;
    button.disabled = hideLow || settingsPending
      || (status.brand === "Logitech" && button.dataset.lod === "Low");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.dpi) === status.dpi);
    button.disabled = settingsPending;
  });
  const customDpi = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (customDpi) customDpi.disabled = settingsPending;
  if (dpiOutputField && settingsPending) {
    dpiOutputField.value = "—";
    dpiOutputField.readOnly = true;
  }
  const axisControls = document.querySelector<HTMLElement>("#logitech-axis-controls");
  const showSeparateDpiAxes = status.brand === "Logitech" && status.supportsSeparateDpiAxes === true;
  if (axisControls) axisControls.style.display = showSeparateDpiAxes ? "block" : "none";
  settingsGrid?.classList.toggle("has-logitech-axis-controls", showSeparateDpiAxes);
  const dpiX = document.querySelector<HTMLInputElement>("#logitech-dpi-x");
  const dpiY = document.querySelector<HTMLInputElement>("#logitech-dpi-y");
  if (dpiX) dpiX.value = String(status.dpi);
  if (dpiY) dpiY.value = String(status.dpiY ?? status.dpi);
  const logitechDetails = document.querySelector<HTMLElement>("#logitech-device-details");
  if (logitechDetails) logitechDetails.style.display = status.brand === "Logitech" ? "block" : "none";
  if (status.brand === "Logitech") renderLogitechDetails(status);
  renderDeviceDiagnostics(status);
}

function renderLogitechDetails(status: MouseStatus): void {
  const list = document.querySelector<HTMLElement>("#logitech-detail-list");
  if (!list) return;
  const transports = Object.entries(status.transportIds ?? {})
    .map(([name, id]) => `${name}: ${id}`)
    .join(" · ") || "Not reported";
  const rates = status.supportedPollingRates?.map((rate) => `${rate >= 1000 ? `${rate / 1000}K` : rate} Hz`).join(", ") || "Not reported";
  const items = [
    ["Mode", status.deviceMode ?? "Unknown"],
    ["Active profile", status.activeProfile === null ? "None in host mode" : `Profile ${status.activeProfile}`],
    ["Model ID", status.modelId ?? "Not reported"],
    ["Unit ID", status.unitId ?? "Not reported"],
    ["Transport IDs", transports],
    ["Advertised polling", rates],
    ["DPI axes", status.supportsSeparateDpiAxes ? `X ${status.dpi} · Y ${status.dpiY ?? status.dpi}` : "Linked X/Y"],
  ];
  list.innerHTML = items.map(([label, value]) =>
    `<div style="padding:.55rem;border:1px solid #29292d;border-radius:7px;background:#141416"><small style="display:block;margin-bottom:.25rem;color:#77777c;font-size:.52rem;letter-spacing:.08em">${label.toUpperCase()}</small><span style="color:#d8d8dc;font:600 .67rem 'JetBrains Mono',monospace;overflow-wrap:anywhere">${value}</span></div>`).join("");
}

async function showPulsarExplorer(client: PulsarClient): Promise<void> {
  await client.open();
  const device = client.device;
  setText("#connection-value", "Connected");
  setText("#connection-detail", "Reading Pulsar receiver identity");
  setText("#device-title", device.productName || "Pulsar Mouse");
  setText("#device-status", "Connected");
  setText("#connection-banner", "Pulsar vendor HID connected. Reading verified settings.");
  setText("#read-status", client.describeCollections());
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  const info = await client.readDeviceInfo();
  setText("#connection-value", info.connection);
  setText("#connection-detail", `CID 0x${formatHex(info.cid)} · MID 0x${formatHex(info.mid)} · Type ${info.type} · Dongle ${info.dongleType}`);
  const status = await client.readStatus();
  dpiOptions = client.getDpiOptions();
  configureDpiControl(status.dpi);
  showStatus(status);
  startAutomaticRefresh();
}

async function renderDeviceSidebar(devices?: HIDDevice[]): Promise<void> {
  const all = devices ?? await navigator.hid?.getDevices() ?? [];
  renderDeviceSidebarView(all, deviceStatuses, activeDevice);
}

async function selectAuthorizedDevice(index: number): Promise<void> {
  if (settingInProgress || refreshInProgress) return;
  const devices = listLogicalDevices(await navigator.hid?.getDevices() ?? []);
  const device = devices[index];
  if (!device || device === activeDevice) return;
  const client = createSupportedClient(device);
  if (!client) return;
  setText("#device-status", "Switching");
  setText("#read-status", `Reading ${statusNameForClient(client)}.`);
  try {
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to switch devices.";
    setText("#device-status", "Connection failed");
    setText("#read-status", message);
  }
}

function statusNameForClient(client: SupportedClient): string {
  if (isEggWeClient(client)) return EGG_WE_DISPLAY_NAME;
  return client.device.productName || "the selected mouse";
}

async function activateClient(client: SupportedClient): Promise<void> {
  resetDeviceSpecificPanels();
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeEggWeClient = null;
  activeWLMouseClient = null;
  activeOrbitalClient = null;
  activeDevice = client.device;
  recordDiagnosticCommand("Read device status");
  lastRenderedStatusKey = null;
  if (client instanceof WLMouseHidClient) {
    activeWLMouseClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
    await client.startNotifications(() => {
      void refreshStatus();
    }).catch(() => false);
  } else if (client instanceof EggOp1HidClient) {
    activeEggClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (isEggWeClient(client)) {
    await eggWePrepare(client);
    activeEggWeClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof LogitechHidppClient) {
    activeClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = await client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof OrbitalHidClient) {
    activeOrbitalClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else {
    activePulsarClient = client;
    await showPulsarExplorer(client);
  }
  await renderDeviceSidebar();
  startAutomaticRefresh();
  // Always restore the sidebar action after a successful activate.
  setConnectionButtons(false, "Add device");
}

function showDisconnectedState(): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeEggWeClient = null;
  activeWLMouseClient = null;
  activeOrbitalClient = null;
  activeDevice = null;
  lastRenderedStatusKey = null;
  resetDeviceSpecificPanels();
  const advanced = document.querySelector<HTMLElement>("#pulsar-advanced");
  if (advanced) advanced.style.display = "none";
  document.querySelector<HTMLElement>(".control-shell")?.classList.add("is-empty");
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.add("is-idle"));
  setText("#device-title", "Connect a mouse");
  setText("#device-status", "No device connected");
  setText("#connection-banner", "Connect a supported device to view and change its settings.");
  setText("#read-status", "Add a supported device from the sidebar to read its current status.");
  setConnectionButtons(false, "Add device");
}

function handleHidConnect(event: HIDConnectionEvent): void {
  const client = createSupportedClient(event.device);
  if (!client) {
    void renderDeviceSidebar();
    return;
  }

  if (isEggWeClient(client)) {
    void (async () => {
      const all = await navigator.hid?.getDevices() ?? [];
      await renderDeviceSidebar(all);
      const result = await eggWeResolveConnect(event.device, activeEggWeClient, activeDevice, all);
      if (result.action === "ignore") return;
      if (result.action === "refresh") {
        try {
          const status = await result.client.readStatus();
          deviceStatuses.set(result.client.device, status);
          showStatus(status);
          startAutomaticRefresh();
        } catch {
          /* keep existing UI */
        }
        return;
      }
      setText("#device-status", result.reason === "path" ? "Switching path" : "New device detected");
      setText("#read-status", result.reason === "path"
        ? "Preferring USB over receiver."
        : `Reading ${EGG_WE_DISPLAY_NAME}.`);
      await activateClient(result.client);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to read the connected mouse.";
      setText("#device-status", "Connection failed");
      setText("#read-status", message);
      void renderDeviceSidebar();
    });
    return;
  }

  setText("#device-status", "New device detected");
  setText("#read-status", `Reading ${event.device.productName || "the connected mouse"}.`);
  void activateClient(client).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unable to read the connected mouse.";
    setText("#device-status", "Connection failed");
    setText("#read-status", message);
    void renderDeviceSidebar();
  });
}

function handleHidDisconnect(event: HIDConnectionEvent): void {
  deviceStatuses.delete(event.device);
  // Multi-collection drivers (cmd + notify) treat either handle as the active mouse.
  if (event.device !== activeDevice && !eggWeOwnsDevice(activeEggWeClient, event.device)) {
    void renderDeviceSidebar();
    return;
  }
  showDisconnectedState();
  void (async () => {
    const devices = (await navigator.hid?.getDevices() ?? [])
      .filter((device) => device !== event.device);
    const logical = listLogicalDevices(devices);
    const replacement = logical
      .map(createSupportedClient)
      .find((client): client is SupportedClient => client !== null);
    if (replacement) {
      await activateClient(replacement);
    } else {
      await renderDeviceSidebar(devices);
    }
  })().catch((error: unknown) => {
    setText("#read-status", error instanceof Error ? error.message : "Unable to switch to another connected mouse.");
    void renderDeviceSidebar();
  });
}

async function requestSupportedClient(): Promise<SupportedClient | null> {
  if (!navigator.hid) throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
  const devices = await navigator.hid.requestDevice({
    filters: SUPPORTED_HID_FILTERS,
  });
  if (devices.length === 0) return null;

  // Dual-collection drivers (e.g. WE) need the full authorized set.
  if (devices.some((device) => eggWeIsSupported(device))) {
    const weClient = eggWeFromAuthorized(await eggWeAuthorizedPool(devices));
    if (weClient) return weClient;
  }

  const ranked = devices
    .map((device) => ({ device, client: createSupportedClient(device), score: clientSupportScore(device) }))
    .filter((entry) => entry.client !== null)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (best?.client) {
    if (isEggWeClient(best.client)) await eggWePrepare(best.client);
    return best.client;
  }

  const details = devices.map((device) => describeHidDevice(device)).join(" · ");
  throw new Error(
    `Selected device is not a supported control interface (${details}). `
    + "Pick a vendor control interface (not a plain boot mouse). "
    + "If this keeps failing, note the VID/PID from this message.",
  );
}

async function connect(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  setConnectionButtons(true, "Connecting…");
  setText("#device-status", "Requesting permission");
  setText("#read-status", "Choose your device in the browser prompt.");

  try {
    const client = await requestSupportedClient();
    if (!client) {
      setText("#device-status", "Not connected");
      setText("#read-status", "No device was selected in the browser prompt.");
      return;
    }
    setText("#device-status", "Opening device");
    setText("#read-status", `Reading ${statusNameForClient(client)}…`);
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the mouse.";
    await activeEggClient?.close().catch(() => undefined);
    activeEggClient = null;
    await activeEggWeClient?.close().catch(() => undefined);
    activeEggWeClient = null;
    setText("#device-status", "Connection failed");
    setText("#connection-banner", message);
    setText("#read-status", message);
  } finally {
    // Always clear the busy label — success used to leave "Connecting…" stuck.
    setConnectionButtons(false, "Add device");
  }
}

async function reconnectAuthorizedDevice(): Promise<void> {
  if (hasActiveClient() || reconnectInFlight) return;
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  reconnectInFlight = true;
  setConnectionButtons(true, "Reconnecting…");

  let lastError: Error | null = null;
  try {
    // Browsers can restore WebHID authorization a fraction of a second after the
    // page is ready. Poll quickly at first so reloads do not feel stalled, then
    // keep a few wider retries for slower USB enumeration.
    const retryDelays = [0, 40, 60, 75, 100, 150, 225, 350, 500, 750];
    for (const delay of retryDelays) {
      // Another path (HID connect handler) may have already activated a client.
      if (hasActiveClient()) return;
      if (delay) await waitForHidChange(delay);
      if (hasActiveClient()) return;

      const devices = await navigator.hid?.getDevices() ?? [];
      const clients = listLogicalDevices(devices)
        .map((device) => ({ client: createSupportedClient(device), score: clientSupportScore(device) }))
        .filter((entry): entry is { client: SupportedClient; score: number } => entry.client !== null)
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.client);
      await renderDeviceSidebar(devices);
      if (clients.length === 0) continue;

      for (const client of clients) {
        if (hasActiveClient()) return;
        try {
          setText("#device-status", "Reconnecting");
          setText("#read-status", "Reading the previously authorized device.");
          await activateClient(client);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unable to reconnect to the mouse.");
          await client.close().catch(() => undefined);
        }
      }
    }
    if (!hasActiveClient()) {
      setText("#device-status", "Not connected");
      if (lastError) setText("#connection-banner", lastError.message);
      setText("#read-status", "Use Add device if the mouse does not reconnect automatically.");
    }
  } finally {
    reconnectInFlight = false;
    // Always restore the button — previously success left "Reconnecting…" forever.
    setConnectionButtons(false, "Add device");
  }
}

function setConnectionButtons(disabled: boolean, label: string): void {
  document.querySelectorAll<HTMLButtonElement>("#connect-button, #empty-connect-button").forEach((button) => {
    button.disabled = disabled;
    button.textContent = label;
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForHidChange(milliseconds: number): Promise<void> {
  const hid = navigator.hid;
  if (!hid) return wait(milliseconds);
  return new Promise((resolve) => {
    const finish = (): void => {
      window.clearTimeout(timer);
      hid.removeEventListener("connect", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, milliseconds);
    hid.addEventListener("connect", finish, { once: true });
  });
}

function configureDpiControl(currentDpi: number): void {
  const presets = document.querySelector<HTMLElement>("#dpi-presets");
  const custom = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!presets || !custom || dpiOptions.length === 0) return;
  const common = [400, 800, 1600, 3200, 6400, 8000].filter((dpi) => dpiOptions.includes(dpi));
  const values = common.includes(currentDpi) ? common : [...common, currentDpi].sort((a, b) => a - b);
  presets.innerHTML = values.map((dpi) => `<button type="button" data-dpi="${dpi}" class="${dpi === currentDpi ? "selected" : ""}">${dpi.toLocaleString()}</button>`).join("");
  presets.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    button.addEventListener("click", () => void applyDpiValue(Number(button.dataset.dpi)));
  });
  custom.disabled = false;
}

async function chooseCustomDpi(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  const button = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!input || !button) return;
  if (input.readOnly) {
    input.dataset.previousValue = input.value;
    input.readOnly = false;
    input.value = input.value.replace(/[^\d]/g, "");
    button.textContent = "Apply";
    input.focus();
    input.select();
    return;
  }
  const dpi = Number(input.value.replace(/[^\d]/g, ""));
  if (!Number.isInteger(dpi) || !dpiOptions.includes(dpi)) {
    setText("#read-status", "That DPI value is not supported by this mouse.");
    input.focus();
    input.select();
    return;
  }
  if (await applyDpiValue(dpi)) finishCustomDpiEditing(dpi);
}

function finishCustomDpiEditing(dpi?: number): void {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  const button = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!input || !button) return;
  const fallback = Number((input.dataset.previousValue ?? input.value).replace(/[^\d]/g, "")) || dpiOptions[0] || 800;
  input.readOnly = true;
  input.value = `${(dpi ?? fallback).toLocaleString()} DPI`;
  delete input.dataset.previousValue;
  button.textContent = "Custom";
}

async function applyDpiValue(dpi: number): Promise<boolean> {
  const client = activeSettingsClient();
  if (!client || !dpiOptions.includes(dpi) || refreshInProgress || settingInProgress) return false;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-dpi], #custom-dpi");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${dpi.toLocaleString()} DPI…`);
  recordDiagnosticCommand(`Set DPI to ${dpi.toLocaleString()}`);
  try {
    await client.setDpi(dpi);
    showStatus(await client.readStatus());
    setText("#dpi-pending", `Confirmed at ${dpi.toLocaleString()} DPI`);
    return true;
  } catch (error) {
    recordDiagnosticError(error, "Unable to set DPI.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to set DPI.");
    return false;
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function applyLogitechAxisDpi(): Promise<void> {
  if (!activeClient || refreshInProgress || settingInProgress) return;
  const dpiX = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-x")?.value);
  const dpiY = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-y")?.value);
  if (!dpiOptions.includes(dpiX) || !dpiOptions.includes(dpiY)) {
    setText("#read-status", "Both axis values must be advertised DPI values.");
    return;
  }
  settingInProgress = true;
  setText("#read-status", `Setting X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()} DPI…`);
  recordDiagnosticCommand(`Set DPI axes to X ${dpiX.toLocaleString()} / Y ${dpiY.toLocaleString()}`);
  try {
    await activeClient.setDpi(dpiX, dpiY);
    showStatus(await activeClient.readStatus());
    setText("#dpi-pending", `Confirmed X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()} DPI`);
  } catch (error) {
    recordDiagnosticError(error, "Unable to set axis DPI.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to set axis DPI.");
  } finally {
    settingInProgress = false;
  }
}

async function applyPollingRate(rate: number): Promise<void> {
  const client = activeSettingsClient();
  if (!client || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-rate]");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  setText("#read-status", `Setting ${rate.toLocaleString()} Hz…`);
  recordDiagnosticCommand(`Set polling rate to ${rate.toLocaleString()} Hz`);
  try {
    await client.setPollingRate(rate);
    showStatus(await client.readStatus());
  } catch (error) {
    recordDiagnosticError(error, "Unable to set polling rate.");
    const status = await client.readStatus().catch(() => null);
    if (status) showStatus(status);
    setText("#read-status", error instanceof Error ? error.message : "Unable to set polling rate.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
  const client = activeSettingsClient();
  if (!client || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-lod]");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${lod.toLowerCase()} lift-off distance…`);
  recordDiagnosticCommand(`Set lift-off distance to ${lod}`);
  try {
    await client.setLiftOffDistance(lod);
    showStatus(await client.readStatus());
  } catch (error) {
    recordDiagnosticError(error, "Unable to set lift-off distance.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to set lift-off distance.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => {
      button.disabled = activeClient !== null && button.dataset.lod === "Low";
    });
  }
}

async function toggleDongleLed(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#dongle-led-toggle");
  if (!button || !activePulsarClient || settingInProgress) return;
  const enabled = button.dataset.enabled !== "true";
  settingInProgress = true;
  button.disabled = true;
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} the receiver LED…`);
  recordDiagnosticCommand(`${enabled ? "Enable" : "Disable"} receiver LED`);
  try {
    await activePulsarClient.setDongleLed(enabled);
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    recordDiagnosticError(error, "Unable to change the receiver LED.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the receiver LED.");
  } finally {
    settingInProgress = false;
    button.disabled = false;
  }
}

type PulsarToggleSetting = "motionSync" | "angleSnapping" | "rippleControl" | "performanceMode";

async function applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): Promise<void> {
  const client = activePulsarClient ?? activeEggClient ?? activeWLMouseClient ?? activeOrbitalClient;
  if (!client || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} ${settingLabel(setting)}…`);
  recordDiagnosticCommand(`${enabled ? "Enable" : "Disable"} ${settingLabel(setting)}`);
  try {
    if (setting === "motionSync") await client.setMotionSync(enabled);
    if (setting === "angleSnapping") await client.setAngleSnapping(enabled);
    if (setting === "rippleControl") await client.setRippleControl(enabled);
    if (setting === "performanceMode" && !activePulsarClient && !activeOrbitalClient) throw new Error("Performance mode is not exposed by this device's protocol.");
    if (setting === "performanceMode") await (activePulsarClient ?? activeOrbitalClient)!.setPerformanceMode(enabled);
    showStatus(await client.readStatus());
  } catch (error) {
    recordDiagnosticError(error, "Unable to change the setting.");
    const status = await client.readStatus().catch(() => null);
    if (status) showStatus(status);
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar setting.");
  } finally {
    settingInProgress = false;
  }
}

function settingLabel(setting: PulsarToggleSetting): string {
  return ({
    motionSync: "Motion Sync",
    angleSnapping: "angle snapping",
    rippleControl: "ripple control",
    performanceMode: "performance mode",
  } as const)[setting];
}

async function applyEggFilter(setting: "slamclick" | "motionJitter", enabled: boolean): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  settingInProgress = true;
  const label = setting === "slamclick" ? "slamclick filter" : "motion-jitter filter";
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} ${label}…`);
  recordDiagnosticCommand(`${enabled ? "Enable" : "Disable"} ${label}`);
  try {
    if (setting === "slamclick") await activeEggClient.setSlamclickFilter(enabled);
    else await activeEggClient.setMotionJitterFilter(enabled);
    showStatus(await activeEggClient.readStatus());
  } catch (error) {
    recordDiagnosticError(error, `Unable to change the ${label}.`);
    setText("#read-status", error instanceof Error ? error.message : `Unable to change the ${label}.`);
    const status = await activeEggClient.readStatus().catch(() => null);
    if (status) showStatus(status);
  } finally {
    settingInProgress = false;
  }
}

async function applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Setting the ${button} button to ${mode}…`);
  recordDiagnosticCommand(`Set ${button} button GX mode to ${mode}`);
  try {
    await activeEggClient.setSpdtMode(button, mode);
    showStatus(await activeEggClient.readStatus());
  } catch (error) {
    recordDiagnosticError(error, `Unable to change the ${button} button GX mode.`);
    setText("#read-status", error instanceof Error ? error.message : `Unable to change the ${button} button GX mode.`);
    const status = await activeEggClient.readStatus().catch(() => null);
    if (status) showStatus(status);
  } finally {
    settingInProgress = false;
  }
}

function updateCustomPollingPreview(): void {
  const divider = Number(document.querySelector<HTMLInputElement>("#egg-polling-divider")?.value);
  setText("#egg-polling-result", Number.isInteger(divider) && divider > 0 && divider <= 255
    ? `Result: ${(8000 / divider).toLocaleString(undefined, { maximumFractionDigits: 2 })} Hz`
    : "Enter a divider from 1 to 255.");
}


async function applyEggCpiLevels(levels: number): Promise<void> {
  await applyEggChange("CPI stage count", async (client) => client.setCpiLevels(levels));
}

async function applyEggCpiStage(level: number, x: number, y: number): Promise<void> {
  await applyEggChange(`CPI stage ${level + 1}`, async (client) => client.setCpiStage(level, x, y));
}

async function applyEggPollingDivider(divider: number): Promise<void> {
  await applyEggChange("custom polling divider", async (client) => client.setCustomPollingDivider(divider));
}

async function applyEggMulticlick(button: EggButtonIndex, value: number): Promise<void> {
  await applyEggChange(`${EGG_BUTTON_NAMES[button]} multiclick filter`, async (client) => client.setMulticlickFilter(button, value));
}

async function applyEggButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): Promise<void> {
  await applyEggChange(`${EGG_BUTTON_NAMES[button]} mapping`, async (client) => client.setButtonMapping(button, mapping));
}

async function applyEggChange(label: string, change: (client: EggOp1HidClient) => Promise<void>): Promise<void> {
  if (!activeEggClient || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Changing ${label}…`);
  recordDiagnosticCommand(`Change ${label}`);
  try {
    await change(activeEggClient);
    showStatus(await activeEggClient.readStatus());
  } catch (error) {
    recordDiagnosticError(error, `Unable to change ${label}.`);
    setText("#read-status", error instanceof Error ? error.message : `Unable to change ${label}.`);
    const status = await activeEggClient.readStatus().catch(() => null);
    if (status) showStatus(status);
  } finally {
    settingInProgress = false;
  }
}

async function applyPulsarValue(setting: "debounce" | "sleep", value: number): Promise<void> {
  const client = activePulsarClient ?? activeWLMouseClient ?? activeOrbitalClient;
  if (!client || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Setting ${setting === "debounce" ? `${value} ms debounce` : "auto sleep"}…`);
  recordDiagnosticCommand(setting === "debounce" ? `Set debounce to ${value} ms` : `Set auto sleep to ${value} seconds`);
  try {
    if (setting === "debounce") await client.setDebounceTime(value);
    else await client.setSleepTimeout(value);
    showStatus(await client.readStatus());
  } catch (error) {
    recordDiagnosticError(error, "Unable to change that setting.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to change that setting.");
  } finally {
    settingInProgress = false;
  }
}

async function applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): Promise<void> {
  if (!(activePulsarClient instanceof PulsarProHidClient) || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Changing ${setting === "wheelAcceleration" ? "wheel acceleration" : setting === "angleTuning" ? "angle tuning" : "onboard profile"}…`);
  recordDiagnosticCommand(`Change ${setting === "wheelAcceleration" ? "wheel acceleration" : setting === "angleTuning" ? "angle tuning" : "onboard profile"}`);
  try {
    if (setting === "wheelAcceleration") await activePulsarClient.setWheelAcceleration(Boolean(value));
    if (setting === "angleTuning") await activePulsarClient.setAngleTuning(Number(value));
    if (setting === "profile") await activePulsarClient.setProfile(Number(value));
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    recordDiagnosticError(error, "Unable to change the Pulsar Pro setting.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar Pro setting.");
  } finally {
    settingInProgress = false;
  }
}

function startAutomaticRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  const client = activeSettingsClient();
  const interval = client && "pollIntervalMs" in client
    ? Number((client as { pollIntervalMs: number }).pollIntervalMs)
    : 5000;
  if (!interval || interval <= 0) {
    refreshTimer = null;
    return;
  }
  refreshTimer = window.setInterval(() => {
    void refreshStatus();
  }, interval);
}

async function refreshStatus(): Promise<void> {
  const client = activeSettingsClient();
  if (!client || refreshInProgress || settingInProgress) return;
  if ("pollIntervalMs" in client && Number((client as { pollIntervalMs: number }).pollIntervalMs) <= 0) {
    return;
  }
  refreshInProgress = true;
  try {
    const status = activeWLMouseClient && client === activeWLMouseClient
      ? await activeWLMouseClient.readStatus(true)
      : await client.readStatus();
    const currentClient = activeSettingsClient();
    if (client !== currentClient || client.device !== activeDevice) return;
    if (JSON.stringify(status) !== lastRenderedStatusKey) showStatus(status);
  } catch (error) {
    lastRenderedStatusKey = null;
    const message = error instanceof Error ? error.message : "Unable to refresh the mouse status.";
    setText("#device-status", "Waiting to refresh");
    setText("#read-status", message);
  } finally {
    refreshInProgress = false;
  }
}

window.addEventListener("beforeunload", () => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  navigator.hid?.removeEventListener("connect", handleHidConnect);
  navigator.hid?.removeEventListener("disconnect", handleHidDisconnect);
  void activeClient?.close();
  void activePulsarClient?.close();
  void activeEggClient?.close();
  void activeEggWeClient?.close();
  void activeWLMouseClient?.close();
  void activeOrbitalClient?.close();
});

renderControl();
