import "./control.css";
import { estimateBatteryTime, saveBatterySample, type BatteryMode } from "./battery-history";
import { unsupportedNotice, unsupportedTemplate } from "./browser-support";
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
import { closestDpiOption, dpiPresetValues } from "./dpi-presets";
import { renderEggControls } from "./devices/endgame/egg-controls-view";
import { hidTraffic, isMark, markHidActivity, startHidCapture, type HidTrafficEntry } from "./hid-diagnostics";
import {
  clearPendingChanges,
  dropPendingChange,
  hasPendingChanges,
  isPendingChange,
  onPendingChanges,
  pendingChanges,
  stagePendingChange,
  withPendingChanges,
  type PendingChange,
} from "./pending-changes";
import { formatHex, setControlValue, setSelected, setText, setToggleValue } from "./ui/dom";
import { renderPendingBar, setPendingBarBusy, setPendingBarStatus } from "./ui/pending-bar";
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
import { AtkHidClient } from "./devices/atk/hid";
import { LamzuHidClient } from "./devices/lamzu/hid";
import { LogitechHidppClient } from "./devices/logitech/hidpp";
import type { MouseStatus } from "./devices/mouse-types";
import { PulsarProHidClient } from "./devices/pulsar/pulsar-pro-hid";
import { OrbitalHidClient } from "./devices/orbital/hid";
import { RazerHidClient } from "./devices/razer/hid";
import { RazerViperV4ProHidClient } from "./devices/razer/viper-v4-pro-hid";
import { TeevolutionHidClient } from "./devices/teevolution/hid";
import { VgnF2HidClient } from "./devices/vgn/hid";
import { SUPPORTED_HID_FILTERS } from "./devices/vendors";
import { WLMouseHidClient } from "./devices/wlmouse/hid";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

const appRoot = controlApp;

const BUILD_LABEL = `${__BUILD_CHANNEL__.toUpperCase()} · v${__APP_VERSION__}`;
const isSuperstrikePreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get("preview") === "superstrike";
let activeClient: LogitechHidppClient | null = null;
let activePulsarClient: PulsarClient | null = null;
let activeEggClient: EggOp1HidClient | null = null;
let activeEggWeClient: EggWeHidClient | null = null;
let activeDmClient: WLMouseHidClient | LamzuHidClient | AtkHidClient | null = null;
let activeOrbitalClient: OrbitalHidClient | null = null;
let activeRazerClient: RazerHidClient | null = null;
let activeTeevolutionClient: TeevolutionHidClient | null = null;
let activeVgnClient: VgnF2HidClient | null = null;
let activeViperClient: RazerViperV4ProHidClient | null = null;
let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;
let lastRenderedStatusKey: string | null = null;
let activeDevice: HIDDevice | null = null;
const deviceStatuses = new Map<HIDDevice, MouseStatus>();
let latestDiagnosticsSnapshot: Record<string, unknown> | null = null;
let latestDiagnosticStatus: MouseStatus | null = null;
// Last status read from the device, before staged changes are previewed over it
let latestDeviceStatus: MouseStatus | null = null;
let lastDiagnosticCommand: string | null = null;
let lastDiagnosticError: string | null = null;
/** Prevents overlapping reconnect loops from leaving the UI stuck on "Reconnecting…". */
let reconnectInFlight = false;
let sidebarHidden = false;

async function statusAfterWrite(client: SupportedClient): Promise<MouseStatus> {
  return activeDmClient && client === activeDmClient
    ? await activeDmClient.readStatus(true)
    : await client.readStatus();
}

function activeSettingsClient(): SupportedClient | null {
  return activeClient ?? activePulsarClient ?? activeEggClient ?? activeEggWeClient ?? activeDmClient ?? activeOrbitalClient ?? activeRazerClient ?? activeViperClient ?? activeTeevolutionClient ?? activeVgnClient;
}

function hasActiveClient(): boolean {
  return activeSettingsClient() !== null;
}

function requireSettingsClient(): SupportedClient {
  const client = activeSettingsClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  return client;
}

/**
 * Drivers may confirm one write before another, so each setting is checked on
 * its own. A driver that hides the settings grid never reaches these, which
 * makes this a guard rather than a path the interface offers.
 */
function requireClientMethod<K extends string>(
  method: K,
  setting: string,
): Extract<SupportedClient, Record<K, unknown>> {
  const client = requireSettingsClient();
  if (!(method in client)) throw new Error(`This mouse does not support changing ${setting} yet.`);
  // `in` does not narrow through a generic key, so the union is filtered here.
  return client as Extract<SupportedClient, Record<K, unknown>>;
}

/**
 * Records a settings change without touching the device. The control repaints
 * from the previewed status so it shows the staged value, and the unsaved-changes
 * bar offers to flash or discard it.
 */
function stageChange(change: PendingChange): void {
  if (settingInProgress) {
    setText("#read-status", "Wait for the current flash to finish.");
    return;
  }
  if (matchesDeviceStatus(change)) {
    // The control was moved back to the value the mouse already holds, so there
    // is nothing left to flash for this setting.
    dropPendingChange(change.key);
    if (latestDeviceStatus) showStatus(latestDeviceStatus);
    setText("#read-status", `${change.label} already matches the mouse.`);
    return;
  }
  stagePendingChange(change);
  if (latestDeviceStatus) showStatus(latestDeviceStatus);
  setText("#read-status", `${change.label} staged. Flash to write it to the mouse.`);
}

// True when previewing the change over the device status would leave it unchanged
function matchesDeviceStatus(change: PendingChange): boolean {
  if (!latestDeviceStatus) return false;
  const preview = structuredClone(latestDeviceStatus);
  change.preview(preview);
  return JSON.stringify(preview) === JSON.stringify(latestDeviceStatus);
}

function revertPendingChanges(): void {
  if (settingInProgress || !hasPendingChanges()) return;
  clearPendingChanges();
  if (latestDeviceStatus) showStatus(latestDeviceStatus);
  setText("#read-status", "Discarded the staged changes.");
}

// Held before each write so the flashing state is legible rather than a flicker.
const FLASH_STEP_DELAY_MS = 420;
// Held after the last write, so the bar does not vanish the instant it lands.
const FLASH_SETTLE_MS = 320;

async function flashPause(milliseconds = FLASH_STEP_DELAY_MS): Promise<void> {
  // The pause only exists to show the animation, so skip it when motion is reduced.
  if (interfacePreferences.reducedMotion) return;
  await wait(milliseconds);
}

async function flashPendingChanges(): Promise<void> {
  const queued = pendingChanges();
  if (queued.length === 0 || settingInProgress || refreshInProgress) return;
  settingInProgress = true;
  setPendingBarBusy(true);
  let written = 0;
  let failure: string | null = null;
  try {
    for (const change of queued) {
      setPendingBarStatus(`${change.progress} (${written + 1} of ${queued.length})`);
      setText("#read-status", change.progress);
      // Let the step render before the write blocks on HID traffic.
      await flashPause();
      recordDiagnosticCommand(change.command);
      await change.apply();
      // Drop each change as it lands, so a later failure leaves only the
      // unwritten ones staged and the user can retry just those.
      dropPendingChange(change.key);
      written += 1;
    }
  } catch (error) {
    recordDiagnosticError(error, "Unable to flash the staged changes.");
    failure = error instanceof Error ? error.message : "Unable to flash the staged changes.";
  }
  await flashPause(FLASH_SETTLE_MS);
  const client = activeSettingsClient();
  const status = client ? await statusAfterWrite(client).catch(() => null) : null;
  settingInProgress = false;
  if (status) showStatus(status);
  setPendingBarBusy(false);
  if (failure) {
    setText("#read-status", failure);
    setPendingBarStatus(failure);
    return;
  }
  setText("#read-status", written === 1
    ? "Flashed 1 change to the mouse."
    : `Flashed ${written} changes to the mouse.`);
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
  shell.classList.toggle("sidebar-hidden", sidebarHidden);
  const menuToggle = document.querySelector<HTMLButtonElement>("#sidebar-menu-toggle");
  if (menuToggle) menuToggle.setAttribute("aria-pressed", String(!sidebarHidden));
  shell.dataset.interfaceTheme = interfacePreferences.theme.toLowerCase();
  document.querySelectorAll<HTMLDetailsElement>(".egg-collapsible, .egg-experimental").forEach((details) => {
    details.open = interfacePreferences.expandSections;
  });
  const experimental = document.querySelector<HTMLElement>("#egg-polling-settings");
  if (experimental && activeEggClient && !activeEggWeClient) {
    experimental.style.display = interfacePreferences.showExperimental ? "block" : "none";
  }
}

function renderStagedMarkers(): void {
  document.querySelectorAll<HTMLElement>("[data-pending-key]").forEach((element) => {
    const staged = element.dataset.pendingKey!.split(" ").some(isPendingChange);
    element.classList.toggle("is-staged", staged);
  });
}

function renderControl(): void {
  startHidCapture();
  appRoot.innerHTML = controlTemplate(BUILD_LABEL);
  document.querySelector<HTMLDetailsElement>("#device-debug-details details")?.addEventListener("toggle", () => {
    renderDeviceDiagnostics(latestDiagnosticStatus);
  });

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
    toggleSidebar: () => {
      sidebarHidden = !sidebarHidden;
      applyInterfacePreferences();
    },
    resetInterfacePreferences: () => {
      interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES };
      saveInterfacePreferences();
      populateInterfaceSettings();
    },
    downloadDiagnostics,
    chooseCustomDpi,
    sanitizeCustomDpi,
    finishCustomDpiEditing,
    applyLogitechAxisDpi,
    applyLogitechAnalogButton,
    applyLogitechAnalogButtons,
    setSuperstrikeTuningMode,
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
    applyGamingSurfaceMode,
    applyLightforceSwitchMode,
    flashPendingChanges,
    revertPendingChanges,
  });
  onPendingChanges(renderPendingBar);
  onPendingChanges(renderStagedMarkers);
  renderPendingBar();
  renderStagedMarkers();
  populateInterfaceSettings();
  applyInterfacePreferences();
  if (!isSuperstrikePreview) {
    navigator.hid?.addEventListener("connect", handleHidConnect);
    navigator.hid?.addEventListener("disconnect", handleHidDisconnect);
    void reconnectAuthorizedDevice();
  }
}

function showSuperstrikePreview(): void {
  dpiOptions = [100, 200, 400, 800, 1600, 3200, 6400, 8000, 16000, 32000];
  const status: MouseStatus = {
    brand: "Logitech",
    name: "PRO X 2 Superstrike",
    batteryPercent: 87,
    batteryVoltageMv: 3989,
    batteryState: "Discharging",
    dpi: 800,
    dpiY: 800,
    supportsSeparateDpiAxes: true,
    analogButtonTuning: {
      maxActuation: 10,
      maxRapidTrigger: 5,
      maxHaptics: 5,
      buttons: [
        { actuation: 3, rapidTrigger: 2, haptics: 3 },
        { actuation: 3, rapidTrigger: 2, haptics: 3 },
      ],
    },
    pollingRateHz: 4000,
    supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
    liftOffDistance: "High",
    supportedLiftOffDistances: ["Low", "High"],
    activeProfile: 1,
    deviceMode: "Onboard",
    modelId: "40BDC0A80000",
    transportIds: { USB: "C0A8", Wireless: "40BD" },
    connectionType: "Wireless",
    connectionDetail: "Lightspeed receiver",
    firmware: ["MPM 42.00.B0011", "BL2 73.00.B0011"],
  };
  configureDpiControl(status.dpi);
  showStatus(status);
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
    ".settings-grid input, .settings-grid button, #logitech-analog-button-settings input, #logitech-analog-button-settings .superstrike-apply-button",
  ).forEach((control) => { control.disabled = true; });
  setConnectionButtons(true, "Preview mode");
  setText("#read-status", "Current: 800 DPI · 4,000 Hz");
}

function showInterfaceSettings(open: boolean): void {
  if (open) populateInterfaceSettings();
  document.querySelector<HTMLElement>("#interface-settings-page")?.classList.toggle("is-open", open);
  document.querySelector<HTMLElement>(".control-panel")?.classList.toggle("showing-settings", open);
  document.querySelector<HTMLElement>("#interface-settings-button")?.setAttribute("aria-current", String(open));
  document.querySelector<HTMLElement>(".control-panel")?.scrollTo({ top: 0 });
}

function openInterfaceSettings(): void {
  showInterfaceSettings(true);
}

function closeInterfaceSettings(): void {
  showInterfaceSettings(false);
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
  return withVoltage(estimate ? `${status.batteryState} · ${estimate} ${label}` : status.batteryState);
}

const WLMOUSE_SLEEP_NEVER = 0xffff;
const PULSAR_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [1, "10 seconds"], [3, "30 seconds"], [6, "1 minute"], [12, "2 minutes"],
  [30, "5 minutes"], [60, "10 minutes"], [180, "30 minutes"],
];
let lastSleepSeconds = 60;

function sleepLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function fillSleepOptions(options: ReadonlyArray<readonly [number, string]>): void {
  const select = document.querySelector<HTMLSelectElement>("#sleep-select");
  const signature = options.map(([value]) => value).join(",");
  if (!select || select.dataset.options === signature) return;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, String(value))));
  select.dataset.options = signature;
}

function fillDebounceOptions(maxMs: number): void {
  const select = document.querySelector<HTMLSelectElement>("#debounce-select");
  if (!select || select.dataset.max === String(maxMs)) return;
  select.replaceChildren(...Array.from({ length: maxMs + 1 }, (_, ms) => new Option(`${ms} ms`, String(ms))));
  select.dataset.max = String(maxMs);
}

function resetDeviceSpecificPanels(): void {
  for (const selector of [
    "#egg-filter-settings",
    "#egg-spdt-settings",
    "#egg-polling-settings",
    "#egg-cpi-settings",
    "#egg-button-settings",
    "#pulsar-pro-settings",
    "#logitech-analog-button-settings",
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
  markHidActivity(command);
  lastDiagnosticError = null;
  renderDeviceDiagnostics(latestDiagnosticStatus);
}

function recordDiagnosticError(error: unknown, fallback: string): void {
  lastDiagnosticError = diagnosticErrorMessage(error, fallback);
  markHidActivity(lastDiagnosticError, { failed: true });
  renderReads();
  renderDeviceDiagnostics(latestDiagnosticStatus);
}

function renderDeviceDiagnostics(status: MouseStatus | null): void {
  const output = document.querySelector<HTMLPreElement>("#device-debug-snapshot");
  if (!output || !diagnosticsOpen()) return;

  const serializeCollection = (collection: HIDCollectionInfo): object => ({
    usagePage: `0x${formatHex(collection.usagePage, 4)}`,
    usage: `0x${formatHex(collection.usage, 4)}`,
    inputReports: collection.inputReports.map((report) => `0x${formatHex(report.reportId)}`),
    outputReports: collection.outputReports.map((report) => `0x${formatHex(report.reportId)}`),
    featureReports: collection.featureReports.map((report) => `0x${formatHex(report.reportId)}`),
    children: collection.children.map(serializeCollection),
  });

  const device = activeDevice;
  if (!device && !status && !lastDiagnosticError) {
    output.textContent = "Connect a mouse to collect diagnostics.";
    return;
  }
  const driver = status
    ? (status.ui?.family ? `${status.brand} · ${status.ui.family}` : status.brand)
    : "No driver read this device";
  const overview = document.querySelector<HTMLElement>("#device-debug-overview");
  if (overview) {
    const items: string[][] = [
      ["Driver", driver],
      ["VID / PID", device ? `0x${formatHex(device.vendorId, 4)} / 0x${formatHex(device.productId, 4)}` : "Not reported"],
      ["Build", BUILD_LABEL],
      ["Last command", lastDiagnosticCommand ?? "None"],
    ];
    if (lastDiagnosticError) items.push(["Last error", lastDiagnosticError]);
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
    app: {
      build: BUILD_LABEL,
      userAgent: navigator.userAgent,
    },
    driver: {
      brand: status?.brand ?? null,
      family: status?.ui?.family ?? null,
      readOk: status !== null,
      description: device ? describeHidDevice(device) : null,
    },
    webhid: device ? {
      productName: device.productName || null,
      vendorId: `0x${formatHex(device.vendorId, 4)}`,
      productId: `0x${formatHex(device.productId, 4)}`,
      opened: device.opened,
      collections: device.collections.map(serializeCollection),
    } : null,
    status: status ? { ...status, unitId: status.unitId ? "(masked)" : status.unitId } : null,
    diagnostics: {
      lastCommand: lastDiagnosticCommand,
      lastError: lastDiagnosticError,
    },
  };
  latestDiagnosticsSnapshot = snapshot;
  output.textContent = JSON.stringify(snapshot, null, 2);
  const downloadButton = document.querySelector<HTMLButtonElement>("#download-diagnostics");
  if (downloadButton) downloadButton.disabled = false;
  renderReads();
}

function maskBytes(bytes: Uint8Array): string {
  const hide = new Set<number>();
  let run = -1;
  for (let i = 0; i <= bytes.length; i += 1) {
    const printable = i < bytes.length && bytes[i] >= 0x20 && bytes[i] <= 0x7e;
    if (printable && run < 0) run = i;
    if (!printable && run >= 0) {
      if (i - run >= 6) for (let j = run; j < i; j += 1) hide.add(j);
      run = -1;
    }
  }
  let end = bytes.length;
  while (end > 8 && bytes[end - 1] === 0) end -= 1;
  const shown = Array.from(bytes.slice(0, end), (byte, i) => hide.has(i) ? "**" : formatHex(byte)).join(" ");
  return end < bytes.length ? `${shown}  (${bytes.length}B)` : shown;
}

function diagnosticsOpen(): boolean {
  return document.querySelector<HTMLDetailsElement>("#device-debug-details details")?.open === true;
}

function renderReads(): void {
  const target = document.querySelector<HTMLPreElement>("#device-debug-reads");
  if (target && diagnosticsOpen()) target.textContent = renderReadTable();
}

const BACKGROUND = "Background refresh";

function renderReadTable(): string {
  const rows = hidTraffic(activeDevice);
  if (!rows.length) return "Nothing yet. Change a setting to see what gets sent.";

  const base = rows[0].at;
  const stamp = (at: number): string => `t+${((at - base) / 1000).toFixed(1)}s`.padStart(9);

  const groups: { label: string; detail: string | null; failed: boolean; at: number; items: HidTrafficEntry[] }[] = [];
  for (const row of rows) {
    if (isMark(row)) groups.push({ label: row.label, detail: row.detail, failed: row.failed, at: row.at, items: [] });
    else {
      if (!groups.length) groups.push({ label: BACKGROUND, detail: null, failed: false, at: row.at, items: [] });
      groups[groups.length - 1].items.push(row);
    }
  }

  const interesting = groups.filter((group) => group.label !== BACKGROUND || group.items.some((item) => item.error));
  const shown = interesting.slice(-15);
  const lines: string[] = [];
  const hidden = groups.length - shown.length;
  if (hidden > 0) lines.push(`… ${hidden} earlier or background entries hidden`);

  for (const group of shown) {
    lines.push(`${stamp(group.at)} ${group.failed ? "!" : ">"} ${group.label}`);
    if (group.detail) lines.push(`${stamp(group.at)}     ${group.detail}`);
    for (const row of group.items) {
      const outcome = row.error ? `FAILED ${row.error}` : maskBytes(row.bytes);
      lines.push(`${stamp(row.at)}     ${row.dir.padEnd(4)} id ${row.reportId} ${String(row.ms).padStart(4)}ms  ${outcome}`);
    }
  }
  return lines.join("\n");
}

function diagnosticsLog(): object[] {
  const rows = hidTraffic(activeDevice);
  if (rows.length === 0) return [];
  const base = rows[0].at;
  const seconds = (at: number): number => Number(((at - base) / 1000).toFixed(3));
  return rows.map((row) => isMark(row)
    ? { at: seconds(row.at), kind: "event", label: row.label, detail: row.detail, failed: row.failed }
    : {
      at: seconds(row.at),
      kind: "report",
      dir: row.dir,
      reportId: row.reportId,
      ms: row.ms,
      bytes: maskBytes(row.bytes),
      error: row.error,
    });
}

function diagnosticsFileName(): string {
  const device = activeDevice;
  const ids = device ? `${formatHex(device.vendorId, 4)}-${formatHex(device.productId, 4)}` : "no-device";
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `openmouse-${ids}-${stamp}.json`.toLowerCase();
}

function downloadDiagnostics(): void {
  const status = document.querySelector<HTMLElement>("#diagnostic-download-status");
  if (!latestDiagnosticsSnapshot) return;
  const name = diagnosticsFileName();
  const rows = hidTraffic(activeDevice);
  const report = JSON.stringify({
    ...latestDiagnosticsSnapshot,
    logStart: rows.length > 0 ? new Date(performance.timeOrigin + rows[0].at).toISOString() : null,
    log: diagnosticsLog(),
  }, null, 2);
  const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  if (status) status.textContent = `Saved ${name}`;
}

function showStatus(deviceStatus: MouseStatus): void {
  latestDeviceStatus = deviceStatus;
  latestDiagnosticStatus = deviceStatus;
  lastRenderedStatusKey = JSON.stringify(deviceStatus);
  // Controls render from the previewed status so staged changes survive a
  // background refresh; diagnostics and the sidebar keep the device's own values.
  const status = withPendingChanges(deviceStatus);
  // Driver UI hints (e.g. status.ui.family === "egg-we") avoid brand-specific imports.
  const ui = status.ui;
  const isEgg8k = activeEggClient !== null
    || (status.brand === "Endgame Gear" && Array.isArray(status.eggCpiStages));
  const isEggWe = ui?.family === "egg-we" || activeEggWeClient !== null;
  const isEgg = isEgg8k || isEggWe;
  const isDmFamily = ui?.family === "wlmouse" || ui?.family === "lamzu" || ui?.family === "atk" || activeDmClient !== null;
  const isViper = ui?.family === "razer-viper-v4-pro" || activeViperClient !== null;
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
      && (status.brand === "Pulsar" || status.brand === "Teevolution" || status.brand === "VGN" || isDmFamily);
    debounceSettings.hidden = !showDebounce;
  }
  const signalSettings = document.querySelector<HTMLElement>("#signal-settings");
  if (signalSettings) signalSettings.hidden = isEgg || isDmFamily;
  const performanceModeSetting = document.querySelector<HTMLElement>("#performance-mode-setting");
  if (performanceModeSetting) {
    const hidePerformanceMode = isEgg || isDmFamily;
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
    const showAdvanced = status.brand === "Pulsar" || status.brand === "Teevolution" || status.brand === "VGN" || isEgg8k || isDmFamily;
    advanced.style.display = showAdvanced ? "grid" : "none";
    advanced.classList.toggle("egg-advanced-layout", isEgg8k);
  }
  const settingsGrid = document.querySelector<HTMLElement>(".settings-grid.device-data");
  if (settingsGrid) settingsGrid.style.display = settingsPending ? "none" : "";

  const sleepToggle = document.querySelector<HTMLElement>("#sleep-toggle");
  if (sleepToggle) sleepToggle.hidden = !isDmFamily || !activeDmClient?.canDisableSleep;
  if (isDmFamily && activeDmClient) {
    const seconds = activeDmClient.getSleepOptions();
    fillSleepOptions(seconds.map((value) => [value, sleepLabel(value)] as const));
    fillDebounceOptions(activeDmClient.getDebounceMaxMs());
    // Read from the device value so toggling sleep back on restores a real timeout.
    lastSleepSeconds = deviceStatus.sleepTimeout ?? seconds[0] ?? 60;
    setToggleValue("#sleep-toggle", status.sleepTimeout !== null && status.sleepTimeout !== undefined);
    setControlValue("#debounce-select", status.debounceMs);
    setControlValue("#sleep-select", status.sleepTimeout);
    setToggleValue("#motion-sync-toggle", status.motionSync);
    setToggleValue("#angle-snapping-toggle", status.angleSnapping);
    setToggleValue("#ripple-control-toggle", status.rippleControl);
  }
  if (status.brand === "Pulsar" || status.brand === "Teevolution" || status.brand === "VGN" || status.brand === "Endgame Gear" || isViper) {
    fillSleepOptions(PULSAR_SLEEP_OPTIONS);
    fillDebounceOptions(20);
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
    deviceStatuses.set(activeDevice, deviceStatus);
    void renderDeviceSidebar();
  }
  setText("#device-status", "Connected");
  if (settingsPending) {
    // A driver may read more than it can write yet. Only drivers that read
    // these values report them; the rest fall back to a placeholder here.
    const battery = deviceStatus.batteryPercent === null
      ? "Connected"
      : `Battery ${deviceStatus.batteryPercent}%`;
    setText("#read-status", ui?.valuesVerified
      ? [battery, `${deviceStatus.dpi.toLocaleString()} DPI`, `${deviceStatus.pollingRateHz.toLocaleString()} Hz`].join(" · ")
      : battery);
  } else if (!hasPendingChanges()) {
    setText("#read-status", `Current: ${deviceStatus.dpi.toLocaleString()} DPI · ${deviceStatus.pollingRateHz.toLocaleString()} Hz`);
  }
  const meter = document.querySelector<HTMLElement>("#battery-meter");
  if (meter) meter.style.width = status.batteryPercent === null ? "0%" : `${status.batteryPercent}%`;
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => setSelected(button, Number(button.dataset.rate) === status.pollingRateHz));
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => setSelected(button, button.dataset.lod === status.liftOffDistance));
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    const rate = Number(button.dataset.rate);
    const supportedRates = status.supportedPollingRates;
    const unsupportedForEgg8k = isEgg8k && rate < 1000;
    const unsupportedForListed = Array.isArray(supportedRates) && !supportedRates.includes(rate);
    const hideListed = (status.brand === "Logitech" || ui?.hideUnsupportedPollingRates) && unsupportedForListed;
    const hide = unsupportedForEgg8k || hideListed || settingsPending;
    button.hidden = hide;
    // A read-only rate still shows which one is active, it just cannot be staged.
    button.disabled = hide || settingsPending || ui?.pollingReadOnly === true;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    const supportedLods = status.supportedLiftOffDistances;
    const usesNamedLods = Array.isArray(supportedLods)
      && supportedLods.includes("Low")
      && supportedLods.includes("High")
      && !supportedLods.includes("Medium");
    const lod = button.dataset.lod as NonNullable<MouseStatus["liftOffDistance"]>;
    button.textContent = usesNamedLods
      ? lod
      : ({ Low: "0.7 mm", Medium: "1 mm", High: "2 mm" } as const)[lod];
    const hideLow = button.dataset.lod === "Low"
      && (isEgg || ui?.hideLodLow === true);
    const unsupported = Array.isArray(supportedLods)
      && !supportedLods.includes(button.dataset.lod as NonNullable<MouseStatus["liftOffDistance"]>);
    const legacyLogitechLow = status.brand === "Logitech"
      && !Array.isArray(supportedLods)
      && button.dataset.lod === "Low";
    button.hidden = hideLow || unsupported;
    const lodNeedsSurface = ui?.lodRequiresSurface === true && status.gamingSurfaceMode === "Off";
    button.disabled = hideLow || unsupported || settingsPending || legacyLogitechLow || lodNeedsSurface;
  });
  const lodNote = document.querySelector<HTMLElement>("#lod-note");
  if (lodNote) {
    lodNote.textContent = ui?.lodRequiresSurface === true && status.gamingSurfaceMode === "Off"
      ? "Turn the gaming surface on or set it to auto to adjust lift-off distance."
      : "Controls how far you can lift the mouse before tracking stops. Higher values keep tracking a little longer.";
  }
  const gamingSurfaceRow = document.querySelector<HTMLElement>("#gaming-surface-row");
  if (gamingSurfaceRow) gamingSurfaceRow.hidden = !status.gamingSurfaceMode;
  document.querySelectorAll<HTMLButtonElement>("[data-gaming-surface]").forEach((button) => {
    setSelected(button, button.dataset.gamingSurface === status.gamingSurfaceMode);
    button.disabled = settingsPending || !status.gamingSurfaceMode;
  });
  // A driver that reports no gaming surface and an explicitly empty lift-off
  // list has nothing to put in the sensor card, so hide the card itself rather
  // than leaving an empty heading behind.
  const sensorCard = document.querySelector<HTMLElement>("#lod-note")?.closest<HTMLElement>(".setting-card");
  if (sensorCard) {
    sensorCard.hidden = !status.gamingSurfaceMode
      && Array.isArray(status.supportedLiftOffDistances)
      && status.supportedLiftOffDistances.length === 0;
  }
  const lightforceCard = document.querySelector<HTMLElement>("#lightforce-card");
  if (lightforceCard) lightforceCard.hidden = !status.lightforceSwitchMode;
  document.querySelectorAll<HTMLButtonElement>("[data-lightforce]").forEach((button) => {
    setSelected(button, button.dataset.lightforce === status.lightforceSwitchMode);
    button.disabled = settingsPending || !status.lightforceSwitchMode;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    setSelected(button, Number(button.dataset.dpi) === status.dpi);
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
  const dpiLabel = (source: MouseStatus): string => showSeparateDpiAxes
    ? `X ${source.dpi.toLocaleString()} · Y ${(source.dpiY ?? source.dpi).toLocaleString()} DPI`
    : `${source.dpi.toLocaleString()} DPI`;
  setText("#dpi-pending", isPendingChange("dpi")
    ? `Staged ${dpiLabel(status)}`
    : `Current ${dpiLabel(deviceStatus)}`);
  settingsGrid?.classList.toggle("has-logitech-axis-controls", showSeparateDpiAxes);
  const dpiX = document.querySelector<HTMLInputElement>("#logitech-dpi-x");
  const dpiY = document.querySelector<HTMLInputElement>("#logitech-dpi-y");
  if (dpiX) dpiX.value = String(status.dpi);
  if (dpiY) dpiY.value = String(status.dpiY ?? status.dpi);
  const logitechDetails = document.querySelector<HTMLElement>("#logitech-device-details");
  if (logitechDetails) logitechDetails.style.display = status.brand === "Logitech" ? "block" : "none";
  if (status.brand === "Logitech") renderLogitechDetails(status);
  renderLogitechAnalogButtonSettings(status);
  renderDeviceDiagnostics(deviceStatus);
}

function renderLogitechAnalogButtonSettings(status: MouseStatus): void {
  const section = document.querySelector<HTMLElement>("#logitech-analog-button-settings");
  const tuning = status.brand === "Logitech" ? status.analogButtonTuning : undefined;
  if (!section) return;
  section.style.display = tuning?.buttons.length === 2 ? "block" : "none";
  if (!tuning || tuning.buttons.length !== 2) return;
  for (const side of ["left", "right"] as const) {
    const values = tuning.buttons[side === "left" ? 0 : 1];
    for (const [setting, value, max] of [
      ["actuation", values.actuation, tuning.maxActuation],
      ["rapid-trigger", values.rapidTrigger, tuning.maxRapidTrigger],
      ["haptics", values.haptics, tuning.maxHaptics],
    ] as const) {
      const input = document.querySelector<HTMLInputElement>(`#logitech-${side}-${setting}`);
      if (input) {
        input.value = String(value);
        input.max = String(max);
        document.querySelectorAll<HTMLButtonElement>(`[data-superstrike-input="${input.id}"]`).forEach((option) => {
          option.setAttribute("aria-pressed", String(Number(option.dataset.superstrikeValue) === value));
        });
      }
    }
  }
  const both = tuning.buttons[0];
  for (const [setting, value, max] of [
    ["actuation", both.actuation, tuning.maxActuation],
    ["rapid-trigger", both.rapidTrigger, tuning.maxRapidTrigger],
    ["haptics", both.haptics, tuning.maxHaptics],
  ] as const) {
    const input = document.querySelector<HTMLInputElement>(`#logitech-both-${setting}`);
    if (input) {
      input.value = String(value);
      input.max = String(max);
      document.querySelectorAll<HTMLButtonElement>(`[data-superstrike-input="${input.id}"]`).forEach((option) => {
        option.setAttribute("aria-pressed", String(Number(option.dataset.superstrikeValue) === value));
      });
    }
  }
}

function setSuperstrikeTuningMode(mode: "independent" | "both"): void {
  const panels = document.querySelector<HTMLElement>(".superstrike-tuning-panels");
  if (!panels) return;
  panels.dataset.superstrikeMode = mode;
  document.querySelectorAll<HTMLButtonElement>("[data-superstrike-tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.superstrikeTab === mode));
  });
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
    `<div><small>${label.toUpperCase()}</small><span>${value}</span></div>`).join("");
}

async function showPulsarExplorer(client: PulsarClient): Promise<void> {
  await client.open();
  const device = client.device;
  setText("#connection-value", "Connected");
  setText("#connection-detail", "Reading Pulsar receiver identity");
  setText("#device-title", device.productName || "Pulsar Mouse");
  setText("#device-status", "Connected");
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
  // Staged changes belong to the mouse they were made on.
  clearPendingChanges();
  latestDeviceStatus = null;
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeEggWeClient = null;
  activeDmClient = null;
  activeOrbitalClient = null;
  activeRazerClient = null;
  activeTeevolutionClient = null;
  activeVgnClient = null;
  activeViperClient = null;
  activeDevice = client.device;
  recordDiagnosticCommand("Read device status");
  lastRenderedStatusKey = null;
  if (client instanceof WLMouseHidClient || client instanceof LamzuHidClient || client instanceof AtkHidClient) {
    activeDmClient = client;
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
  } else if (client instanceof RazerHidClient) {
    activeRazerClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof RazerViperV4ProHidClient) {
    activeViperClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof TeevolutionHidClient) {
    activeTeevolutionClient = client;
    await client.open();
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof VgnF2HidClient) {
    activeVgnClient = client;
    await client.open();
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
  activeDmClient = null;
  activeOrbitalClient = null;
  activeRazerClient = null;
  activeTeevolutionClient = null;
  activeVgnClient = null;
  activeViperClient = null;
  activeDevice = null;
  lastRenderedStatusKey = null;
  clearPendingChanges();
  latestDeviceStatus = null;
  resetDeviceSpecificPanels();
  const advanced = document.querySelector<HTMLElement>("#pulsar-advanced");
  if (advanced) advanced.style.display = "none";
  document.querySelector<HTMLElement>(".control-shell")?.classList.add("is-empty");
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.add("is-idle"));
  setText("#device-title", "Connect a mouse");
  setText("#device-status", "No device connected");
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
    recordDiagnosticError(error, message);
    await activeEggClient?.close().catch(() => undefined);
    activeEggClient = null;
    await activeEggWeClient?.close().catch(() => undefined);
    activeEggWeClient = null;
    setText("#device-status", "Connection failed");
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
      setText("#read-status", lastError?.message ?? "Use Add device if the mouse does not reconnect automatically.");
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
  const common = dpiPresetValues(dpiOptions);
  const values = common.includes(currentDpi) ? common : [...common, currentDpi].sort((a, b) => a - b);
  presets.innerHTML = values.map((dpi) => `<button type="button" data-dpi="${dpi}" aria-pressed="${dpi === currentDpi}" class="${dpi === currentDpi ? "selected" : ""}">${dpi.toLocaleString()}</button>`).join("");
  presets.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    button.addEventListener("click", () => void applyDpiValue(Number(button.dataset.dpi)));
  });
  custom.disabled = false;
  const min = Math.min(...dpiOptions);
  const max = Math.max(...dpiOptions);
  document.querySelectorAll<HTMLInputElement>("#logitech-dpi-x, #logitech-dpi-y").forEach((axis) => {
    axis.min = String(min);
    axis.max = String(max);
  });
}

function chooseCustomDpi(): void {
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
    // Naming the closest step saves guessing on mice whose grid does not land
    // on round numbers, where every obvious value looks unsupported.
    const closest = Number.isInteger(dpi) && dpi > 0 ? closestDpiOption(dpiOptions, dpi) : null;
    setText("#read-status", closest === null
      ? "That DPI value is not supported by this mouse."
      : `This mouse cannot do ${dpi.toLocaleString()} DPI. The closest step it supports is ${closest.toLocaleString()}.`);
    input.focus();
    input.select();
    return;
  }
  if (applyDpiValue(dpi)) finishCustomDpiEditing(dpi);
}

function sanitizeCustomDpi(): void {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  if (!input || input.readOnly) return;
  const digits = input.value.replace(/\D/g, "");
  const max = dpiOptions.length > 0 ? Math.max(...dpiOptions) : null;
  const next = max !== null && digits !== "" && Number(digits) > max ? String(max) : digits;
  if (next !== input.value) input.value = next;
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

function applyDpiValue(dpi: number): boolean {
  if (!hasActiveClient() || !dpiOptions.includes(dpi)) return false;
  stageChange({
    key: "dpi",
    label: `DPI ${dpi.toLocaleString()}`,
    command: `Set DPI to ${dpi.toLocaleString()}`,
    progress: `Setting ${dpi.toLocaleString()} DPI…`,
    preview: (status) => {
      status.dpi = dpi;
      // Only mirror the Y axis when the driver actually reports one, so the
      // comparison against the device status stays exact.
      if (status.dpiY !== undefined) status.dpiY = dpi;
    },
    apply: async () => {
      await requireClientMethod("setDpi", "DPI").setDpi(dpi);
    },
  });
  return true;
}

function applyLogitechAxisDpi(): void {
  if (!activeClient) return;
  const dpiX = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-x")?.value);
  const dpiY = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-y")?.value);
  if (!dpiOptions.includes(dpiX) || !dpiOptions.includes(dpiY)) {
    setText("#read-status", "Both axis values must be advertised DPI values.");
    return;
  }
  stageChange({
    key: "dpi",
    label: `DPI X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()}`,
    command: `Set DPI axes to X ${dpiX.toLocaleString()} / Y ${dpiY.toLocaleString()}`,
    progress: `Setting X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()} DPI…`,
    preview: (status) => {
      status.dpi = dpiX;
      status.dpiY = dpiY;
    },
    apply: async () => {
      if (!activeClient) throw new Error("The mouse is no longer connected.");
      await activeClient.setDpi(dpiX, dpiY);
    },
  });
}

function readAnalogTuning(group: "left" | "right" | "both"): { actuation: number; rapidTrigger: number; haptics: number } {
  const read = (setting: "actuation" | "rapid-trigger" | "haptics"): number =>
    Number(document.querySelector<HTMLInputElement>(`#logitech-${group}-${setting}`)?.value);
  return { actuation: read("actuation"), rapidTrigger: read("rapid-trigger"), haptics: read("haptics") };
}

/** Stages one hall-effect button profile. Keyed per button so "both" replaces either side. */
function stageAnalogButton(button: 0 | 1, tuning: { actuation: number; rapidTrigger: number; haptics: number }): void {
  const side = button === 0 ? "left" : "right";
  stageChange({
    key: `analog-button-${button}`,
    label: `${side === "left" ? "Left" : "Right"} HITS tuning`,
    command: `Set ${side} hall-effect button tuning`,
    progress: `Setting ${side} hall-effect button tuning…`,
    preview: (status) => {
      const buttons = status.analogButtonTuning?.buttons;
      if (buttons?.[button]) buttons[button] = { ...tuning };
    },
    apply: async () => {
      if (!activeClient) throw new Error("The mouse is no longer connected.");
      await activeClient.setAnalogButtonTuning(button, tuning);
    },
  });
}

function applyLogitechAnalogButton(button: 0 | 1): void {
  if (!activeClient) return;
  stageAnalogButton(button, readAnalogTuning(button === 0 ? "left" : "right"));
}

function applyLogitechAnalogButtons(): void {
  if (!activeClient) return;
  const tuning = readAnalogTuning("both");
  stageAnalogButton(0, tuning);
  stageAnalogButton(1, tuning);
}

function applyPollingRate(rate: number): void {
  if (!hasActiveClient()) return;
  stageChange({
    key: "polling-rate",
    label: `${rate.toLocaleString()} Hz`,
    command: `Set polling rate to ${rate.toLocaleString()} Hz`,
    progress: `Setting ${rate.toLocaleString()} Hz…`,
    preview: (status) => {
      status.pollingRateHz = rate;
    },
    apply: async () => {
      await requireClientMethod("setPollingRate", "the polling rate").setPollingRate(rate);
    },
  });
}

function applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): void {
  if (!hasActiveClient()) return;
  stageChange({
    key: "lift-off-distance",
    label: `${lod} lift-off`,
    command: `Set lift-off distance to ${lod}`,
    progress: `Setting ${lod.toLowerCase()} lift-off distance…`,
    preview: (status) => {
      status.liftOffDistance = lod;
    },
    apply: async () => {
      await requireClientMethod("setLiftOffDistance", "the lift-off distance").setLiftOffDistance(lod);
    },
  });
}

function applyGamingSurfaceMode(mode: NonNullable<MouseStatus["gamingSurfaceMode"]>): void {
  if (!activeClient) return;
  stageChange({
    key: "gaming-surface",
    label: `Gaming surface ${mode.toLowerCase()}`,
    command: `Set gaming surface to ${mode}`,
    progress: `Setting gaming surface to ${mode.toLowerCase()}…`,
    preview: (status) => { status.gamingSurfaceMode = mode; },
    apply: async () => {
      if (!activeClient) throw new Error("The mouse is no longer connected.");
      await activeClient.setGamingSurfaceMode(mode);
    },
  });
}

function applyLightforceSwitchMode(mode: NonNullable<MouseStatus["lightforceSwitchMode"]>): void {
  if (!activeClient) return;
  stageChange({
    key: "lightforce-switch-mode",
    label: `LightForce ${mode.toLowerCase()}`,
    command: `Set LightForce switches to ${mode}`,
    progress: `Setting LightForce switches to ${mode.toLowerCase()}…`,
    preview: (status) => { status.lightforceSwitchMode = mode; },
    apply: async () => {
      if (!activeClient) throw new Error("The mouse is no longer connected.");
      await activeClient.setLightforceSwitchMode(mode);
    },
  });
}

function toggleDongleLed(): void {
  const button = document.querySelector<HTMLButtonElement>("#dongle-led-toggle");
  if (!button || !activePulsarClient) return;
  const enabled = button.dataset.enabled !== "true";
  stageChange({
    key: "dongle-led",
    label: `Receiver LED ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} receiver LED`,
    progress: `${enabled ? "Enabling" : "Disabling"} the receiver LED…`,
    preview: (status) => {
      status.dongleLedEnabled = enabled;
    },
    apply: async () => {
      if (!activePulsarClient) throw new Error("The receiver is no longer connected.");
      await activePulsarClient.setDongleLed(enabled);
    },
  });
}

type PulsarToggleSetting = "motionSync" | "angleSnapping" | "rippleControl" | "performanceMode";

function applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): void {
  if (!(activePulsarClient ?? activeEggClient ?? activeDmClient ?? activeOrbitalClient ?? activeTeevolutionClient ?? activeVgnClient)) return;
  stageChange({
    key: setting,
    label: `${settingLabel(setting)} ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} ${settingLabel(setting)}`,
    progress: `${enabled ? "Enabling" : "Disabling"} ${settingLabel(setting)}…`,
    preview: (status) => {
      status[setting] = enabled;
    },
    apply: async () => {
      const client = activePulsarClient ?? activeEggClient ?? activeDmClient ?? activeOrbitalClient ?? activeTeevolutionClient ?? activeVgnClient;
      if (!client) throw new Error("The mouse is no longer connected.");
      if (setting === "motionSync") await client.setMotionSync(enabled);
      if (setting === "angleSnapping") await client.setAngleSnapping(enabled);
      if (setting === "rippleControl") await client.setRippleControl(enabled);
      if (setting === "performanceMode" && !activePulsarClient && !activeOrbitalClient && !activeTeevolutionClient && !activeVgnClient) {
        throw new Error("Performance mode is not exposed by this device's protocol.");
      }
      if (setting === "performanceMode") {
        await (activePulsarClient ?? activeOrbitalClient ?? activeTeevolutionClient ?? activeVgnClient)!.setPerformanceMode(enabled);
      }
    },
  });
}

function settingLabel(setting: PulsarToggleSetting): string {
  return ({
    motionSync: "Motion Sync",
    angleSnapping: "angle snapping",
    rippleControl: "ripple control",
    performanceMode: "performance mode",
  } as const)[setting];
}

function applyEggFilter(setting: "slamclick" | "motionJitter", enabled: boolean): void {
  if (!activeEggClient) return;
  const label = setting === "slamclick" ? "slamclick filter" : "motion-jitter filter";
  stageChange({
    key: `egg-${setting}`,
    label: `${label} ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} ${label}`,
    progress: `${enabled ? "Enabling" : "Disabling"} ${label}…`,
    preview: (status) => {
      if (setting === "slamclick") status.slamclickFilter = enabled;
      else status.motionJitterFilter = enabled;
    },
    apply: async () => {
      if (!activeEggClient) throw new Error("The mouse is no longer connected.");
      if (setting === "slamclick") await activeEggClient.setSlamclickFilter(enabled);
      else await activeEggClient.setMotionJitterFilter(enabled);
    },
  });
}

function applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): void {
  if (!activeEggClient) return;
  stageChange({
    key: `egg-spdt-${button}`,
    label: `${button === "left" ? "Left" : "Right"} GX ${mode}`,
    command: `Set ${button} button GX mode to ${mode}`,
    progress: `Setting the ${button} button to ${mode}…`,
    preview: (status) => {
      if (button === "left") status.leftSpdtMode = mode;
      else status.rightSpdtMode = mode;
    },
    apply: async () => {
      if (!activeEggClient) throw new Error("The mouse is no longer connected.");
      await activeEggClient.setSpdtMode(button, mode);
    },
  });
}

function updateCustomPollingPreview(): void {
  const divider = Number(document.querySelector<HTMLInputElement>("#egg-polling-divider")?.value);
  setText("#egg-polling-result", Number.isInteger(divider) && divider > 0 && divider <= 255
    ? `Result: ${(8000 / divider).toLocaleString(undefined, { maximumFractionDigits: 2 })} Hz`
    : "Enter a divider from 1 to 255.");
}


function applyEggCpiLevels(levels: number): void {
  stageEggChange({
    key: "egg-cpi-levels",
    label: `${levels} CPI stage${levels === 1 ? "" : "s"}`,
    what: "CPI stage count",
    preview: (status) => {
      status.eggCpiLevels = levels;
    },
    change: async (client) => client.setCpiLevels(levels),
  });
}

function applyEggCpiStage(level: number, x: number, y: number): void {
  stageEggChange({
    key: `egg-cpi-stage-${level}`,
    label: `CPI stage ${level + 1} → ${x === y ? x.toLocaleString() : `${x.toLocaleString()}/${y.toLocaleString()}`}`,
    what: `CPI stage ${level + 1}`,
    preview: (status) => {
      const stage = status.eggCpiStages?.[level];
      if (stage) {
        stage.x = x;
        stage.y = y;
      }
    },
    change: async (client) => client.setCpiStage(level, x, y),
  });
}

function applyEggPollingDivider(divider: number): void {
  stageEggChange({
    key: "egg-polling-divider",
    label: `Polling divider ${divider}`,
    what: "custom polling divider",
    preview: (status) => {
      status.eggPollingDivider = divider;
    },
    change: async (client) => client.setCustomPollingDivider(divider),
  });
}

function applyEggMulticlick(button: EggButtonIndex, value: number): void {
  stageEggChange({
    key: `egg-multiclick-${button}`,
    label: `${EGG_BUTTON_NAMES[button]} multiclick ${value}`,
    what: `${EGG_BUTTON_NAMES[button]} multiclick filter`,
    preview: (status) => {
      if (status.eggMulticlickFilters) status.eggMulticlickFilters[button] = value;
    },
    change: async (client) => client.setMulticlickFilter(button, value),
  });
}

function applyEggButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): void {
  stageEggChange({
    key: `egg-mapping-${button}`,
    label: `${EGG_BUTTON_NAMES[button]} → ${mapping}`,
    what: `${EGG_BUTTON_NAMES[button]} mapping`,
    preview: (status) => {
      if (status.eggButtonMappings) status.eggButtonMappings[button] = mapping;
    },
    change: async (client) => client.setButtonMapping(button, mapping),
  });
}

function stageEggChange(options: {
  key: string;
  label: string;
  what: string;
  preview: PendingChange["preview"];
  change: (client: EggOp1HidClient) => Promise<void>;
}): void {
  if (!activeEggClient) return;
  stageChange({
    key: options.key,
    label: options.label,
    command: `Change ${options.what}`,
    progress: `Changing ${options.what}…`,
    preview: options.preview,
    apply: async () => {
      if (!activeEggClient) throw new Error("The mouse is no longer connected.");
      await options.change(activeEggClient);
    },
  });
}

function applyPulsarValue(setting: "debounce" | "sleep", value: number): void {
  if (!(activePulsarClient ?? activeDmClient ?? activeOrbitalClient ?? activeViperClient ?? activeTeevolutionClient ?? activeVgnClient)) return;
  const asleep = value !== WLMOUSE_SLEEP_NEVER;
  stageChange({
    key: setting,
    label: setting === "debounce"
      ? `${value} ms debounce`
      : asleep ? `Auto sleep ${sleepLabel(value)}` : "Auto sleep off",
    command: setting === "debounce" ? `Set debounce to ${value} ms` : `Set auto sleep to ${value} seconds`,
    progress: `Setting ${setting === "debounce" ? `${value} ms debounce` : "auto sleep"}…`,
    preview: (status) => {
      if (setting === "debounce") status.debounceMs = value;
      // Drivers report a disabled sleep timer as null, so mirror that here.
      else status.sleepTimeout = asleep ? value : null;
    },
    apply: async () => {
      const client = activePulsarClient ?? activeDmClient ?? activeOrbitalClient ?? activeViperClient ?? activeTeevolutionClient ?? activeVgnClient;
      if (!client) throw new Error("The mouse is no longer connected.");
      if (setting === "debounce") await client.setDebounceTime(value);
      else await client.setSleepTimeout(value);
    },
  });
}

function applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): void {
  if (!(activePulsarClient instanceof PulsarProHidClient)) return;
  const what = setting === "wheelAcceleration" ? "wheel acceleration" : setting === "angleTuning" ? "angle tuning" : "onboard profile";
  stageChange({
    key: `pro-${setting}`,
    label: setting === "wheelAcceleration"
      ? `Wheel acceleration ${value ? "on" : "off"}`
      : setting === "angleTuning" ? `Angle tuning ${value}°` : `Profile ${value}`,
    command: `Change ${what}`,
    progress: `Changing ${what}…`,
    preview: (status) => {
      if (setting === "wheelAcceleration") status.wheelAcceleration = Boolean(value);
      if (setting === "angleTuning") status.angleTuning = Number(value);
      if (setting === "profile") status.activeProfile = Number(value);
    },
    apply: async () => {
      if (!(activePulsarClient instanceof PulsarProHidClient)) throw new Error("The mouse is no longer connected.");
      if (setting === "wheelAcceleration") await activePulsarClient.setWheelAcceleration(Boolean(value));
      if (setting === "angleTuning") await activePulsarClient.setAngleTuning(Number(value));
      if (setting === "profile") await activePulsarClient.setProfile(Number(value));
    },
  });
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
  markHidActivity(BACKGROUND, { transient: true });
  try {
    const status = activeDmClient && client === activeDmClient
      ? await activeDmClient.readStatus(true)
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

window.addEventListener("beforeunload", (event) => {
  if (hasPendingChanges()) event.preventDefault();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  navigator.hid?.removeEventListener("connect", handleHidConnect);
  navigator.hid?.removeEventListener("disconnect", handleHidDisconnect);
  void activeClient?.close();
  void activePulsarClient?.close();
  void activeEggClient?.close();
  void activeEggWeClient?.close();
  void activeDmClient?.close();
  void activeOrbitalClient?.close();
  void activeRazerClient?.close();
  void activeTeevolutionClient?.close();
  void activeVgnClient?.close();
  void activeViperClient?.close();
});

const notice = unsupportedNotice({
  touchPrimary: window.matchMedia("(pointer: coarse) and (hover: none)").matches,
  hasWebHid: Boolean(navigator.hid),
});
if (notice) {
  appRoot.innerHTML = unsupportedTemplate(notice);
} else {
  renderControl();
  if (isSuperstrikePreview) showSuperstrikePreview();
}
