import { estimateBatteryTime, saveBatterySample, type BatteryMode } from "../battery-history";
import {
  clientSupportScore,
  createSupportedClient,
  deviceBrand,
  describeHidDevice,
  listLogicalDevices,
  type PulsarClient,
  type SupportedClient,
} from "../device-clients";
import { closestDpiOption } from "../dpi-presets";
import { formatHex, hidTraffic, isMark, markHidActivity, startHidCapture, type HidTrafficEntry } from "../hid-diagnostics";
import {
  clearPendingChanges,
  dropPendingChange,
  hasPendingChanges,
  isPendingChange,
  onPendingChanges,
  pendingChangeBatches,
  pendingChanges,
  stagePendingChange,
  withPendingChanges,
  type PendingChange,
} from "../pending-changes";
import { deviceImage } from "../ui/device-images";
import { batteryNeedsCharging } from "../ui/battery-icon";
import {
  DEFAULT_INTERFACE_PREFERENCES,
  loadInterfacePreferences,
  saveInterfacePreferences as persistInterfacePreferences,
  type InterfacePreferences,
  type InterfaceTheme,
} from "../interface-preferences";
import {
  EGG_BUTTON_NAMES,
  EggOp1HidClient,
  type EggButtonIndex,
  type EggButtonMapping,
  type EggSpdtMode,
} from "@openmouse/protocol/drivers/endgame/egg-op1-hid";
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
} from "@openmouse/protocol/drivers/endgame/egg-we-control";
import { AtkHidClient } from "@openmouse/protocol/drivers/atk/hid";
import { LamzuHidClient } from "@openmouse/protocol/drivers/lamzu/hid";
import {
  LogitechHidppClient,
  NotAMouseError,
  PROFILE_DPI_WRITES_ENABLED,
  type OnboardProfile,
} from "@openmouse/protocol/drivers/logitech/hidpp";
import {
  BUNNY_HOP_LIMITS,
  PROFILE_STAGE_LOD,
  capabilitiesForFormat,
  clampDpi,
  describeOffset,
  dpiStageCapabilitiesForOptions,
  reportRatesForDevice,
  validateProfileName,
  reproduceProfile,
  supportsFactoryReset,
  supportsProfileWriteProbe,
  validateBunnyHoppingMs,
  type DpiStageCapabilities,
  type DpiStagePlan,
  type LogitechButtonAction,
  type LogitechButtonBinding,
  type LogitechMacroStep,
} from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import { setCaptureContext } from "../capture-context";
import type { MouseLighting, MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import {
  LOGITECH_HAPTIC_EFFECTS,
  LOGITECH_HAPTIC_PRESETS,
  LOGITECH_SMART_SHIFT_OFF,
  logitechControlName,
  type LogitechHapticPreset,
  type LogitechReprogrammableControl,
} from "@openmouse/protocol/logitech";
import { PulsarProHidClient } from "@openmouse/protocol/drivers/pulsar/pulsar-pro-hid";
import { OrbitalHidClient } from "@openmouse/protocol/drivers/orbital/hid";
import { RazerHidClient } from "@openmouse/protocol/drivers/razer/hid";
import {
  RAZER_BUTTON_CONTROL_LABEL,
  RAZER_TOGGLE_CONTROL_INFO,
  type RazerButtonControl,
  type RazerButtonMapping,
  type RazerToggleControl,
} from "@openmouse/protocol/razer";
import { RazerViperMiniHidClient } from "@openmouse/protocol/drivers/razer/viper-mini-hid";
import { RazerCobraHidClient } from "@openmouse/protocol/drivers/razer/cobra-hid";
import { RazerViperHidClient } from "@openmouse/protocol/drivers/razer/viper-hid";
import { RazerViperV4ProHidClient } from "@openmouse/protocol/drivers/razer/viper-v4-pro-hid";
import { RAZER_PRODUCTS } from "@openmouse/protocol/razer-devices";
import { FinalmouseHidClient } from "@openmouse/protocol/drivers/finalmouse/hid";
import { ModdoHidClient } from "@openmouse/protocol/drivers/moddo/hid";
import { NinjutsoHidClient } from "@openmouse/protocol/drivers/ninjutso/hid";
import { ZaunkoenigHidClient } from "@openmouse/protocol/drivers/zaunkoenig/hid";
import { TeevolutionHidClient } from "@openmouse/protocol/drivers/teevolution/hid";
import { teevolutionProfileForCid } from "@openmouse/protocol/teevolution";
import { VgnF2HidClient } from "@openmouse/protocol/drivers/vgn/hid";
import { KeychronHidClient } from "@openmouse/protocol/drivers/keychron/hid";
import { KeychronM6HidClient } from "@openmouse/protocol/drivers/keychron/m6-hid";
import { FantechHidClient } from "@openmouse/protocol/drivers/fantech/hid";
import { WallhackMouseHidClient } from "@openmouse/protocol/drivers/wallhack/mouse-hid";
import { WallhackKeyboardHidClient } from "@openmouse/protocol/drivers/wallhack/keyboard-hid";
import { SUPPORTED_HID_FILTERS } from "@openmouse/protocol/drivers/vendors";
import { WLMouseHidClient } from "@openmouse/protocol/drivers/wlmouse/hid";
import { parsePreviewMode, previewsEnabled, type PreviewMode } from "../preview-modes";
import { sleepLabel } from "./options";
import { traitsFor } from "./traits";
import type {
  AnalogTuning,
  AnalogTuningState,
  ControlSnapshot,
  ProfileView,
  DeviceCapabilities,
  DiagnosticsView,
  LiftOffLevel,
  PulsarToggleSetting,
  SidebarDevice,
  TeevolutionProfile,
  Toast,
  ToastKind,
  WorkspaceTab,
} from "./types";

export const BUILD_LABEL = `${__BUILD_CHANNEL__.toUpperCase()} · v${__APP_VERSION__}`;
const DEFAULT_TITLE = typeof document === "undefined" ? "OpenMouse Control" : document.title;
const ACTIVE_DEVICE_STORAGE_KEY = "openmouse.active-device";
const WLMOUSE_SLEEP_NEVER = 0xffff;
export const RATE_STEPS_HZ = [125, 250, 500, 1000, 2000, 4000, 8000];
export const PULSAR_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [1, "10 seconds"], [3, "30 seconds"], [6, "1 minute"], [12, "2 minutes"],
  [30, "5 minutes"], [60, "10 minutes"], [180, "30 minutes"],
];
const BACKGROUND = "Background refresh";
const FLASH_STEP_DELAY_MS = 420;
const FLASH_SETTLE_MS = 320;

const previewModeEnabled = previewsEnabled(__BUILD_CHANNEL__, import.meta.env.DEV);
const previewMode = previewModeEnabled
  ? parsePreviewMode(new URLSearchParams(window.location.search).get("preview"))
  : null;
const isAnyPreview = previewMode !== null;

let active: SupportedClient | null = null;

type ClientClass<T> = abstract new (...args: never[]) => T;

function activeAs<T>(...classes: ClientClass<T>[]): T | null {
  for (const cls of classes) if (active instanceof cls) return active as T;
  return null;
}

const DM_CLASSES = [WLMouseHidClient, LamzuHidClient, AtkHidClient, NinjutsoHidClient] as const;
const RAZER_CLASSES = [RazerHidClient, RazerViperMiniHidClient, RazerViperHidClient, RazerCobraHidClient] as const;
const NEEDS_OPEN = [TeevolutionHidClient, VgnF2HidClient, KeychronHidClient, KeychronM6HidClient, ModdoHidClient, ZaunkoenigHidClient, FantechHidClient, WallhackMouseHidClient, WallhackKeyboardHidClient] as const;
const DEDICATED = [
  ...DM_CLASSES, ...RAZER_CLASSES, ...NEEDS_OPEN,
  EggOp1HidClient, LogitechHidppClient, OrbitalHidClient, RazerViperV4ProHidClient, FinalmouseHidClient,
] as const;

const logitechClient = (): LogitechHidppClient | null => activeAs(LogitechHidppClient);
const eggClient = (): EggOp1HidClient | null => activeAs(EggOp1HidClient);
const eggWeClient = (): EggWeHidClient | null =>
  active !== null && isEggWeClient(active) ? active : null;
const dmClient = (): WLMouseHidClient | LamzuHidClient | AtkHidClient | NinjutsoHidClient | null =>
  activeAs<WLMouseHidClient | LamzuHidClient | AtkHidClient | NinjutsoHidClient>(...DM_CLASSES);
const razerClient = (): RazerHidClient | RazerViperMiniHidClient | RazerViperHidClient | RazerCobraHidClient | null =>
  activeAs<RazerHidClient | RazerViperMiniHidClient | RazerViperHidClient | RazerCobraHidClient>(...RAZER_CLASSES);
const viperClient = (): RazerViperV4ProHidClient | null => activeAs(RazerViperV4ProHidClient);

const teevolutionClient = (): TeevolutionHidClient | null => activeAs(TeevolutionHidClient);
const finalmouseClient = (): FinalmouseHidClient | null => activeAs(FinalmouseHidClient);
const orbitalClient = (): OrbitalHidClient | null => activeAs(OrbitalHidClient);
const vgnClient = (): VgnF2HidClient | null => activeAs(VgnF2HidClient);
const keychronClient = (): KeychronHidClient | null => activeAs(KeychronHidClient);
const wallhackMouseClient = (): WallhackMouseHidClient | null => activeAs(WallhackMouseHidClient);
/** Pulsar is the fallback: any supported client no dedicated driver claims. */
const pulsarClient = (): PulsarClient | null =>
  active !== null && !isEggWeClient(active) && !DEDICATED.some((cls) => active instanceof cls)
    ? active as PulsarClient
    : null;

let onboardProfiles: OnboardProfile[] | null = null;
let buttons: LogitechReprogrammableControl[] | null = null;
let onboardProfilesLoading = false;
let lastDeviceMode: MouseStatus["deviceMode"] = "Unknown";
let lastProfileFormat: MouseStatus["onboardProfileFormat"] = null;

let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;
let lastRenderedStatusKey: string | null = null;
let activeDevice: HIDDevice | null = null;
const deviceStatuses = new Map<HIDDevice, MouseStatus>();
let latestDiagnosticsSnapshot: Record<string, unknown> | null = null;
let latestDiagnosticStatus: MouseStatus | null = null;
let latestDeviceStatus: MouseStatus | null = null;
let lastDiagnosticCommand: string | null = null;
let lastDiagnosticError: string | null = null;
let reconnectInFlight = false;
let activationInProgress = false;
let activationQueue: Promise<void> = Promise.resolve();
let sidebarHidden = false;
let interfaceSettingsOpen = false;
let activeWorkspaceTab: WorkspaceTab = "performance";
let interfacePreferences = loadInterfacePreferences(localStorage);
let instantFlashQueued = false;
let capabilities: DeviceCapabilities | null = null;
let sidebarDevices: SidebarDevice[] = [];
let lastSleepSeconds = 60;
let previewEntries: Array<[string, string]> = [];
let previewListMessage: string | null = null;

let deviceStatusText = "No device connected";
let readStatus = "Add a supported device from the sidebar to read its current status.";
let onboardStatus = "Profiles load when the mouse is in onboard mode.";
let connectDisabled = false;
let connectLabel = "Add device";

const toasts: Toast[] = [];
let nextToastId = 1;
let diagnosticsOpen = false;
let diagnosticDownloadStatus = "";
let diagnosticsView: DiagnosticsView = {
  overview: [],
  snapshot: "Connect a mouse to collect diagnostics.",
  reads: "",
  downloadReady: false,
  downloadStatus: "",
};

let customDpiEditing = false;
let customDpiText = "";
let pendingBusy = false;
let pendingStatusText: string | null = null;
let profilesExpanded = false;
let eggPollingDivider: number | null = null;
let analogTuning: AnalogTuningState = {
  mode: "both",
  left: { actuation: 1, rapidTrigger: 1, haptics: 0 },
  right: { actuation: 1, rapidTrigger: 1, haptics: 0 },
  both: { actuation: 1, rapidTrigger: 1, haptics: 0 },
};

const listeners = new Set<() => void>();
let snapshot: ControlSnapshot | null = null;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ControlSnapshot {
  snapshot ??= buildSnapshot();
  return snapshot;
}

let batchDepth = 0;
let emitPending = false;

function emit(): void {
  snapshot = null;
  if (batchDepth > 0) { emitPending = true; return; }
  for (const listener of listeners) listener();
}

function batch(run: () => void): void {
  batchDepth += 1;
  try {
    run();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0 && emitPending) {
      emitPending = false;
      emit();
    }
  }
}

function buildProfileView(): ProfileView {
  const entry = editedProfileEntry();
  const rates = lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).reportRates : null;
  return {
    entry,
    summary: describeProfileEntry(entry),
    slotsAvailable: dpiSlotsAvailable(),
    slotsLocked: dpiSlotsLocked(),
    slotLimits: dpiSlotLimits(),
    lodLevels: lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).supportedLods : [],
    rateOptions: {
      wireless: profileReportRateOptions("wireless"),
      wired: profileReportRateOptions("wired"),
    },
    ratesPerProfile: entry !== null && rates !== null,
    ratesShared: (lastProfileFormat?.id ?? 6) < 6,
    ratesLocked: lastProfileFormat?.writable !== true,
    bunnyHopSupported: bunnyHopSupported(),
  };
}

let artworkKey: string | null = null;
let artworkValue: string | null = null;

function deviceArtwork(status: MouseStatus | null): string | null {
  if (!status) return null;
  const key = `${activeDevice?.vendorId ?? 0}:${activeDevice?.productId ?? 0}:${status.name}`;
  if (key !== artworkKey) {
    artworkKey = key;
    artworkValue = deviceImage(activeDevice, status.name);
  }
  return artworkValue;
}

function buildSnapshot(): ControlSnapshot {
  const deviceStatus = latestDeviceStatus;
  const changes = pendingChanges();
  const status = deviceStatus ? withPendingChanges(deviceStatus) : null;
  return {
    deviceStatus,
    status,
    traits: traitsFor(status),
    profile: buildProfileView(),
    capabilities,
    settingsPending: status?.ui?.settingsReady === false,
    deviceStatusText,
    readStatus,
    onboardStatus,
    connectDisabled,
    connectLabel,
    toasts,
    devices: sidebarDevices,
    hasActiveDevice: activeDevice !== null,
    deviceArtwork: deviceArtwork(status),
    settingInProgress,
    preferences: interfacePreferences,
    sidebarHidden,
    interfaceSettingsOpen,
    workspaceTab: activeWorkspaceTab,
    dpiOptions,
    customDpiEditing,
    customDpiText,
    onboardProfiles,
    buttons,
    editedProfile,
    profilesExpanded,
    deviceMode: lastDeviceMode,
    profileFormat: lastProfileFormat,
    dpiSlotPlan,
    dpiAxisLocks,
    stagedBunnyHopMs,
    stagedProfileRates,
    stagedProfileName,
    stagedButtonMappings: Object.fromEntries(stagedButtonMappings),
    stagedProfileButtonAssignments: [...stagedProfileButtonEdits.entries()]
      .filter(([key]) => isPendingChange(key))
      .map(([, edit]) => ({
        layer: edit.layer,
        button: edit.button,
        value: edit.kind === "macro"
          ? "keyboard"
          : typeof edit.binding === "string"
            ? edit.binding
            : edit.binding.kind === "consumer"
              ? `consumer:${edit.binding.usage}`
              : "keyboard",
      })),
    analogTuning,
    eggPollingDivider,
    pending: {
      count: changes.length,
      labels: changes.map((change) => change.label),
      busy: pendingBusy,
      statusText: pendingStatusText,
      suppressed: interfacePreferences.instantFlash,
      keys: changes.map((change) => change.key),
    },
    diagnostics: { ...diagnosticsView, downloadStatus: diagnosticDownloadStatus },
    diagnosticsOpen,
    captureAvailable: logitechClient() !== null && latestDeviceStatus?.brand === "Logitech",
    resetProfilesAvailable: logitechClient() !== null
      && latestDeviceStatus?.brand === "Logitech"
      && supportsFactoryReset(latestDeviceStatus?.onboardProfileFormat?.id ?? null),
    previewMode,
    previewEnabled: previewModeEnabled,
    previewEntries,
    previewListMessage,
    buildLabel: BUILD_LABEL,
  };
}

function setReadStatus(text: string): void {
  readStatus = text;
  emit();
}

const TOAST_TIMEOUT_MS: Record<ToastKind, number> = {
  success: 4200,
  info: 5200,
  warning: 6500,
  error: 8000,
};

const TOAST_LIMIT = 4;
const TOAST_EXIT_MS = 180;

function pushToast(kind: ToastKind, title: string, detail?: string): void {
  const duplicate = toasts.findIndex((entry) => entry.kind === kind && entry.title === title);
  if (duplicate !== -1) toasts.splice(duplicate, 1);

  const id = nextToastId++;
  toasts.unshift({ id, kind, title, detail });
  if (toasts.length > TOAST_LIMIT) toasts.length = TOAST_LIMIT;
  window.setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS[kind]);
  emit();
}

export function dismissToast(id: number): void {
  const toast = toasts.find((entry) => entry.id === id);
  if (!toast || toast.leaving) return;
  toast.leaving = true;
  emit();
  window.setTimeout(() => {
    const index = toasts.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    toasts.splice(index, 1);
    emit();
  }, TOAST_EXIT_MS);
}

function toastForError(title: string, error: unknown): void {
  pushToast("error", title, error instanceof Error ? error.message : title);
}

export function reportStatus(text: string): void {
  setReadStatus(text);
}

function setOnboardStatus(text: string): void {
  onboardStatus = text;
  emit();
}

async function statusAfterWrite(client: SupportedClient): Promise<MouseStatus> {
  const dm = dmClient();
  return dm && client === dm ? await dm.readStatus(true) : await client.readStatus();
}

function activeSettingsClient(): SupportedClient | null {
  return active;
}

function hasActiveClient(): boolean {
  return activeSettingsClient() !== null;
}

function requireSettingsClient(): SupportedClient {
  const client = activeSettingsClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  return client;
}

function requireClientMethod<K extends string>(
  method: K,
  setting: string,
): Extract<SupportedClient, Record<K, unknown>> {
  const client = requireSettingsClient();
  if (!(method in client)) throw new Error(`This mouse does not support changing ${setting} yet.`);
  return client as Extract<SupportedClient, Record<K, unknown>>;
}

function readCapabilities(): DeviceCapabilities {
  const razer = activeAs<RazerHidClient>(RazerHidClient);
  const dm = dmClient();
  const keychron = keychronClient();
  return {
    canDisableSleep: dm?.canDisableSleep === true,
    sleepOptions: dm
      ? [...dm.getSleepOptions()]
      : keychron
        ? [...keychron.getSleepOptions()]
        : null,
    debounceMaxMs: dm?.getDebounceMaxMs() ?? null,
    razerSleepOptions: razer?.getSleepOptions() ?? null,
    razerLowPowerOptions: razer?.getLowPowerOptions() ?? null,
    lowPowerPollingCeiling: razer?.getLowPowerPollingCeiling() ?? null,
    teevolutionProfile: (teevolutionClient()?.getModelProfile()
      ?? teevolutionProfileForCid(14)) as TeevolutionProfile | null,
  };
}

async function callClientMethod(method: string, setting: string, value: unknown): Promise<void> {
  const client = requireClientMethod(method, setting) as unknown as Record<string, (next: never) => Promise<unknown>>;
  await client[method]!(value as never);
}

function stageChange(change: PendingChange): void {
  if (settingInProgress) {
    setReadStatus("Wait for the current flash to finish.");
    return;
  }
  if (matchesDeviceStatus(change)) {
    dropPendingChange(change.key);
    setReadStatus(`${change.label} already matches the mouse.`);
    return;
  }
  stagePendingChange(change);
  if (interfacePreferences.instantFlash) {
    queueInstantFlash();
    emit();
    return;
  }
  setReadStatus(`${change.label} staged. Flash to write it to the mouse.`);
}

function queueInstantFlash(): void {
  if (instantFlashQueued) return;
  instantFlashQueued = true;
  window.setTimeout(() => {
    instantFlashQueued = false;
    // The preference can be switched off before this deferred callback runs.
    // In that case leave the change staged for the Apply bar.
    if (interfacePreferences.instantFlash) void flashPendingChanges();
  });
}

function matchesDeviceStatus(change: PendingChange): boolean {
  if (!latestDeviceStatus) return false;
  if (!change.preview) return false;
  const preview = structuredClone(latestDeviceStatus);
  change.preview(preview);
  return JSON.stringify(preview) === JSON.stringify(latestDeviceStatus);
}

export function revertPendingChanges(): void {
  if (settingInProgress || !hasPendingChanges()) return;
  clearPendingChanges();
  setReadStatus("Discarded the staged changes.");
}

const HAPTIC_GROUP = "logitech-haptic";
const RATCHET_GROUP = "logitech-ratchet";
const WHEEL_MODE_GROUP = "logitech-wheel-mode";
let stagedHapticIntensity: number | null = null;
let stagedHapticEnabled: boolean | null = null;
let stagedHapticBatterySaving: boolean | null = null;
let stagedWheelMode: MouseStatus["wheelMode"] = null;
let stagedSmartShift: number | null | undefined;
let stagedHiRes: boolean | null = null;
let stagedInvertScroll: boolean | null = null;

async function writeStagedHaptics(): Promise<void> {
  const client = logitechClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  if (stagedHapticEnabled !== null) await client.setHapticEnabled(stagedHapticEnabled);
  if (stagedHapticBatterySaving !== null) await client.setHapticBatterySaving(stagedHapticBatterySaving);
  if (stagedHapticIntensity !== null) await client.setHapticIntensity(stagedHapticIntensity);
  if (stagedHapticIntensity !== null || stagedHapticEnabled === true) {
    const effect = stagedHapticEnabled === true && stagedHapticIntensity === null
      ? LOGITECH_HAPTIC_EFFECTS.enableConfirmation
      : LOGITECH_HAPTIC_EFFECTS.strengthSample;
    await client.playHapticEffect(effect).catch(() => undefined);
  }
}

async function writeStagedRatchet(): Promise<void> {
  const client = logitechClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  if (stagedWheelMode) await client.setWheelMode(stagedWheelMode);
  if (stagedSmartShift !== undefined) await client.setSmartShiftThreshold(stagedSmartShift);
}

async function writeStagedWheelMode(): Promise<void> {
  const client = logitechClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  if (stagedHiRes !== null) await client.setHiResScroll(stagedHiRes);
  if (stagedInvertScroll !== null) await client.setInvertScroll(stagedInvertScroll);
}

export function applyHapticIntensity(preset: LogitechHapticPreset): void {
  if (!logitechClient()) return;
  stagedHapticIntensity = LOGITECH_HAPTIC_PRESETS[preset];
  stageChange({
    key: "haptic-strength", group: HAPTIC_GROUP, label: `Haptics ${preset.toLowerCase()}`,
    command: `Set haptic strength to ${preset} (${stagedHapticIntensity})`,
    progress: `Setting haptic strength to ${preset.toLowerCase()}…`,
    preview: (status) => { status.hapticIntensity = LOGITECH_HAPTIC_PRESETS[preset]; },
    apply: writeStagedHaptics,
  });
}

export function applyHapticEnabled(enabled: boolean): void {
  if (!logitechClient()) return;
  stagedHapticEnabled = enabled;
  stageChange({
    key: "haptic-enabled", group: HAPTIC_GROUP, label: `Haptics ${enabled ? "on" : "off"}`,
    command: `Turn haptic feedback ${enabled ? "on" : "off"}`,
    progress: `Turning haptic feedback ${enabled ? "on" : "off"}…`,
    preview: (status) => { status.hapticEnabled = enabled; }, apply: writeStagedHaptics,
  });
}

export function applyHapticBatterySaving(enabled: boolean): void {
  if (!logitechClient()) return;
  stagedHapticBatterySaving = enabled;
  stageChange({
    key: "haptic-battery-saving", group: HAPTIC_GROUP,
    label: `Haptic battery saving ${enabled ? "on" : "off"}`,
    command: `Turn haptic battery saving ${enabled ? "on" : "off"}`,
    progress: `Turning haptic battery saving ${enabled ? "on" : "off"}…`,
    preview: (status) => { status.hapticBatterySaving = enabled; }, apply: writeStagedHaptics,
  });
}

export function applyWheelMode(mode: NonNullable<MouseStatus["wheelMode"]>): void {
  if (!logitechClient()) return;
  stagedWheelMode = mode;
  const wording = mode === "Freespin" ? "free-spin" : "ratchet";
  stageChange({
    key: "wheel-mode", group: RATCHET_GROUP, label: `Wheel ${wording}`,
    command: `Set the wheel to ${wording}`, progress: `Setting the wheel to ${wording}…`,
    preview: (status) => { status.wheelMode = mode; }, apply: writeStagedRatchet,
  });
}

export function applySmartShiftThreshold(threshold: number | null): void {
  if (!logitechClient()) return;
  stagedSmartShift = threshold;
  const off = threshold === null || threshold === LOGITECH_SMART_SHIFT_OFF;
  stageChange({
    key: "smart-shift", group: RATCHET_GROUP, label: off ? "SmartShift off" : `SmartShift ${threshold}`,
    command: off ? "Turn SmartShift off" : `Set the SmartShift threshold to ${threshold}`,
    progress: off ? "Turning SmartShift off…" : `Setting the SmartShift threshold to ${threshold}…`,
    preview: (status) => { status.smartShiftThreshold = threshold ?? LOGITECH_SMART_SHIFT_OFF; },
    apply: writeStagedRatchet,
  });
}

export function applyHiResScroll(enabled: boolean): void {
  if (!logitechClient()) return;
  stagedHiRes = enabled;
  stageChange({
    key: "hi-res-scroll", group: WHEEL_MODE_GROUP,
    label: `High-resolution scrolling ${enabled ? "on" : "off"}`,
    command: `Turn high-resolution scrolling ${enabled ? "on" : "off"}`,
    progress: `Turning high-resolution scrolling ${enabled ? "on" : "off"}…`,
    preview: (status) => { status.hiResScroll = enabled; }, apply: writeStagedWheelMode,
  });
}

export function applyInvertScroll(inverted: boolean): void {
  if (!logitechClient()) return;
  stagedInvertScroll = inverted;
  stageChange({
    key: "invert-scroll", group: WHEEL_MODE_GROUP,
    label: inverted ? "Scroll inverted" : "Scroll normal",
    command: `${inverted ? "Invert" : "Restore"} the scroll direction`,
    progress: `${inverted ? "Inverting" : "Restoring"} the scroll direction…`,
    preview: (status) => { status.invertScroll = inverted; }, apply: writeStagedWheelMode,
  });
}

export function applyThumbWheelInverted(inverted: boolean): void {
  if (!logitechClient()) return;
  stageChange({
    key: "thumb-wheel-invert", label: inverted ? "Thumb wheel inverted" : "Thumb wheel normal",
    command: `${inverted ? "Invert" : "Restore"} the thumb-wheel direction`,
    progress: `${inverted ? "Inverting" : "Restoring"} the thumb wheel…`,
    preview: (status) => { status.thumbWheelInverted = inverted; },
    apply: async () => {
      const client = logitechClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await client.setThumbWheelInverted(inverted);
    },
  });
}

export function applyFriendlyName(name: string): void {
  const trimmed = name.trim();
  if (!logitechClient() || !trimmed) return;
  stageChange({
    key: "friendly-name", label: `Name "${trimmed}"`, command: `Rename the mouse to "${trimmed}"`,
    progress: `Renaming the mouse to "${trimmed}"…`,
    preview: (status) => { status.friendlyName = trimmed; },
    apply: async () => {
      const client = logitechClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await client.setFriendlyName(trimmed);
    },
  });
}

export async function requestHostSwitch(slot: number): Promise<void> {
  const client = logitechClient();
  if (!client) return;
  try {
    await client.requestHostSwitch(slot);
    const message = `Switch to computer ${slot + 1} requested. Press the button underneath the mouse to bring it back.`;
    setReadStatus(message);
    pushToast("info", `Switching to computer ${slot + 1}`, "Press the button underneath the mouse to bring it back.");
  } catch (error) {
    setReadStatus(error instanceof Error ? error.message : "Unable to request the switch.");
    toastForError("Unable to request the switch", error);
  }
}

/**
 * Reads the reprogrammable controls, if the mouse has any.
 *
 * Two round-trips per control puts this well outside what the refresh poll can
 * afford, so it runs on connect and after a write. A mouse without 0x1B04
 * answers with an empty list and the card stays hidden.
 */
async function readButtons(): Promise<void> {
  const client = logitechClient();
  if (!client) {
    buttons = null;
    return;
  }
  try {
    const controls = await client.readButtons();
    buttons = controls.length > 0 ? controls : null;
  } catch {
    // A mouse that will not answer keeps the card hidden rather than showing
    // an empty one; the next connect tries again.
    buttons = null;
  }
}

const BUTTON_GROUP = "logitech-buttons";
const stagedButtonMappings = new Map<number, number>();

/**
 * Stages a remap.
 *
 * There is no preview: the controls are not part of MouseStatus, so the card
 * renders the staged mapping itself rather than mirroring it onto a status
 * snapshot. Every staged remap shares one group and is written together, in
 * the order it was staged.
 */
export function applyButtonMapping(controlId: number, targetControlId: number): void {
  if (!logitechClient()) return;
  const control = buttons?.find((candidate) => candidate.controlId === controlId);
  if (!control) return;
  if (control.mappedTo === targetControlId) {
    stagedButtonMappings.delete(controlId);
    dropPendingChange(`button-${controlId}`);
    emit();
    return;
  }
  stagedButtonMappings.set(controlId, targetControlId);
  const target = logitechControlName(targetControlId);
  stageChange({
    key: `button-${controlId}`,
    group: BUTTON_GROUP,
    label: `${control.name} → ${target}`,
    command: `Remap ${control.name} (0x${controlId.toString(16).padStart(4, "0")}) to ${target}`,
    progress: `Remapping ${control.name} to ${target}…`,
    apply: writeStagedButtonMappings,
  });
}

async function writeStagedButtonMappings(): Promise<void> {
  const client = logitechClient();
  if (!client) return;
  try {
    for (const [controlId, targetControlId] of stagedButtonMappings) {
      buttons = await client.setButtonMapping(controlId, targetControlId);
    }
  } finally {
    stagedButtonMappings.clear();
  }
}

/**
 * Hands diverted buttons back to the hardware.
 *
 * Immediate rather than staged, unlike a remap. A diversion is state another
 * application left in the mouse, not a preference this user expressed, and the
 * button does nothing at all until it is cleared — staging a repair behind a
 * flash step would leave a dead button dead for no reason.
 */
export async function restoreDivertedButtons(): Promise<void> {
  const client = logitechClient();
  if (!client || settingInProgress) return;
  settingInProgress = true;
  setReadStatus("Restoring buttons to hardware control…");
  emit();
  try {
    buttons = await client.clearButtonDiversion();
    setReadStatus("Buttons restored to hardware control.");
  } catch (error) {
    setReadStatus(error instanceof Error ? error.message : "Unable to restore the buttons.");
  } finally {
    settingInProgress = false;
    emit();
  }
}

async function flashPause(milliseconds = FLASH_STEP_DELAY_MS): Promise<void> {
  if (interfacePreferences.reducedMotion) return;
  await wait(milliseconds);
}

export async function flashPendingChanges(): Promise<void> {
  const batches = pendingChangeBatches();
  if (batches.length === 0 || settingInProgress) return;
  settingInProgress = true;
  pendingBusy = true;
  emit();
  if (refreshInProgress) {
    pendingStatusText = "Waiting for the current device refresh…";
    readStatus = pendingStatusText;
    emit();
    while (refreshInProgress) await wait(25);
  }
  let written = 0;
  let failure: string | null = null;
  try {
    for (const batch of batches) {
      const writer = batch[batch.length - 1];
      if (!writer) continue;
      pendingStatusText = `${writer.progress} (${written + 1} of ${batches.length})`;
      readStatus = writer.progress;
      emit();
      await flashPause();
      for (const change of batch) recordDiagnosticCommand(change.command);
      await writer.apply();
      for (const change of batch) dropPendingChange(change.key);
      written += batch.length;
    }
  } catch (error) {
    recordDiagnosticError(error, "Unable to flash the staged changes.");
    failure = error instanceof Error ? error.message : "Unable to flash the staged changes.";
  }
  await flashPause(FLASH_SETTLE_MS);
  const client = activeSettingsClient();
  const status = client ? await statusAfterWrite(client).catch(() => null) : null;
  if (status) applyStatus(status);
  endDeviceWrite();
  pendingBusy = false;
  if (failure) {
    pendingStatusText = failure;
    setReadStatus(failure);
    pushToast("error", "Flash failed", failure);
    return;
  }
  pendingStatusText = null;
  const flashed = written === 1
    ? "Flashed 1 change to the mouse."
    : `Flashed ${written} changes to the mouse.`;
  setReadStatus(flashed);
  pushToast("success", flashed);
}

function endDeviceWrite(): void {
  settingInProgress = false;
  syncProfileDerivedState();
  emit();
}

function saveInterfacePreferences(): void {
  persistInterfacePreferences(localStorage, interfacePreferences);
  emit();
}

export function setPreference<K extends keyof InterfacePreferences>(
  key: K,
  value: InterfacePreferences[K],
): void {
  interfacePreferences = { ...interfacePreferences, [key]: value };
  saveInterfacePreferences();
}

export function setInterfaceTheme(value: string): void {
  setPreference("theme", value as InterfaceTheme);
}

export function resetInterfacePreferences(): void {
  interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES };
  saveInterfacePreferences();
}

export function toggleSidebar(): void {
  sidebarHidden = !sidebarHidden;
  emit();
}

export function openInterfaceSettings(): void {
  interfaceSettingsOpen = true;
  void loadPreviewEntries();
  emit();
}

export function closeInterfaceSettings(): void {
  interfaceSettingsOpen = false;
  emit();
}

export function setWorkspaceTab(tab: WorkspaceTab): void {
  activeWorkspaceTab = tab;
  emit();
}

export function setDiagnosticsOpen(open: boolean): void {
  diagnosticsOpen = open;
  if (open) renderDeviceDiagnostics(latestDiagnosticStatus);
  emit();
}

function batteryMode(state: MouseStatus["batteryState"]): BatteryMode | null {
  if (state === "Charging" || state === "Charging slowly" || state === "Almost full") return "charging";
  if (state === "Discharging") return "discharging";
  return null;
}

export function batteryDetail(status: MouseStatus): string {
  const voltage = status.batteryVoltageMv ? `${(status.batteryVoltageMv / 1000).toFixed(3)} V` : null;
  const lead = batteryNeedsCharging(status.batteryPercent, status.batteryState) ? "Needs charging" : null;
  const withVoltage = (detail: string): string => [lead, detail, voltage].filter(Boolean).join(" · ");
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
  renderDeviceDiagnostics(latestDiagnosticStatus);
}

function configureProfileCapture(status: MouseStatus | null): void {
  const profileClient = status?.brand === "Logitech" ? logitechClient() : null;
  const formatId = status?.onboardProfileFormat?.id ?? null;
  setCaptureContext({
    device: activeDevice ? describeHidDevice(activeDevice) : status?.name ?? null,
    profileFormat: status?.onboardProfileFormat
      ? `${status.onboardProfileFormat.id} · ${status.onboardProfileFormat.name}`
      : null,
    profiles: profileClient && formatId !== null
      ? {
        read: async () => (await profileClient.readOnboardProfiles())
          .map((profile) => ({ sector: profile.sector, bytes: profile.raw })),
        readVerification: async () => {
          const verification = await profileClient.readOnboardProfileVerification();
          return {
            ...verification,
            profiles: verification.profiles.map((profile) => ({
              sector: profile.sector,
              enabled: profile.enabled,
              isCurrent: profile.isCurrent,
              crcValid: profile.crcValid,
              decoded: {
                name: profile.name,
                dpiStages: profile.dpiStages,
                defaultDpiIndex: profile.defaultDpiIndex,
                reportRateWireless: profile.reportRateWireless,
                reportRateWired: profile.reportRateWired,
                angleSnapping: profile.angleSnapping,
                powerSaveTimeoutSeconds: profile.powerSaveTimeoutSeconds,
                powerOffTimeoutSeconds: profile.powerOffTimeoutSeconds,
                bunnyHoppingMs: profile.bunnyHoppingMs,
              },
              bytes: profile.raw,
            })),
          };
        },
        describeOffset: (offset) => describeOffset(formatId, offset),
        reproduce: (before, after) => reproduceProfile(before, after, formatId),
      }
      : null,
    writeProbe: profileClient === null
      ? null
      : supportsProfileWriteProbe(formatId)
        ? {
          supported: true,
          reason: `Run the guarded write probe for profile format ${formatId}`,
          prepare: () => profileClient.prepareProfileContentWriteProbe(),
          run: (backup: Parameters<LogitechHidppClient["runProfileContentWriteProbe"]>[0]) =>
            profileClient.runProfileContentWriteProbe(backup),
        }
        : {
          supported: false,
          reason: formatId === null
            ? "This Logitech mouse does not report an onboard-profile format"
            : `The guarded write probe does not support profile format ${formatId}`,
        },
  });
}

function serializeCollection(collection: HIDCollectionInfo): object {
  return {
    usagePage: `0x${formatHex(collection.usagePage, 4)}`,
    usage: `0x${formatHex(collection.usage, 4)}`,
    inputReports: collection.inputReports.map((report) => `0x${formatHex(report.reportId)}`),
    outputReports: collection.outputReports.map((report) => `0x${formatHex(report.reportId)}`),
    featureReports: collection.featureReports.map((report) => `0x${formatHex(report.reportId)}`),
    children: collection.children.map(serializeCollection),
  };
}

function renderDeviceDiagnostics(status: MouseStatus | null): void {
  configureProfileCapture(status);
  if (!diagnosticsOpen) return;

  const device = activeDevice;
  if (!device && !status && !lastDiagnosticError) {
    diagnosticsView = {
      overview: [],
      snapshot: "Connect a mouse to collect diagnostics.",
      reads: "",
      downloadReady: false,
      downloadStatus: diagnosticDownloadStatus,
    };
    emit();
    return;
  }
  const driver = status
    ? (status.ui?.family ? `${status.brand} · ${status.ui.family}` : status.brand)
    : "No driver read this device";
  const overview: Array<[string, string]> = [
    ["Driver", driver],
    ["VID / PID", device ? `0x${formatHex(device.vendorId, 4)} / 0x${formatHex(device.productId, 4)}` : "Not reported"],
    ["Build", BUILD_LABEL],
    ["Last command", lastDiagnosticCommand ?? "None"],
  ];
  if (lastDiagnosticError) overview.push(["Last error", lastDiagnosticError]);

  const collected = {
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
  latestDiagnosticsSnapshot = collected;
  diagnosticsView = {
    overview,
    snapshot: JSON.stringify(collected, null, 2),
    reads: renderReadTable(),
    downloadReady: true,
    downloadStatus: diagnosticDownloadStatus,
  };
  emit();
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

/** Returns exactly the diagnostic object shown for consent before an upload. */
export function supportDiagnosticBundle(): Record<string, unknown> | null {
  if (!latestDiagnosticsSnapshot || !activeDevice) return null;
  const rows = hidTraffic(activeDevice);
  return {
    ...latestDiagnosticsSnapshot,
    logStart: rows.length > 0 ? new Date(performance.timeOrigin + rows[0].at).toISOString() : null,
    log: diagnosticsLog(),
  };
}

function diagnosticsFileName(): string {
  const device = activeDevice;
  const ids = device ? `${formatHex(device.vendorId, 4)}-${formatHex(device.productId, 4)}` : "no-device";
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `openmouse-${ids}-${stamp}.json`.toLowerCase();
}

export function downloadDiagnostics(): void {
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
  diagnosticDownloadStatus = `Saved ${name}`;
  emit();
}

function setPageTitle(prefix?: string): void {
  document.title = prefix ? `${prefix} - ${DEFAULT_TITLE}` : DEFAULT_TITLE;
}

function applyStatus(deviceStatus: MouseStatus, statusKey?: string): void {
  batch(() => applyStatusInner(deviceStatus, statusKey));
}

function applyStatusInner(deviceStatus: MouseStatus, statusKey?: string): void {
  latestDeviceStatus = deviceStatus;
  latestDiagnosticStatus = deviceStatus;
  lastRenderedStatusKey = statusKey ?? JSON.stringify(deviceStatus);
  const status = withPendingChanges(deviceStatus);

  const battery = status.batteryPercent;
  const charging = batteryMode(status.batteryState) === "charging" ? "⚡" : "";
  setPageTitle(battery === null ? status.name : `${charging}${battery}% - ${status.name}`);

  if (activeDevice) {
    deviceStatuses.set(activeDevice, deviceStatus);
    void refreshSidebar();
  }
  deviceStatusText = "Connected";

  const settingsPending = status.ui?.settingsReady === false;
  if (settingsPending) {
    const summary = deviceStatus.batteryPercent === null
      ? "Connected"
      : `Battery ${deviceStatus.batteryPercent}%`;
    readStatus = status.ui?.valuesVerified
      ? [summary, `${deviceStatus.dpi.toLocaleString()} DPI`, `${deviceStatus.pollingRateHz.toLocaleString()} Hz`].join(" · ")
      : summary;
  } else if (!hasPendingChanges()) {
    readStatus = `Current: ${deviceStatus.dpi.toLocaleString()} DPI · ${deviceStatus.pollingRateHz.toLocaleString()} Hz`;
  }

  if (!customDpiEditing) customDpiText = `${status.dpi.toLocaleString()} DPI`;

  const tuning = status.brand === "Logitech" ? status.analogButtonTuning : undefined;
  if (tuning && tuning.buttons.length === 2) {
    analogTuning = {
      mode: analogTuning.mode,
      left: { ...tuning.buttons[0] },
      right: { ...tuning.buttons[1] },
      both: { ...tuning.buttons[0] },
    };
  }
  if (status.eggPollingDivider != null) eggPollingDivider = status.eggPollingDivider;

  const supportsOnboard = status.brand === "Logitech"
    && status.deviceMode !== undefined
    && status.deviceMode !== "Unknown";
  if (supportsOnboard) {
    lastDeviceMode = status.deviceMode;
    lastProfileFormat = status.onboardProfileFormat ?? null;
    if (onboardProfiles === null && !onboardProfilesLoading) void reloadOnboardProfiles();
    else syncProfileDerivedState();
  }

  renderDeviceDiagnostics(deviceStatus);
  emit();
}

function sidebarEntries(devices: HIDDevice[]): SidebarDevice[] {
  const supported = listLogicalDevices(devices);
  return supported.map((device, index) => {
    const client = createSupportedClient(device)!;
    const status = deviceStatuses.get(device);
    const name = status?.name
      ?? status?.ui?.defaultDisplayName
      ?? (isEggWeClient(client)
        ? EGG_WE_DISPLAY_NAME
        : client instanceof FinalmouseHidClient
          ? client.displayName()
          : (device.productName ?? `${deviceBrand(client)} mouse`));
    const detail = status
      ? `${status.brand} · ${status.connectionType ?? "Connected"}`
      : `${deviceBrand(client)} · Available`;
    return { index, name, detail, selected: device === activeDevice };
  });
}

async function refreshSidebar(devices?: HIDDevice[]): Promise<void> {
  const all = devices ?? await navigator.hid?.getDevices() ?? [];
  sidebarDevices = sidebarEntries(all);
  emit();
}

function deviceStorageKey(device: HIDDevice): string {
  return [device.vendorId, device.productId, device.productName || "unknown"].join(":");
}

function storedActiveDeviceKey(): string | null {
  try {
    return localStorage.getItem(ACTIVE_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberActiveDevice(device: HIDDevice): void {
  try {
    localStorage.setItem(ACTIVE_DEVICE_STORAGE_KEY, deviceStorageKey(device));
  } catch {
  }
}

export async function selectAuthorizedDevice(index: number): Promise<void> {
  if (settingInProgress || refreshInProgress) return;
  const devices = listLogicalDevices(await navigator.hid?.getDevices() ?? []);
  const device = devices[index];
  if (!device || device === activeDevice) return;
  const client = createSupportedClient(device);
  if (!client) return;
  deviceStatusText = "Switching";
  readStatus = `Reading ${statusNameForClient(client)}.`;
  emit();
  try {
    await activateClient(client);
  } catch (error) {
    deviceStatusText = "Connection failed";
    readStatus = error instanceof Error ? error.message : "Unable to switch devices.";
    toastForError("Connection failed", error);
    await refreshSidebar();
  }
}

function statusNameForClient(client: SupportedClient): string {
  if (isEggWeClient(client)) return EGG_WE_DISPLAY_NAME;
  if (client instanceof FinalmouseHidClient) return client.displayName();
  return client.device.productName || "the selected mouse";
}

function clearActiveClients(): void {
  active = null;
}

async function activateClientNow(client: SupportedClient): Promise<void> {
  while (refreshInProgress) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  if (active && active !== client) await active.close().catch(() => undefined);
  clearPendingChanges();
  latestDeviceStatus = null;
  clearActiveClients();
  if (activeDevice !== client.device) onboardProfiles = null;
  buttons = null;
  activeDevice = client.device;
  recordDiagnosticCommand("Read device status");
  lastRenderedStatusKey = null;
  active = client;

  if (isEggWeClient(client)) await eggWePrepare(client);
  if (NEEDS_OPEN.some((cls) => client instanceof cls)) await (client as { open(): Promise<unknown> }).open();

  if (pulsarClient() !== null) {
    await showPulsarExplorer(client as PulsarClient);
  } else {
    const status = await client.readStatus();
    dpiOptions = await client.getDpiOptions();
    const dm = dmClient();
    const keychron = keychronClient();
    if (dm) lastSleepSeconds = status.sleepTimeout ?? dm.getSleepOptions()[0] ?? 60;
    else if (keychron) {
      lastSleepSeconds = status.sleepTimeout ?? keychron.getSleepOptions()[0] ?? 60;
    }
    deviceStatuses.set(client.device, status);
    capabilities = readCapabilities();
    applyStatus(status);
    await readButtons();
    if (dm) {
      await dm.startNotifications(() => {
        void refreshStatus();
      }).catch(() => false);
    }
  }

  await refreshSidebar();
  rememberActiveDevice(client.device);
  startAutomaticRefresh();
  setConnectionButtons(false, "Add device");
  pushToast("success", `Connected to ${statusNameForClient(client)}`);
}

function activateClient(client: SupportedClient): Promise<void> {
  const run = activationQueue.then(async () => {
    activationInProgress = true;
    try {
      await activateClientNow(client);
    } finally {
      activationInProgress = false;
    }
  });
  activationQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function showPulsarExplorer(client: PulsarClient): Promise<void> {
  await client.open();
  deviceStatusText = "Connected";
  readStatus = client.describeCollections();
  emit();
  await client.readDeviceInfo();
  const status = await client.readStatus();
  dpiOptions = client.getDpiOptions();
  deviceStatuses.set(client.device, status);
  capabilities = readCapabilities();
  applyStatus(status);
  startAutomaticRefresh();
}

function showDisconnectedState(): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  clearActiveClients();
  activeDevice = null;
  onboardProfiles = null;
  lastRenderedStatusKey = null;
  capabilities = null;
  clearPendingChanges();
  latestDeviceStatus = null;
  setPageTitle();
  deviceStatusText = "No device connected";
  readStatus = "Add a supported device from the sidebar to read its current status.";
  setConnectionButtons(false, "Add device");
}

function handleHidConnect(event: HIDConnectionEvent): void {
  if (activeDevice === event.device) {
    void refreshSidebar();
    return;
  }
  const client = createSupportedClient(event.device);
  if (!client) {
    void refreshSidebar();
    return;
  }

  if (isEggWeClient(client)) {
    void (async () => {
      const all = await navigator.hid?.getDevices() ?? [];
      await refreshSidebar(all);
      const result = await eggWeResolveConnect(event.device, eggWeClient(), activeDevice, all);
      if (result.action === "ignore") return;
      if (result.action === "refresh") {
        try {
          const status = await result.client.readStatus();
          deviceStatuses.set(result.client.device, status);
          applyStatus(status);
          startAutomaticRefresh();
        } catch {
        }
        return;
      }
      deviceStatusText = result.reason === "path" ? "Switching path" : "New device detected";
      readStatus = result.reason === "path"
        ? "Preferring USB over receiver."
        : `Reading ${EGG_WE_DISPLAY_NAME}.`;
      emit();
      await activateClient(result.client);
    })().catch((error: unknown) => {
      deviceStatusText = "Connection failed";
      readStatus = error instanceof Error ? error.message : "Unable to read the connected mouse.";
      toastForError("Connection failed", error);
      void refreshSidebar();
    });
    return;
  }

  deviceStatusText = "New device detected";
  readStatus = `Reading ${statusNameForClient(client)}.`;
  emit();
  void activateClient(client).catch((error: unknown) => {
    deviceStatusText = "Connection failed";
    readStatus = error instanceof Error ? error.message : "Unable to read the connected mouse.";
    toastForError("Connection failed", error);
    void refreshSidebar();
  });
}

function handleHidDisconnect(event: HIDConnectionEvent): void {
  deviceStatuses.delete(event.device);
  // Multi-collection drivers (cmd + notify) treat either handle as the active mouse.
  if (event.device !== activeDevice && !eggWeOwnsDevice(eggWeClient(), event.device)) {
    void refreshSidebar();
    return;
  }
  showDisconnectedState();
  pushToast("info", "Mouse disconnected", event.device.productName || "The device was removed.");
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
      await refreshSidebar(devices);
    }
  })().catch((error: unknown) => {
    readStatus = error instanceof Error ? error.message : "Unable to switch to another connected mouse.";
    void refreshSidebar();
  });
}

async function requestSupportedClient(): Promise<SupportedClient | null> {
  if (!navigator.hid) throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
  const devices = await navigator.hid.requestDevice({ filters: SUPPORTED_HID_FILTERS });
  if (devices.length === 0) return null;

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
  const nativeOnly = devices.find((device) => {
    const product = RAZER_PRODUCTS.get(device.productId) as { nativeOnly?: boolean } | undefined;
    return product?.nativeOnly === true;
  });
  if (nativeOnly) {
    // A nativeOnly model (e.g. DeathAdder V4 Pro) moves its control channel to
    // a collection the browser refuses to expose, so the picker filters should
    // not offer it at all. If one was granted anyway, say why it cannot work.
    const product = RAZER_PRODUCTS.get(nativeOnly.productId);
    throw new Error(
      `The ${product?.model ?? "mouse"} cannot be read in the browser: its control channel `
      + "sits on a protected HID collection. Razer only exposes it through the desktop "
      + "Synapse app, so this mouse needs a native client.",
    );
  }
  throw new Error(
    `Selected device is not a supported control interface (${details}). `
    + "Pick a vendor control interface (not a plain boot mouse). "
    + "If this keeps failing, note the VID/PID from this message.",
  );
}

export async function connect(): Promise<void> {
  setConnectionButtons(true, "Connecting…");
  deviceStatusText = "Requesting permission";
  readStatus = "Choose your device in the browser prompt.";
  emit();

  try {
    const client = await requestSupportedClient();
    if (!client) {
      deviceStatusText = "Not connected";
      readStatus = "No device was selected in the browser prompt.";
      return;
    }
    deviceStatusText = "Opening device";
    readStatus = `Reading ${statusNameForClient(client)}…`;
    emit();
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the mouse.";
    const wrongDevice = error instanceof NotAMouseError;
    if (!wrongDevice) recordDiagnosticError(error, message);
    if (eggClient() ?? eggWeClient()) {
      await active?.close().catch(() => undefined);
      active = null;
    }
    deviceStatusText = wrongDevice ? "Not a mouse" : "Connection failed";
    readStatus = message;
    toastForError(wrongDevice ? "Not a mouse" : "Connection failed", error);
  } finally {
    setConnectionButtons(false, "Add device");
  }
}

async function reconnectAuthorizedDevice(): Promise<void> {
  if (hasActiveClient() || reconnectInFlight) return;
  reconnectInFlight = true;

  let lastError: Error | null = null;
  try {
    // Browsers can restore WebHID authorization a fraction of a second after the
    // page is ready. Poll quickly at first so reloads do not feel stalled, then
    // keep a few wider retries for slower USB enumeration.
    const retryDelays = [0, 40, 60, 75, 100, 150, 225, 350, 500, 750];
    for (const delay of retryDelays) {
      if (hasActiveClient()) return;
      if (delay) await waitForHidChange(delay);
      if (hasActiveClient()) return;

      const devices = await navigator.hid?.getDevices() ?? [];
      const preferredKey = storedActiveDeviceKey();
      const clients = listLogicalDevices(devices)
        .map((device) => ({
          client: createSupportedClient(device),
          preferred: deviceStorageKey(device) === preferredKey,
          score: clientSupportScore(device),
        }))
        .filter((entry): entry is { client: SupportedClient; preferred: boolean; score: number } => entry.client !== null)
        .sort((left, right) => Number(right.preferred) - Number(left.preferred) || right.score - left.score)
        .map((entry) => entry.client);
      await refreshSidebar(devices);
      if (clients.length === 0) continue;

      for (const client of clients) {
        if (hasActiveClient()) return;
        try {
          deviceStatusText = "Reconnecting";
          readStatus = "Reading the previously authorized device.";
          emit();
          await activateClient(client);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unable to reconnect to the mouse.");
          await client.close().catch(() => undefined);
        }
      }
    }
    if (!hasActiveClient()) {
      deviceStatusText = "Not connected";
      readStatus = lastError?.message ?? "Use Add device if the mouse does not reconnect automatically.";
      if (lastError) pushToast("error", "Could not reconnect the mouse", lastError.message);
      emit();
    }
  } finally {
    reconnectInFlight = false;
  }
}

function setConnectionButtons(disabled: boolean, label: string): void {
  connectDisabled = disabled;
  connectLabel = label;
  emit();
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

export function startCustomDpi(): void {
  if (customDpiEditing) return;
  customDpiEditing = true;
  customDpiText = customDpiText.replace(/[^\d]/g, "");
  emit();
}

export function setCustomDpiText(value: string): void {
  const digits = value.replace(/\D/g, "");
  const max = dpiOptions.length > 0 ? Math.max(...dpiOptions) : null;
  customDpiText = max !== null && digits !== "" && Number(digits) > max ? String(max) : digits;
  emit();
}

export function commitCustomDpi(): void {
  const dpi = Number(customDpiText.replace(/[^\d]/g, ""));
  if (!Number.isInteger(dpi) || !dpiOptions.includes(dpi)) {
    const closest = Number.isInteger(dpi) && dpi > 0 ? closestDpiOption(dpiOptions, dpi) : null;
    setReadStatus(closest === null
      ? "That DPI value is not supported by this mouse."
      : `This mouse cannot do ${dpi.toLocaleString()} DPI. The closest step it supports is ${closest.toLocaleString()}.`);
    return;
  }
  if (applyDpiValue(dpi)) cancelCustomDpi(dpi);
}

export function cancelCustomDpi(dpi?: number): void {
  const fallback = dpi ?? latestDeviceStatus?.dpi ?? dpiOptions[0] ?? 800;
  customDpiEditing = false;
  customDpiText = `${fallback.toLocaleString()} DPI`;
  emit();
}

export function applyDpiValue(dpi: number): boolean {
  if (!hasActiveClient() || !dpiOptions.includes(dpi)) return false;
  stageChange({
    key: "dpi",
    label: `DPI ${dpi.toLocaleString()}`,
    command: `Set DPI to ${dpi.toLocaleString()}`,
    progress: `Setting ${dpi.toLocaleString()} DPI…`,
    preview: (status) => {
      status.dpi = dpi;
      if (status.dpiY !== undefined) status.dpiY = dpi;
      // Stage-aware mice: presets write the active stage; keep the table in sync.
      if (status.dpiStages && status.activeDpiStage != null && status.activeDpiStage < status.dpiStages.length) {
        status.dpiStages = status.dpiStages.map((value, index) => (
          index === status.activeDpiStage ? dpi : value
        ));
      }
    },
    apply: async () => {
      await requireClientMethod("setDpi", "DPI").setDpi(dpi);
    },
  });
  return true;
}

export function applyDpiStageCount(count: number): void {
  if (!hasActiveClient()) return;
  const editor = latestDeviceStatus?.ui?.dpiStageEditor;
  if (!editor || editor.countEditable !== true) return;
  if (!Number.isInteger(count) || count < 1 || count > editor.maxStages) return;
  if (!("setDpiStageCount" in requireSettingsClient())) return;
  stageChange({
    key: "dpi-stage-count",
    label: `${count} DPI stage${count === 1 ? "" : "s"}`,
    command: `Set DPI stage count to ${count}`,
    progress: `Setting ${count} DPI stages…`,
    preview: (status) => {
      const current = status.dpiStages?.slice() ?? [];
      if (count <= current.length) status.dpiStages = current.slice(0, count);
      else {
        const padded = current.slice();
        while (padded.length < count) padded.push(padded.at(-1) ?? status.dpi);
        status.dpiStages = padded;
      }
      if ((status.activeDpiStage ?? 0) >= count) {
        status.activeDpiStage = count - 1;
        status.dpi = status.dpiStages[count - 1] ?? status.dpi;
      }
    },
    apply: async () => {
      await requireClientMethod("setDpiStageCount", "DPI stage count").setDpiStageCount(count);
    },
  });
}

export function applyActiveDpiStage(stage: number): void {
  if (!hasActiveClient()) return;
  const stages = latestDeviceStatus ? withPendingChanges(latestDeviceStatus).dpiStages : undefined;
  if (!stages || !Number.isInteger(stage) || stage < 0 || stage >= stages.length) return;
  stageChange({
    key: "dpi-active-stage",
    label: `DPI stage ${stage + 1}`,
    command: `Set active DPI stage to ${stage + 1}`,
    progress: `Selecting DPI stage ${stage + 1}…`,
    preview: (status) => {
      status.activeDpiStage = stage;
      status.dpi = status.dpiStages?.[stage] ?? status.dpi;
    },
    apply: async () => {
      await requireClientMethod("setActiveDpiStage", "DPI stage").setActiveDpiStage(stage);
    },
  });
}

export function applyDpiStageValue(stage: number, rawDpi: number): void {
  if (!hasActiveClient()) return;
  const stagedStatus = latestDeviceStatus ? withPendingChanges(latestDeviceStatus) : null;
  const stages = stagedStatus?.dpiStages ?? latestDeviceStatus?.dpiStages;
  if (!stages || !Number.isInteger(stage) || stage < 0 || stage >= stages.length) return;
  const dpi = closestDpiOption(dpiOptions, rawDpi) ?? rawDpi;
  if (!dpiOptions.includes(dpi)) {
    setReadStatus(`${rawDpi.toLocaleString()} DPI is not supported by this mouse.`);
    emit();
    return;
  }
  stageChange({
    key: `dpi-stage-${stage}`,
    label: `Stage ${stage + 1} · ${dpi.toLocaleString()} DPI`,
    command: `Set DPI stage ${stage + 1} to ${dpi.toLocaleString()}`,
    progress: `Setting stage ${stage + 1} to ${dpi.toLocaleString()} DPI…`,
    preview: (status) => {
      // Pad first so a newly added stage (only present via a staged count
      // increase) still diffs against the device snapshot in matchesDeviceStatus.
      const next = status.dpiStages?.slice() ?? [];
      while (next.length <= stage) next.push(next.at(-1) ?? status.dpi);
      next[stage] = dpi;
      status.dpiStages = next;
      if ((status.activeDpiStage ?? 0) === stage) status.dpi = dpi;
    },
    apply: async () => {
      await requireClientMethod("setDpiStageValue", "DPI stage value").setDpiStageValue(stage, dpi);
    },
  });
}

export function applyLogitechAxisDpi(dpiX: number, dpiY: number): void {
  if (!logitechClient()) return;
  if (!dpiOptions.includes(dpiX) || !dpiOptions.includes(dpiY)) {
    setReadStatus("Both axis values must be advertised DPI values.");
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
      const client = logitechClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await client.setDpi(dpiX, dpiY);
    },
  });
}

export function setAnalogTuningMode(mode: "independent" | "both"): void {
  analogTuning = { ...analogTuning, mode };
  emit();
}

export function setAnalogTuningValue(
  group: "left" | "right" | "both",
  setting: keyof AnalogTuning,
  value: number,
): void {
  analogTuning = { ...analogTuning, [group]: { ...analogTuning[group], [setting]: value } };
  emit();
}

function stageAnalogButton(button: 0 | 1, tuning: AnalogTuning): void {
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
      const client = logitechClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await client.setAnalogButtonTuning(button, tuning);
    },
  });
}

export function applyLogitechAnalogButton(button: 0 | 1): void {
  if (!logitechClient()) return;
  stageAnalogButton(button, button === 0 ? analogTuning.left : analogTuning.right);
}

export function applyLogitechAnalogButtons(): void {
  if (!logitechClient()) return;
  stageAnalogButton(0, analogTuning.both);
  stageAnalogButton(1, analogTuning.both);
}

const BUNNY_HOP_KEY = "logitech-bunny-hop";
/**
 * Settings written into the active profile's sector. Flash is erased and
 * rewritten a whole sector at a time, so two of these staged together must
 * cost one erase cycle, not two.
 */
const PROFILE_SECTOR_GROUP = "logitech-profile-sector";
const DPI_SLOTS_KEY = "logitech-dpi-slots";
const PROFILE_NAME_KEY = "logitech-profile-name";
const PROFILE_RATE_KEY = "logitech-profile-rate";
const PROFILE_BUTTON_KEY_PREFIX = "logitech-profile-button";

let stagedBunnyHopMs: number | null = null;
let stagedProfileName: string | null = null;
let stagedProfileRates: { wireless: number | null; wired: number | null } = { wireless: null, wired: null };
type StagedProfileButtonEdit =
  | { kind: "assignment"; layer: "primary" | "g-shift"; button: number; binding: LogitechButtonAction | LogitechButtonBinding }
  | { kind: "macro"; layer: "primary" | "g-shift"; button: number; steps: LogitechMacroStep[] };
const stagedProfileButtonEdits = new Map<string, StagedProfileButtonEdit>();
/**
 * DPI slots live in the active profile's stage table. The plan is edited as a
 * whole because the slot count is expressed by zeroing the stages that fall out
 * of use, so a single slot cannot be written on its own.
 */
let dpiSlotPlan: DpiStagePlan | null = null;
let dpiAxisLocks: boolean[] = [];
let editedProfile: number | "host" | null = null;

async function writeStagedProfileSector(): Promise<void> {
  const client = logitechClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  const entry = editedProfileEntry();
  if (!entry) throw new Error("No profile is open for editing.");
  const ratesStaged = isPendingChange(PROFILE_RATE_KEY);
  const buttonEdits = [...stagedProfileButtonEdits.entries()]
    .filter(([key]) => isPendingChange(key))
    .map(([, edit]) => edit);
  await client.writeActiveProfile({
    sector: entry.sector,
    bunnyHoppingMs: isPendingChange(BUNNY_HOP_KEY) ? stagedBunnyHopMs : null,
    dpiStages: isPendingChange(DPI_SLOTS_KEY) ? dpiSlotPlan : null,
    reportRateWirelessHz: ratesStaged ? stagedProfileRates.wireless : null,
    reportRateWiredHz: ratesStaged ? stagedProfileRates.wired : null,
    name: isPendingChange(PROFILE_NAME_KEY) ? stagedProfileName : null,
    buttonAssignments: buttonEdits
      .filter((edit): edit is Extract<StagedProfileButtonEdit, { kind: "assignment" }> => edit.kind === "assignment")
      .map(({ layer, button, binding }) => ({ layer, button, binding })),
    buttonMacros: buttonEdits
      .filter((edit): edit is Extract<StagedProfileButtonEdit, { kind: "macro" }> => edit.kind === "macro")
      .map(({ layer, button, steps }) => ({ layer, button, steps })),
  });
  onboardProfiles = null;
  await reloadOnboardProfiles();
}

export function editedProfileEntry(): OnboardProfile | null {
  if (editedProfile === "host" || editedProfile === null) return null;
  return onboardProfiles?.find((profile) => profile.sector === editedProfile) ?? null;
}

function editingStoredProfile(): boolean {
  return editedProfileEntry() !== null;
}

function syncEditedProfile(): void {
  if (!onboardProfiles) return;
  const stillThere = editedProfile !== "host"
    && onboardProfiles.some((profile) => profile.sector === editedProfile);
  if (stillThere) return;
  if (editedProfile === "host") return;
  editedProfile = lastDeviceMode === "Host"
    ? "host"
    : onboardProfiles.find((profile) => profile.isCurrent)?.sector ?? "host";
}

export function dpiSlotLimits(): DpiStageCapabilities | null {
  const format = lastProfileFormat;
  return format
    ? dpiStageCapabilitiesForOptions(capabilitiesForFormat(format.id).dpiStages, dpiOptions)
    : null;
}

export function dpiSlotsAvailable(): boolean {
  return editingStoredProfile() && dpiSlotLimits() !== null && dpiSlotPlan !== null;
}

/** True while the flash write sequence for stage tables is still unproven. */
export function dpiSlotsLocked(): boolean {
  return !PROFILE_DPI_WRITES_ENABLED || lastProfileFormat?.writable !== true;
}

function syncDpiSlotPlan(): void {
  const limits = dpiSlotLimits();
  const entry = editedProfileEntry();
  if (!onboardProfiles) return;
  if (!entry || !limits || entry.dpiStages.length === 0) {
    dpiSlotPlan = null;
    return;
  }
  if (isPendingChange(DPI_SLOTS_KEY)) return;
  dpiSlotPlan = {
    stages: entry.dpiStages.slice(0, limits.maxStages).map((stage) => ({ ...stage })),
    defaultIndex: Math.min(entry.defaultDpiIndex ?? 0, entry.dpiStages.length - 1),
  };
}

function deviceDpiSlotPlan(): DpiStagePlan | null {
  const entry = editedProfileEntry();
  if (!entry || entry.dpiStages.length === 0) return null;
  return {
    stages: entry.dpiStages.map((stage) => ({ ...stage })),
    defaultIndex: Math.min(entry.defaultDpiIndex ?? 0, entry.dpiStages.length - 1),
  };
}

function syncProfileDerivedState(): void {
  syncEditedProfile();
  syncDpiSlotPlan();
  reportProfileStatus();
  emit();
}

function stageDpiSlots(): void {
  if (!logitechClient() || !dpiSlotPlan) {
    emit();
    return;
  }
  const stored = deviceDpiSlotPlan();
  if (stored && JSON.stringify(stored) === JSON.stringify(dpiSlotPlan)) {
    dropPendingChange(DPI_SLOTS_KEY);
    emit();
    return;
  }

  const count = dpiSlotPlan.stages.length;
  stageChange({
    key: DPI_SLOTS_KEY,
    group: PROFILE_SECTOR_GROUP,
    label: count === 1 ? "1 DPI slot" : `${count} DPI slots`,
    command: `Write ${count} DPI slot(s) to the active profile`,
    progress: "Writing DPI slots to the profile…",
    apply: writeStagedProfileSector,
  });
  emit();
}

export function setDpiSlotCount(count: number): void {
  const limits = dpiSlotLimits();
  if (!dpiSlotPlan || !limits || dpiSlotsLocked()) return;
  const wanted = Math.min(limits.maxStages, Math.max(1, Math.round(count)));
  const stages = dpiSlotPlan.stages.slice(0, wanted);
  while (stages.length < wanted) {
    const previous = stages[stages.length - 1] ?? { x: limits.minDpi, y: limits.minDpi, lod: 2 };
    stages.push({ ...previous });
  }
  dpiSlotPlan = { stages, defaultIndex: Math.min(dpiSlotPlan.defaultIndex, stages.length - 1) };
  stageDpiSlots();
}

export function setDpiSlotAxis(index: number, axis: "x" | "y", value: number): void {
  const limits = dpiSlotLimits();
  const stage = dpiSlotPlan?.stages[index];
  if (!stage || !limits || dpiSlotsLocked()) return;
  const dpi = clampDpi(value, limits);
  stage[axis] = dpi;
  if (dpiAxisLockedAt(index)) stage[axis === "x" ? "y" : "x"] = dpi;
  stageDpiSlots();
}

export function dpiAxisLockedAt(index: number): boolean {
  return dpiAxisLocks[index] ?? true;
}

export function setDpiSlotLod(index: number, level: LiftOffLevel): void {
  const stage = dpiSlotPlan?.stages[index];
  if (!stage || dpiSlotsLocked()) return;
  stage.lod = PROFILE_STAGE_LOD[level];
  stageDpiSlots();
}

export function setDpiSlotDefault(index: number): void {
  if (!dpiSlotPlan || dpiSlotsLocked()) return;
  if (index < 0 || index >= dpiSlotPlan.stages.length) return;
  dpiSlotPlan.defaultIndex = index;
  stageDpiSlots();
}

export function setDpiAxisLock(index: number, locked: boolean): void {
  if (dpiSlotsLocked()) return;
  dpiAxisLocks = dpiAxisLocks.slice();
  dpiAxisLocks[index] = locked;
  const stage = dpiSlotPlan?.stages[index];
  if (locked && stage && stage.y !== stage.x) {
    stage.y = stage.x;
    stageDpiSlots();
    return;
  }
  emit();
}

function stagedProfileEdits(): PendingChange[] {
  return pendingChanges().filter((change) => change.group === PROFILE_SECTOR_GROUP);
}

function confirmDiscardingProfileEdits(target: number | "host"): boolean {
  const staged = stagedProfileEdits();
  if (staged.length === 0 || target === editedProfile) return true;

  const from = describeProfileEntry(editedProfileEntry()).name.replace(/ · .*$/, "");
  const to = target === "host"
    ? "Host"
    : onboardProfiles?.find((profile) => profile.sector === target)?.name ?? `Profile ${target}`;
  return window.confirm(
    `${from} has ${staged.length} change${staged.length === 1 ? "" : "s"} you have not flashed:\n\n`
    + `${staged.map((change) => `  • ${change.label}`).join("\n")}\n\n`
    + `Opening ${to} discards ${staged.length === 1 ? "it" : "them"}. Continue?`,
  );
}

export function openOnboardProfile(sector: number | "host"): void {
  if (!confirmDiscardingProfileEdits(sector)) return;
  editedProfile = sector;
  dropPendingChange(DPI_SLOTS_KEY);
  dropPendingChange(BUNNY_HOP_KEY);
  dropPendingChange(PROFILE_RATE_KEY);
  dropPendingChange(PROFILE_NAME_KEY);
  stagedBunnyHopMs = null;
  stagedProfileRates = { wireless: null, wired: null };
  stagedProfileName = null;
  dpiAxisLocks = [];
  syncDpiSlotPlan();
  emit();
}

export function toggleProfilesExpanded(): void {
  profilesExpanded = !profilesExpanded;
  emit();
}

export function describeProfileEntry(entry: OnboardProfile | null): { name: string; detail: string } {
  if (!entry) {
    return {
      name: `Host${lastDeviceMode === "Host" ? " · active" : ""}`,
      detail: "Live settings, not stored on the mouse",
    };
  }
  const dpi = entry.dpiStages.length > 0
    ? `${entry.dpiStages.length} DPI slot${entry.dpiStages.length === 1 ? "" : "s"}`
    : "no DPI slots";
  const rate = entry.reportRateWireless ? `${entry.reportRateWireless.toLocaleString()} Hz` : "—";
  return {
    name: `${entry.name ?? `Profile ${entry.sector}`}${entry.isCurrent && lastDeviceMode !== "Host" ? " · active" : ""}`,
    detail: [dpi, rate, entry.enabled ? null : "disabled"].filter(Boolean).join(" · "),
  };
}

export async function reloadOnboardProfiles(): Promise<void> {
  const client = logitechClient();
  if (!client || onboardProfilesLoading) return;
  onboardProfilesLoading = true;
  setOnboardStatus("Reading onboard profiles…");
  try {
    onboardProfiles = await client.readOnboardProfiles();
    syncProfileDerivedState();
  } catch (error) {
    recordDiagnosticError(error, "Unable to read onboard profiles.");
    setOnboardStatus(error instanceof Error ? error.message : "Unable to read onboard profiles.");
  } finally {
    onboardProfilesLoading = false;
  }
}

function reportProfileStatus(): void {
  if (!onboardProfiles) return;
  if (onboardProfiles.length === 0) {
    setOnboardStatus("This mouse reported no onboard profiles.");
    return;
  }
  if (lastProfileFormat?.verified !== true) {
    setOnboardStatus(`Profile format ${lastProfileFormat?.id ?? "?"} has not been verified on hardware — shown for reference only, and locked. Send a capture so it can be confirmed.`);
    return;
  }
  const active = onboardProfiles.find((profile) => profile.isCurrent);
  setOnboardStatus(editedProfile === "host"
    ? "Running live from software. Stored profiles are unchanged."
    : active
      ? `Running from ${active.name ?? `slot ${active.sector}`}. Profile contents are read-only for now.`
      : "Profile contents are read-only for now.");
}

export async function applyOnboardMode(mode: "Onboard" | "Host"): Promise<void> {
  const client = logitechClient();
  if (!client || refreshInProgress || settingInProgress) return;
  if (mode === "Host" && !confirmDiscardingProfileEdits("host")) return;
  settingInProgress = true;
  readStatus = `Switching to ${mode.toLowerCase()} mode…`;
  emit();
  recordDiagnosticCommand(`Set onboard mode to ${mode}`);
  try {
    await client.setOnboardMode(mode);
    if (mode === "Host") openOnboardProfile("host");
    applyStatus(await statusAfterWrite(client));
  } catch (error) {
    recordDiagnosticError(error, "Unable to change the onboard mode.");
    readStatus = error instanceof Error ? error.message : "Unable to change the onboard mode.";
  } finally {
    endDeviceWrite();
  }
}

export async function selectOnboardProfile(sector: number): Promise<void> {
  const client = logitechClient();
  if (!client || refreshInProgress || settingInProgress) return;
  if (!confirmDiscardingProfileEdits(sector)) return;
  settingInProgress = true;
  readStatus = `Switching to profile ${sector}…`;
  emit();
  recordDiagnosticCommand(`Select onboard profile ${sector}`);
  try {
    if (lastDeviceMode !== "Onboard") await client.setOnboardMode("Onboard");
    await client.setCurrentProfile(sector);
    openOnboardProfile(sector);
    applyStatus(await statusAfterWrite(client));
    await reloadOnboardProfiles();
  } catch (error) {
    recordDiagnosticError(error, "Unable to select that profile.");
    readStatus = error instanceof Error ? error.message : "Unable to select that profile.";
  } finally {
    endDeviceWrite();
  }
}

/**
 * Enabling or disabling a slot rewrites the directory sector, so it costs a
 * flash erase/write cycle and uses a write sequence not yet proven on hardware.
 * Confirm explicitly rather than treating the icon as a cheap toggle.
 */
export async function toggleOnboardProfileEnabled(sector: number, enabled: boolean): Promise<void> {
  const client = logitechClient();
  if (!client || refreshInProgress || settingInProgress) return;

  const confirmed = window.confirm(
    `${enabled ? "Enable" : "Disable"} profile ${sector}?\n\n`
    + "This writes to the mouse's flash memory — one write cycle per change. "
    + "OpenMouse has not yet verified this write sequence on hardware; G HUB can restore the profiles if anything goes wrong.",
  );
  if (!confirmed) return;

  settingInProgress = true;
  setOnboardStatus(`${enabled ? "Enabling" : "Disabling"} profile ${sector}…`);
  recordDiagnosticCommand(`${enabled ? "Enable" : "Disable"} onboard profile ${sector}`);
  try {
    await client.setProfileEnabled(sector, enabled);
    await reloadOnboardProfiles();
  } catch (error) {
    recordDiagnosticError(error, "Unable to change the profile state.");
    setOnboardStatus(error instanceof Error ? error.message : "Unable to change the profile state.");
  } finally {
    endDeviceWrite();
  }
}

export async function applyLogitechButtonAssignment(
  layer: "primary" | "g-shift",
  button: number,
  binding: LogitechButtonAction | LogitechButtonBinding,
): Promise<void> {
  const entry = editedProfileEntry();
  if (!logitechClient() || !entry || settingInProgress) return;
  const label = typeof binding === "string" ? binding : binding.kind === "keyboard" ? "keyboard shortcut" : "media key";
  const key = `${PROFILE_BUTTON_KEY_PREFIX}-${layer}-${button}`;
  stagedProfileButtonEdits.set(key, { kind: "assignment", layer, button, binding });
  stageChange({
    key,
    group: PROFILE_SECTOR_GROUP,
    label: `Button ${button + 1} ${label}`,
    command: `Map ${layer} button ${button + 1} to ${label}`,
    progress: `Assigning button ${button + 1} to ${label}…`,
    apply: writeStagedProfileSector,
  });
  setOnboardStatus(`Button ${button + 1} assignment staged.`);
}

export function applyLogitechConsumerAssignment(layer: "primary" | "g-shift", button: number, usage: number): void {
  void applyLogitechButtonAssignment(layer, button, { kind: "consumer", usage });
}

export function applyLogitechKeyboardShortcut(
  layer: "primary" | "g-shift",
  button: number,
  key: number,
  modifiers: number,
): void {
  void applyLogitechButtonAssignment(layer, button, { kind: "keyboard", key, modifiers });
}

export async function applyLogitechKeyboardSequence(
  layer: "primary" | "g-shift",
  button: number,
  steps: LogitechMacroStep[],
): Promise<void> {
  const entry = editedProfileEntry();
  if (!logitechClient() || !entry || settingInProgress || !steps.length) return;
  const key = `${PROFILE_BUTTON_KEY_PREFIX}-${layer}-${button}`;
  stagedProfileButtonEdits.set(key, { kind: "macro", layer, button, steps });
  stageChange({
    key,
    group: PROFILE_SECTOR_GROUP,
    label: `Button ${button + 1} ${steps.length}-step macro`,
    command: `Map ${layer} button ${button + 1} to a ${steps.length}-step onboard macro`,
    progress: `Saving ${steps.length}-step macro to button ${button + 1}…`,
    apply: writeStagedProfileSector,
  });
  setOnboardStatus(`Button ${button + 1} macro staged.`);
}

export function renameOnboardProfile(sector: number): void {
  const entry = onboardProfiles?.find((profile) => profile.sector === sector);
  if (!entry || !logitechClient()) return;
  const maxLength = lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).maxNameLength : null;
  if (maxLength === null) {
    setOnboardStatus("This profile format has no name field.");
    return;
  }
  if (editedProfile !== sector) openOnboardProfile(sector);

  const current = stagedProfileName ?? entry.name ?? "";
  const input = window.prompt(`Profile name (up to ${maxLength} characters)`, current);
  if (input === null) return;

  const invalid = validateProfileName(input, maxLength);
  if (invalid) {
    setOnboardStatus(invalid);
    return;
  }
  const name = input.trim();
  if (name === entry.name) {
    stagedProfileName = null;
    dropPendingChange(PROFILE_NAME_KEY);
    emit();
    return;
  }

  stagedProfileName = name;
  stageChange({
    key: PROFILE_NAME_KEY,
    group: PROFILE_SECTOR_GROUP,
    label: `Rename to "${name}"`,
    command: `Rename profile ${sector} to "${name}"`,
    progress: "Writing the profile name…",
    apply: writeStagedProfileSector,
  });
}

export async function resetLogitechProfiles(): Promise<void> {
  const client = logitechClient();
  if (!client || settingInProgress || !supportsFactoryReset(lastProfileFormat?.id)) return;

  const stagedWarning = hasPendingChanges()
    ? "\n\nYour staged, unflashed changes will also be discarded."
    : "";
  const confirmed = window.confirm(
    "Delete every onboard profile and restore Logitech defaults?\n\n"
    + "This permanently erases all stored DPI stages, polling rates, lift-off distances, button assignments, G-Shift mappings, lighting, names, timeouts and every other byte in onboard profile memory. Fresh default profiles will be written back, with profile 1 as the only enabled profile. This cannot be undone in OpenMouse."
    + stagedWarning,
  );
  if (!confirmed) return;

  settingInProgress = true;
  clearPendingChanges();
  readStatus = "Resetting every onboard profile…";
  onboardStatus = "Writing Logitech factory defaults…";
  emit();
  recordDiagnosticCommand("Reset every Logitech onboard profile to factory defaults");
  try {
    await client.resetAllOnboardProfiles();
    onboardProfiles = await client.readOnboardProfiles();
    editedProfile = onboardProfiles[0]?.sector ?? "host";
    lastDeviceMode = "Onboard";
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    applyStatus(status);
    readStatus = "All onboard profiles were reset to Logitech defaults.";
    onboardStatus = "Reset complete. Profile 1 is active; the other profiles are disabled.";
  } catch (error) {
    recordDiagnosticError(error, "Unable to reset every onboard profile.");
    const message = error instanceof Error ? error.message : "Unable to reset every onboard profile.";
    readStatus = message;
    onboardStatus = message;
    onboardProfiles = null;
    await reloadOnboardProfiles();
  } finally {
    endDeviceWrite();
  }
}

export function bunnyHopSupported(): boolean {
  return editedProfileEntry() !== null && capabilitiesForFormat(lastProfileFormat?.id).bunnyHop;
}

/**
 * Bunny hop lives in the active onboard profile, so applying it writes flash.
 * The encoding is confirmed on hardware but the write sequence is not, hence
 * the confirmation this rides on.
 */
export function applyBunnyHopMs(milliseconds: number): void {
  if (!logitechClient()) return;

  const invalid = validateBunnyHoppingMs(milliseconds);
  if (invalid) {
    setOnboardStatus(invalid);
    return;
  }

  const stored = editedProfileEntry()?.bunnyHoppingMs ?? null;
  if (stored === milliseconds) {
    stagedBunnyHopMs = null;
    dropPendingChange(BUNNY_HOP_KEY);
    emit();
    return;
  }

  stagedBunnyHopMs = milliseconds;
  stageChange({
    key: BUNNY_HOP_KEY,
    group: PROFILE_SECTOR_GROUP,
    label: milliseconds === 0 ? "Bunny hop off" : `Bunny hop ${milliseconds} ms`,
    command: `Set bunny hop to ${milliseconds} ms`,
    progress: milliseconds === 0 ? "Turning bunny hop off…" : `Setting bunny hop to ${milliseconds} ms…`,
    apply: writeStagedProfileSector,
  });
}

export { BUNNY_HOP_LIMITS };

export function profileReportRateOptions(link: "wireless" | "wired"): number[] {
  const format = lastProfileFormat;
  const rates = format ? capabilitiesForFormat(format.id).reportRates : null;
  const activeLink = latestDeviceStatus?.connectionType === "Wireless" ? "wireless" : "wired";
  return reportRatesForDevice(
    rates,
    link,
    latestDeviceStatus?.supportedPollingRates ?? [],
    activeLink,
    (format?.id ?? 6) < 6,
  );
}

export function setProfileReportRate(link: "wireless" | "wired", hz: number): void {
  const entry = editedProfileEntry();
  if (!entry || !logitechClient()) return;
  const selectedLink = (lastProfileFormat?.id ?? 6) < 6 ? "wired" : link;
  const allowed = profileReportRateOptions(selectedLink);
  if (!allowed.includes(hz)) {
    setReadStatus(`This mouse supports ${allowed.join(", ")} Hz for that profile link.`);
    return;
  }
  stagedProfileRates = { ...stagedProfileRates, [selectedLink]: hz };

  const stored = { wireless: entry.reportRateWireless, wired: entry.reportRateWired };
  const wanted = {
    wireless: stagedProfileRates.wireless ?? stored.wireless,
    wired: stagedProfileRates.wired ?? stored.wired,
  };
  if (wanted.wireless === stored.wireless && wanted.wired === stored.wired) {
    stagedProfileRates = { wireless: null, wired: null };
    dropPendingChange(PROFILE_RATE_KEY);
    emit();
    return;
  }

  stageChange({
    key: PROFILE_RATE_KEY,
    group: PROFILE_SECTOR_GROUP,
    label: `${selectedLink === "wired" && (lastProfileFormat?.id ?? 6) >= 6 ? "Wired " : selectedLink === "wireless" ? "Wireless " : ""}${hz.toLocaleString()} Hz`,
    command: `Set profile ${selectedLink} report rate to ${hz} Hz`,
    progress: "Writing the report rate to the profile…",
    apply: writeStagedProfileSector,
  });
}

export function applyPollingRate(rate: number): void {
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

export function applyLiftOffDistance(lod: LiftOffLevel): void {
  if (!hasActiveClient()) return;
  stageChange({
    key: "lift-off-distance",
    label: `${lod} lift-off`,
    command: `Set lift-off distance to ${lod}`,
    progress: `Setting ${lod.toLowerCase()} lift-off distance…`,
    preview: (status) => {
      status.liftOffDistance = lod;
      if (status.asymmetricLiftOff) status.asymmetricLiftOff = { ...status.asymmetricLiftOff, enabled: false };
    },
    apply: async () => {
      await requireClientMethod("setLiftOffDistance", "the lift-off distance").setLiftOffDistance(lod);
    },
  });
}

export function applyLiftOffMode(mode: "single" | "asymmetric"): void {
  if (!latestDeviceStatus) return;
  const status = withPendingChanges(latestDeviceStatus);
  const pair = status.asymmetricLiftOff;
  if (!pair) return;
  if (mode === "asymmetric") applyAsymmetricLiftOff(pair.liftOff, pair.landing);
  else applyLiftOffDistance(status.liftOffDistance ?? "Medium");
}

export function applyAsymmetricLiftOff(liftOff: number, requested: number): void {
  if (!hasActiveClient()) return;
  const landing = Math.min(requested, liftOff - 1);
  stageChange({
    key: "lift-off-distance",
    label: `Lift-off ${liftOff} / landing ${landing}`,
    command: `Set lift-off to ${liftOff} and landing to ${landing}`,
    progress: `Setting lift-off ${liftOff} and landing ${landing}…`,
    preview: (status) => {
      if (!status.asymmetricLiftOff) return;
      status.asymmetricLiftOff = { ...status.asymmetricLiftOff, enabled: true, liftOff, landing };
    },
    apply: async () => {
      await requireClientMethod("setLiftOff", "the lift-off distance").setLiftOff(liftOff, landing);
    },
  });
}

/**
 * Gaming surface and LightForce are two fields of one 0x8090 byte, so they are
 * staged as a group and written together. Each apply sends the whole group's
 * staged state; whichever runs is the last one staged.
 */
const MODE_STATUS_GROUP = "logitech-mode-status";
let stagedGamingSurface: MouseStatus["gamingSurfaceMode"] = null;
let stagedLightforce: MouseStatus["lightforceSwitchMode"] = null;

async function writeStagedModeStatus(): Promise<void> {
  const client = logitechClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  await client.setModeStatus({
    gamingSurface: stagedGamingSurface,
    lightforce: stagedLightforce,
  });
}

export function applyGamingSurfaceMode(mode: NonNullable<MouseStatus["gamingSurfaceMode"]>): void {
  if (!logitechClient()) return;
  stagedGamingSurface = mode;
  stageChange({
    key: "gaming-surface",
    group: MODE_STATUS_GROUP,
    label: `Gaming surface ${mode.toLowerCase()}`,
    command: `Set gaming surface to ${mode}`,
    progress: `Setting gaming surface to ${mode.toLowerCase()}…`,
    preview: (status) => { status.gamingSurfaceMode = mode; },
    apply: writeStagedModeStatus,
  });
}

export function applyLightforceSwitchMode(mode: NonNullable<MouseStatus["lightforceSwitchMode"]>): void {
  if (!logitechClient()) return;
  stagedLightforce = mode;
  stageChange({
    key: "lightforce-switch-mode",
    group: MODE_STATUS_GROUP,
    label: `LightForce ${mode.toLowerCase()}`,
    command: `Set LightForce switches to ${mode}`,
    progress: `Setting LightForce switches to ${mode.toLowerCase()}…`,
    preview: (status) => { status.lightforceSwitchMode = mode; },
    apply: writeStagedModeStatus,
  });
}

export function toggleDongleLed(): void {
  if (!pulsarClient()) return;
  const enabled = withPendingChanges(latestDeviceStatus!).dongleLedEnabled !== true;
  stageChange({
    key: "dongle-led",
    label: `Receiver LED ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} receiver LED`,
    progress: `${enabled ? "Enabling" : "Disabling"} the receiver LED…`,
    preview: (status) => {
      status.dongleLedEnabled = enabled;
    },
    apply: async () => {
      const client = pulsarClient();
      if (!client) throw new Error("The receiver is no longer connected.");
      if (!("setDongleLed" in client)) {
        throw new Error("This Pulsar device does not expose a receiver LED control.");
      }
      await client.setDongleLed(enabled);
    },
  });
}

function settingLabel(setting: PulsarToggleSetting): string {
  return ({
    motionSync: "Motion Sync",
    angleSnapping: "angle snapping",
    rippleControl: "ripple control",
    performanceMode: teevolutionClient() ? "highest performance" : "performance mode",
    hyperMode: "Hyper mode",
  } as const)[setting];
}

const PULSAR_TOGGLE_METHOD: Record<PulsarToggleSetting, string> = {
  motionSync: "setMotionSync",
  angleSnapping: "setAngleSnapping",
  rippleControl: "setRippleControl",
  performanceMode: "setPerformanceMode",
  hyperMode: "setHyperMode",
};

export function applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): void {
  if (!hasActiveClient()) return;
  const label = settingLabel(setting);
  const method = PULSAR_TOGGLE_METHOD[setting];
  stageChange({
    key: setting,
    label: `${label} ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} ${label}`,
    progress: `${enabled ? "Enabling" : "Disabling"} ${label}…`,
    preview: (status) => {
      status[setting] = enabled;
    },
    apply: () => callClientMethod(method, label, enabled),
  });
}

export function applyPulsarValue(setting: "debounce" | "sleep", value: number): void {
  if (!(pulsarClient() ?? dmClient() ?? orbitalClient() ?? razerClient()
    ?? viperClient() ?? teevolutionClient() ?? vgnClient() ?? keychronClient() ?? wallhackMouseClient())) return;
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
      else status.sleepTimeout = asleep ? value : null;
    },
    apply: async () => {
      if (setting === "debounce") await requireClientMethod("setDebounceTime", "the debounce time").setDebounceTime(value);
      else await requireClientMethod("setSleepTimeout", "auto sleep").setSleepTimeout(value);
    },
  });
}

export function toggleSleep(enabled: boolean): void {
  applyPulsarValue("sleep", enabled ? lastSleepSeconds : WLMOUSE_SLEEP_NEVER);
}

export function applyLowPowerThreshold(percent: number): void {
  if (!razerClient()) return;
  stageChange({
    key: "low-power",
    label: `Low power below ${percent}%`,
    command: `Set low power mode to ${percent}%`,
    progress: "Setting low power mode…",
    preview: (status) => {
      status.lowBatteryWarning = percent;
    },
    apply: async () => {
      await requireClientMethod("setLowPowerThreshold", "low power mode").setLowPowerThreshold(percent);
    },
  });
}

/**
 * Only the base `RazerHidClient` carries the class `0x02` button commands —
 * the Viper Mini, Viper and Cobra siblings claim their own single product ids
 * and have never been checked against it.
 */
function razerButtonClient(): RazerHidClient | null {
  return activeAs<RazerHidClient>(RazerHidClient);
}

export function applyRazerButtonMapping(control: RazerButtonControl, mapping: RazerButtonMapping): void {
  if (!razerButtonClient()) return;
  stageChange({
    key: `razer-button-${control}`,
    label: `${RAZER_BUTTON_CONTROL_LABEL[control]} → ${mapping}`,
    command: `Change ${RAZER_BUTTON_CONTROL_LABEL[control]} mapping`,
    progress: `Changing ${RAZER_BUTTON_CONTROL_LABEL[control]} mapping…`,
    preview: (status) => {
      if (status.razerButtonMappings) status.razerButtonMappings[control] = mapping;
    },
    apply: async () => {
      const client = razerButtonClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await client.setButtonMapping(control, mapping);
    },
  });
}

export function applyRazerToggleControl(control: RazerToggleControl, label: string): void {
  if (!razerButtonClient()) return;
  const name = RAZER_TOGGLE_CONTROL_INFO[control].label;
  stageChange({
    key: `razer-toggle-${control}`,
    label: `${name} → ${label}`,
    command: `Change ${name}`,
    progress: `Changing ${name}…`,
    preview: (status) => {
      if (status.razerButtonMappings) status.razerButtonMappings[control] = label;
    },
    apply: async () => {
      const client = razerButtonClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await client.setToggleControl(control, label);
    },
  });
}

export function describeLighting(lighting: MouseLighting): string {
  if (!lighting.mode) return "No effect";
  const parts: string[] = [lighting.mode];
  if (lighting.colorModes.includes(lighting.mode) && lighting.color) parts.push(lighting.color.toUpperCase());
  if (lighting.dualColorModes.includes(lighting.mode) && lighting.color2) parts.push(lighting.color2.toUpperCase());
  if (lighting.reactiveModes.includes(lighting.mode) && lighting.speed !== null) parts.push(`speed ${lighting.speed}`);
  if (lighting.brightness != null) parts.push(`${lighting.brightness}%`);
  return parts.join(" · ");
}

export function applyLighting(
  patch: Partial<Pick<MouseLighting, "mode" | "color" | "color2" | "speed" | "brightness">>,
  zoneIndex = 0,
): void {
  const deviceStatus = latestDeviceStatus;
  const source = deviceStatus?.lightingZones?.[zoneIndex] ?? (zoneIndex === 0 ? deviceStatus?.lighting : undefined);
  if (!hasActiveClient() || !deviceStatus || !source) {
    setReadStatus("Lighting is not available for this mouse.");
    return;
  }
  const pendingStatus = withPendingChanges(deviceStatus);
  const stagedSource = pendingStatus.lightingZones?.[zoneIndex] ?? pendingStatus.lighting!;
  const staged = { ...stagedSource, ...patch } as MouseLighting;
  if (!staged.mode) {
    setReadStatus("Pick an effect first.");
    return;
  }
  stageChange({
    key: `lighting-${zoneIndex}`,
    label: `${staged.zone} lighting ${staged.mode.toLowerCase()}`,
    command: `Set ${staged.zone} lighting to ${describeLighting(staged)}`,
    progress: `Setting ${staged.mode.toLowerCase()} lighting…`,
    preview: (status) => {
      if (status.lightingZones?.[zoneIndex]) status.lightingZones[zoneIndex] = { ...staged };
      if (zoneIndex === 0 && status.lighting) status.lighting = { ...status.lighting, ...staged } as MouseLighting;
    },
    apply: async () => {
      await requireClientMethod("setLighting", "the lighting").setLighting(staged);
    },
  });
}

export function applyNinjutsoSetting(
  setting: "system" | "hyper" | "optical" | "slam",
  value: string | boolean,
): void {
  if (!hasActiveClient() || latestDeviceStatus?.brand !== "Ninjutso") return;
  const config = {
    system: ["ninjutso-system", "System mode", "ninjutsoSystemMode", "setNinjutsoSystemMode"],
    hyper: ["ninjutso-hyper", "HyperClick", "ninjutsoHyperClick", "setNinjutsoHyperClick"],
    optical: ["ninjutso-optical", "Optical Engine", "ninjutsoOpticalEngine", "setNinjutsoOpticalEngine"],
    slam: ["ninjutso-slam", "Slam-Click", "ninjutsoSlamClick", "setNinjutsoSlamClick"],
  }[setting]!;
  const [key, label, field, method] = config;
  stageChange({
    key,
    label: `${label} ${String(value)}`,
    command: `Set ${label} to ${String(value)}`,
    progress: `Setting ${label}…`,
    preview: (status) => { (status as unknown as Record<string, unknown>)[field] = value; },
    apply: () => callClientMethod(method, label, value),
  });
}

export function applyTeevolutionSensorMode(mode: NonNullable<MouseStatus["sensorMode"]>): void {
  if (!teevolutionClient()) return;
  stageChange({
    key: "teevolution-sensor-mode",
    label: `Sensor mode ${mode}`,
    command: `Set sensor mode to ${mode}`,
    progress: `Setting sensor mode to ${mode}…`,
    preview: (status) => {
      status.sensorMode = mode;
      status.sensorModeStored = mode === "High" ? 1 : 0;
    },
    apply: async () => {
      await requireClientMethod("setSensorMode", "sensor mode").setSensorMode(mode);
    },
  });
}

export function applyTeevolutionPerformanceDuration(duration: number): void {
  if (!teevolutionClient()) return;
  const label = sleepLabel(duration * 10);
  stageChange({
    key: "teevolution-performance-duration",
    label: `Highest performance ${label}`,
    command: `Set highest-performance duration to ${label}`,
    progress: "Setting highest-performance duration…",
    preview: (status) => {
      status.performanceDuration = duration;
    },
    apply: async () => {
      await requireClientMethod("setPerformanceDuration", "highest-performance duration").setPerformanceDuration(duration);
    },
  });
}

const TEEVOLUTION_DPI_LIGHT_GROUP = "teevolution-dpi-lighting";

async function writeStagedTeevolutionDpiLighting(): Promise<void> {
  const client = teevolutionClient();
  if (!client || !latestDeviceStatus) {
    throw new Error("The Teevolution mouse is no longer connected.");
  }
  const status = withPendingChanges(latestDeviceStatus);
  await client.setDpiLighting(
    status.dpiLedMode ?? 0,
    status.dpiLedBrightness ?? 5,
    status.dpiLedSpeed ?? 3,
  );
}

export function applyTeevolutionDpiLighting(setting: "mode" | "brightness" | "speed", value: number): void {
  if (!teevolutionClient()) return;
  const names = { mode: "effect", brightness: "brightness", speed: "speed" } as const;
  const display = setting === "mode" ? (["Off", "Steady", "Breathing"][value] ?? `${value}`) : `${value}`;
  stageChange({
    key: `teevolution-dpi-light-${setting}`,
    group: TEEVOLUTION_DPI_LIGHT_GROUP,
    label: `DPI light ${names[setting]} ${display}`,
    command: `Set DPI light ${names[setting]} to ${display}`,
    progress: `Setting DPI light ${names[setting]}…`,
    preview: (status) => {
      if (setting === "mode") status.dpiLedMode = value;
      if (setting === "brightness") status.dpiLedBrightness = value;
      if (setting === "speed") status.dpiLedSpeed = value;
    },
    apply: writeStagedTeevolutionDpiLighting,
  });
}

export function applyEggFilter(setting: "slamclick" | "motionJitter", enabled: boolean): void {
  if (!eggClient()) return;
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
      const client = eggClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      if (setting === "slamclick") await client.setSlamclickFilter(enabled);
      else await client.setMotionJitterFilter(enabled);
    },
  });
}

export function applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): void {
  if (!eggClient()) return;
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
      const client = eggClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await client.setSpdtMode(button, mode);
    },
  });
}

function stageEggChange(options: {
  key: string;
  label: string;
  what: string;
  preview: PendingChange["preview"];
  change: (client: EggOp1HidClient) => Promise<void>;
}): void {
  if (!eggClient()) return;
  stageChange({
    key: options.key,
    label: options.label,
    command: `Change ${options.what}`,
    progress: `Changing ${options.what}…`,
    preview: options.preview,
    apply: async () => {
      const client = eggClient();
      if (!client) throw new Error("The mouse is no longer connected.");
      await options.change(client);
    },
  });
}

export function applyEggCpiLevels(levels: number): void {
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

export function applyEggCpiStage(level: number, x: number, y: number): void {
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

export function setEggPollingDivider(divider: number | null): void {
  eggPollingDivider = divider;
  emit();
}

export function applyEggPollingDivider(divider: number): void {
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

export function applyEggMulticlick(button: EggButtonIndex, value: number): void {
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

export function applyEggButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): void {
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

export function applyProSetting(
  setting: "wheelAcceleration" | "angleTuning" | "profile",
  value: boolean | number,
): void {
  if (!(pulsarClient() instanceof PulsarProHidClient)) return;
  const what = setting === "wheelAcceleration"
    ? "wheel acceleration"
    : setting === "angleTuning" ? "angle tuning" : "onboard profile";
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
      const client = pulsarClient();
      if (!(client instanceof PulsarProHidClient)) throw new Error("The mouse is no longer connected.");
      if (setting === "wheelAcceleration") await client.setWheelAcceleration(Boolean(value));
      if (setting === "angleTuning") await client.setAngleTuning(Number(value));
      if (setting === "profile") await client.setProfile(Number(value));
    },
  });
}

const FINALMOUSE_SETTINGS = {
  dongleLed: ["finalmouse-dongle-led", "dongle LED mode", "finalmouseDongleLedMode", "setDongleLedMode"],
  tournamentScroll: ["finalmouse-tournament-scroll", "tournament scroll mode", "finalmouseTournamentScrollMode", "setTournamentScrollMode"],
  tournamentTimeout: ["finalmouse-tournament-timeout", "tournament scroll timeout", "finalmouseTournamentScrollTimeoutMs", "setTournamentScrollTimeout"],
} as const;

export function applyFinalmouseSetting(
  setting: keyof typeof FINALMOUSE_SETTINGS,
  value: number,
): void {
  if (!finalmouseClient()) return;
  const [key, label, field, method] = FINALMOUSE_SETTINGS[setting];
  stageChange({
    key,
    label: `Finalmouse ${label}`,
    command: `Change Finalmouse ${label}`,
    progress: `Changing Finalmouse ${label}…`,
    preview: (status) => { (status as unknown as Record<string, unknown>)[field] = value; },
    apply: () => callClientMethod(method, label, value),
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
  if (!client || refreshInProgress || settingInProgress || activationInProgress) return;
  if ("pollIntervalMs" in client && Number((client as { pollIntervalMs: number }).pollIntervalMs) <= 0) return;
  refreshInProgress = true;
  markHidActivity(BACKGROUND, { transient: true });
  try {
    const dm = dmClient();
    const status = dm && client === dm ? await dm.readStatus(true) : await client.readStatus();
    const currentClient = activeSettingsClient();
    if (client !== currentClient || client.device !== activeDevice) return;
    const key = JSON.stringify(status);
    if (key !== lastRenderedStatusKey) applyStatus(status, key);
  } catch (error) {
    lastRenderedStatusKey = null;
    deviceStatusText = "Waiting to refresh";
    readStatus = error instanceof Error ? error.message : "Unable to refresh the mouse status.";
    emit();
  } finally {
    refreshInProgress = false;
  }
}

async function loadPreviewEntries(): Promise<void> {
  if (!previewModeEnabled || previewEntries.length > 0) return;
  const { PREVIEW_FIXTURES } = await import("../preview-fixtures");
  previewEntries = [
    ["slots", "Logitech G502 X PLUS"],
    ["superstrike", "Logitech PRO X 2 Superstrike"],
    ...Object.entries(PREVIEW_FIXTURES).map(([key, fixture]) => [key, fixture.label] as [string, string]),
  ];
  emit();
}

function previewClient(): LogitechHidppClient {
  const refuse = async (): Promise<never> => {
    throw new Error("Preview mode: no mouse is connected, so nothing was written.");
  };
  // Real prototype: the driver accessors test with instanceof.
  return Object.assign(Object.create(LogitechHidppClient.prototype) as LogitechHidppClient, {
    writeActiveProfile: async () => undefined,
    setBunnyHoppingMs: refuse,
    setProfileDpiStages: refuse,
    setModeStatus: refuse,
    readOnboardProfiles: async () => onboardProfiles ?? [],
  });
}

function showSlotsPreview(): void {
  dpiOptions = [100, 200, 400, 800, 1600, 3200, 6400, 8000, 16000, 32000];
  const stages = [
    { x: 800, y: 800, lod: 1 },
    { x: 1200, y: 1200, lod: 2 },
    { x: 1600, y: 1600, lod: 2 },
    { x: 2400, y: 2400, lod: 2 },
    { x: 3200, y: 3200, lod: 3 },
  ];
  const normalActions = ["Left click", "Right click", "Middle click", "Back", "Forward", "DPI Shift", "Next DPI", "Cycle profiles"] as const;
  const shiftedActions = ["Previous profile", "Next profile", "Battery indicator", "Tilt left", "Tilt right", "Default DPI", "Previous DPI", "Disabled"] as const;
  onboardProfiles = [1, 2, 3].map((index) => ({
    sector: index,
    enabled: index !== 3,
    isCurrent: index === 1,
    name: `Profile ${index}`,
    dpiStages: stages.slice(0, index === 1 ? 5 : 2),
    defaultDpiIndex: 0,
    reportRateWireless: 8000,
    reportRateWired: 1000,
    angleSnapping: false,
    powerSaveTimeoutSeconds: 60,
    powerOffTimeoutSeconds: 300,
    bunnyHoppingMs: 100,
    buttonAssignments: normalActions.map((action, button) => ({ button, action, raw: [0x90, 0, 0, 0] })),
    gShiftAssignments: shiftedActions.map((action, button) => ({ button, action, raw: [0x90, 0, 0, 0] })),
    crcValid: true,
    raw: new Uint8Array(255),
  } as OnboardProfile));
  active = previewClient();
  applyStatus({
    brand: "Logitech",
    name: "G502 X PLUS",
    ui: { family: "logitech-hidpp", lodRequiresSurface: true },
    batteryPercent: 72,
    batteryState: "Discharging",
    dpi: 800,
    dpiY: 800,
    supportsSeparateDpiAxes: true,
    pollingRateHz: 8000,
    supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
    liftOffDistance: "Low",
    supportedLiftOffDistances: ["Low", "Medium", "High"],
    onboardProfileFormat: { id: 7, name: "unnamed (v6 + bunny hopping)", base: "v6", supported: true, verified: true, writable: true },
    gamingSurfaceMode: "Auto",
    lightforceSwitchMode: "Hybrid",
    lighting: {
      zone: "Combined", modes: ["Off", "Static", "Cycling", "Wave", "Breathing single"], mode: "Static",
      color: "#7c5cff", color2: null, colorModes: ["Static", "Breathing single"], dualColorModes: [],
      reactiveModes: ["Cycling", "Wave", "Breathing single"], speeds: [1000, 2000, 3000, 5000, 10000], speed: 5000,
      writeOnly: true,
    },
    lightingZones: [
      {
        zone: "Combined", modes: ["Off", "Static", "Cycling", "Wave", "Breathing single"], mode: "Static",
        color: "#7c5cff", color2: null, colorModes: ["Static", "Breathing single"], dualColorModes: [],
        reactiveModes: ["Cycling", "Wave", "Breathing single"], speeds: [1000, 2000, 3000, 5000, 10000], speed: 5000,
        writeOnly: true,
      },
      ...["#7c5cff", "#5f78ff", "#39a7ff", "#2bc8d4", "#35d59a", "#a0dc55", "#f0c247", "#ff744f"].map((color, index) => ({
        zone: `LED ${index + 1}`,
        group: "Lightstrip",
        hardwareZoneId: index + 1,
        modes: ["Off", "Static"] as const,
        mode: "Static" as const,
        color,
        color2: null,
        colorModes: ["Static"] as const,
        dualColorModes: [] as const,
        reactiveModes: [] as const,
        speeds: [] as const,
        speed: null,
        writeOnly: true,
      })),
    ],
    activeProfile: 1,
    deviceMode: "Onboard",
    connectionType: "Wireless",
    firmware: ["MPM 39.00.B0004"],
  });
  setConnectionButtons(true, "Preview mode");
  setReadStatus("Preview: G502 X PLUS performance, onboard profiles, button remapping and RGB lighting.");
}

function showSuperstrikePreview(): void {
  dpiOptions = [100, 200, 400, 800, 1600, 3200, 6400, 8000, 16000, 32000];
  applyStatus({
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
  });
  setConnectionButtons(true, "Preview mode");
  setReadStatus("Current: 800 DPI · 4,000 Hz");
}

function showG703PreviewProfiles(): void {
  const actions = ["Left click", "Right click", "Middle click", "Back", "Forward", "DPI Shift", "Next DPI"] as const;
  const currentStages = [450, 800, 1600, 12000].map((dpi) => ({ x: dpi, y: dpi, lod: 0 }));
  onboardProfiles = [1, 2, 3].map((index) => ({
    sector: index,
    enabled: true,
    isCurrent: index === 3,
    name: `Profile ${index}`,
    dpiStages: index === 3 ? currentStages : currentStages.slice(0, 2),
    defaultDpiIndex: 0,
    reportRateWireless: 1000,
    reportRateWired: 1000,
    angleSnapping: false,
    powerSaveTimeoutSeconds: 60,
    powerOffTimeoutSeconds: 300,
    bunnyHoppingMs: null,
    buttonAssignments: actions.map((action, button) => ({ button, action, raw: [0x80, 0, 0, 0] })),
    gShiftAssignments: actions.map((action, button) => ({ button, action, raw: [0x80, 0, 0, 0] })),
    crcValid: true,
    raw: new Uint8Array(255),
  } as OnboardProfile));
  dpiOptions = [50, 100, 200, 400, 450, 800, 1600, 3200, 6400, 12000];
  active = previewClient();
}

async function showFixturePreview(name: PreviewMode): Promise<void> {
  const { PREVIEW_FIXTURES } = await import("../preview-fixtures");
  await loadPreviewEntries();
  const fixture = name === "list" || name === "slots" || name === "superstrike"
    ? undefined
    : PREVIEW_FIXTURES[name];
  if (!fixture) {
    previewListMessage = name === "list" ? "Pick a driver preview." : `Unknown preview "${name}".`;
    setReadStatus(previewListMessage);
    return;
  }
  dpiOptions = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 32000];
  if (name === "g703") showG703PreviewProfiles();
  // Populate brand capabilities so preview cards that gate on capabilities still render.
  capabilities = readCapabilities();
  applyStatus(fixture.status);
  setConnectionButtons(true, "Preview mode");
  setReadStatus(`Preview: ${fixture.label}. Nothing is written.`);
}

export function start(): void {
  startHidCapture();
  onPendingChanges(() => {
    if (!isPendingChange(BUNNY_HOP_KEY)) stagedBunnyHopMs = null;
    if (!isPendingChange(PROFILE_RATE_KEY)) stagedProfileRates = { wireless: null, wired: null };
    if (!isPendingChange(PROFILE_NAME_KEY)) stagedProfileName = null;
    // A remap dropped from the pending bar (reverted, or the group flashed)
    // must leave the side map, or its select stays on the staged value and a
    // later flash would write a mapping the user took back.
    for (const controlId of stagedButtonMappings.keys()) {
      if (!isPendingChange(`button-${controlId}`)) stagedButtonMappings.delete(controlId);
    }
    if (!isPendingChange(DPI_SLOTS_KEY)) {
      syncDpiSlotPlan();
    }
    if (!isPendingChange("gaming-surface")) stagedGamingSurface = null;
    if (!isPendingChange("lightforce-switch-mode")) stagedLightforce = null;
    if (!isPendingChange("haptic-strength")) stagedHapticIntensity = null;
    if (!isPendingChange("haptic-enabled")) stagedHapticEnabled = null;
    if (!isPendingChange("haptic-battery-saving")) stagedHapticBatterySaving = null;
    if (!isPendingChange("wheel-mode")) stagedWheelMode = null;
    if (!isPendingChange("smart-shift")) stagedSmartShift = undefined;
    if (!isPendingChange("hi-res-scroll")) stagedHiRes = null;
    if (!isPendingChange("invert-scroll")) stagedInvertScroll = null;
    emit();
  });

  if (previewMode === "superstrike") showSuperstrikePreview();
  else if (previewMode === "slots") showSlotsPreview();
  else if (previewMode !== null) void showFixturePreview(previewMode);

  if (!isAnyPreview) {
    navigator.hid?.addEventListener("connect", handleHidConnect);
    navigator.hid?.addEventListener("disconnect", handleHidDisconnect);
    void reconnectAuthorizedDevice();
  }

  window.addEventListener("beforeunload", (event) => {
    if (hasPendingChanges()) event.preventDefault();
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    navigator.hid?.removeEventListener("connect", handleHidConnect);
    navigator.hid?.removeEventListener("disconnect", handleHidDisconnect);
    void active?.close();
  });
}
