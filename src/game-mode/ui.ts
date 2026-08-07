import { captureGameModeRecipe, computeDeviceKey, type PollingRateClient } from "./capture";
import { buildFingerprint } from "./fingerprint";
import type { DeviceStatus, StatusMessage, UpdateStatusMessage } from "./types";
import { GameModeClient, type ConnectionState } from "./ws-client";
import type { MouseStatus } from "../devices/mouse-types";
import { RATE_STEPS_HZ, previewRateSlider, rateFromSlider, renderRateSlider } from "../ui/rate-slider";

const DEFAULT_IDLE_HZ = 1000;
const DEFAULT_GAMING_HZ = 4000;

let latestStatusMessage: StatusMessage | null = null;
let currentDeviceKey: string | null = null;
let currentRates: number[] = RATE_STEPS_HZ;
let idleRateHz = DEFAULT_IDLE_HZ;
let gamingRateHz = DEFAULT_GAMING_HZ;
let companionState: ConnectionState = "disconnected";
let deviceReady = false; // a supported device is connected on the control page
let capturing = false;
let updateStatus: UpdateStatusMessage | null = null;
let checkedServiceVersion: string | null = null;

const client = new GameModeClient({
  onStateChange: (state) => { companionState = state; if (state !== "connected") currentDeviceKey = null; render(); },
  onStatus: (status) => {
    latestStatusMessage = status;
    applyStoredRatesIfKnown();
    render();
    if (checkedServiceVersion !== status.serviceVersion) {
      checkedServiceVersion = status.serviceVersion;
      client.checkForUpdates();
    }
  },
  onUpdateStatus: (status) => { updateStatus = status; render(); },
  onEnrollResult: (ok, deviceKey) => {
    if (deviceKey !== currentDeviceKey) return;
    capturing = false;
    if (!ok) setToggleChecked(false);
    render();
  },
});

/** Called once at startup, independent of any device being connected yet. */
export function initGameMode(): void {
  document.querySelector<HTMLButtonElement>("#game-mode-toggle")?.addEventListener("click", () => void onToggleClick());
  document.querySelector<HTMLButtonElement>("#background-service-update")?.addEventListener("click", onUpdateClick);
  document.querySelector<HTMLButtonElement>("#background-service-open-logs")?.addEventListener("click", () => client.openServicePath("logs"));
  document.querySelector<HTMLButtonElement>("#background-service-open-game-list")?.addEventListener("click", () => client.openServicePath("gameList"));
  bindPreferenceCheckbox("#service-detection-enabled", "detectionEnabled");
  bindPreferenceCheckbox("#service-start-with-windows", "startWithWindows");
  bindPreferenceCheckbox("#service-notifications-enabled", "notificationsEnabled");

  bindSlider("#game-mode-idle-slider", (hz) => { idleRateHz = hz; void reapplyIfEnabled(); });
  bindSlider("#game-mode-gaming-slider", (hz) => { gamingRateHz = hz; void reapplyIfEnabled(); });

  client.connect();
}

function bindPreferenceCheckbox(
  selector: string,
  key: "detectionEnabled" | "startWithWindows" | "notificationsEnabled",
): void {
  document.querySelector<HTMLInputElement>(selector)?.addEventListener("change", (event) => {
    client.setServicePreferences({ [key]: (event.target as HTMLInputElement).checked });
  });
}

function bindSlider(selector: string, onCommit: (hz: number) => void): void {
  const root = document.querySelector<HTMLElement>(selector);
  root?.addEventListener("input", (event) => {
    previewRateSlider(selector, Number((event.target as HTMLInputElement).value));
  });
  root?.addEventListener("change", (event) => {
    const hz = rateFromSlider(selector, Number((event.target as HTMLInputElement).value));
    if (hz !== null) onCommit(hz);
  });
}

/** Called from control.ts's showStatus() whenever the active device/status changes. supported comes from support.ts's isGameModeSupported() against the real SupportedClient union, which this module intentionally doesn't import (it only needs the narrower PollingRateClient shape). */
export function refreshGameModeCard(status: MouseStatus, supported: boolean, device: HIDDevice | null): void {
  deviceReady = supported && device !== null;

  if (!deviceReady || !device) {
    currentDeviceKey = null;
    currentRates = RATE_STEPS_HZ;
    render();
    return;
  }

  currentRates = (status.supportedPollingRates?.length ? status.supportedPollingRates : RATE_STEPS_HZ).slice().sort((a, b) => a - b);

  void computeDeviceKey(device.vendorId, device.productId, buildFingerprint(device)).then((key) => {
    currentDeviceKey = key;
    applyStoredRatesIfKnown();
    render();
  });

  render();
}

/** Once a deviceKey and the paired-device list are both known, adopt any already-saved rates instead of the defaults. */
function applyStoredRatesIfKnown(): void {
  const entry = currentDeviceKey ? findDeviceEntry(currentDeviceKey) : undefined;
  if (!entry) return;
  setToggleChecked(entry.gameModeEnabled);
  if (entry.idleRateHz) idleRateHz = entry.idleRateHz;
  if (entry.gamingRateHz) gamingRateHz = entry.gamingRateHz;
}

function findDeviceEntry(deviceKey: string): DeviceStatus | undefined {
  return latestStatusMessage?.devices.find((d) => d.deviceKey === deviceKey);
}

const BADGE_TEXT: Record<ConnectionState, string> = {
  disconnected: "DISCONNECTED",
  connecting: "CONNECTING",
  denied: "BLOCKED",
  connected: "CONNECTED",
};

/** Renders the whole Game Mode section from current module state: connection status, both sliders, and the toggle. */
function render(): void {
  const badge = document.querySelector<HTMLElement>("#background-service-badge");
  if (badge) {
    badge.textContent = BADGE_TEXT[companionState];
    badge.className = `background-service-badge is-${companionState}`;
  }

  const connected = companionState === "connected";
  const setup = document.querySelector<HTMLElement>("#background-service-setup");
  const connectedContent = document.querySelector<HTMLElement>("#background-service-connected");
  if (setup) setup.hidden = connected;
  if (connectedContent) connectedContent.hidden = !connected;

  const version = document.querySelector<HTMLElement>("#background-service-version");
  if (version) version.textContent = latestStatusMessage?.serviceVersion ? `v${latestStatusMessage.serviceVersion}` : "";

  setCheckbox("#service-detection-enabled", latestStatusMessage?.detectionEnabled ?? false, !connected);
  setCheckbox("#service-start-with-windows", latestStatusMessage?.startWithWindows ?? false, !connected);
  setCheckbox("#service-notifications-enabled", latestStatusMessage?.notificationsEnabled ?? false, !connected);

  const pairedDeviceCount = latestStatusMessage?.devices.length ?? 0;
  const accessState = document.querySelector<HTMLElement>("#service-paired-device-count");
  if (accessState) accessState.textContent = pairedDeviceCount === 0 ? "NONE" : `${pairedDeviceCount} PAIRED`;
  renderUpdateStatus();

  const ready = connected && deviceReady;

  renderRateSlider(document.querySelector<HTMLElement>("#game-mode-idle-slider"), currentRates, idleRateHz, { label: "Idle rate", disabled: !ready });
  renderRateSlider(document.querySelector<HTMLElement>("#game-mode-gaming-slider"), currentRates, gamingRateHz, { label: "Gaming rate", disabled: !ready });

  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");
  if (toggle) toggle.disabled = !ready || capturing;

  const status = document.querySelector<HTMLElement>("#game-mode-status");
  if (status) status.textContent = statusNote();
}

function statusNote(): string {
  if (companionState === "connecting") return "Connecting to Background Service…";
  if (companionState === "denied") return "Connection blocked. Approve OpenMouse Background Service in its tray popup, then reload this page.";
  if (companionState === "disconnected") return "Complete the steps above, then reload this page.";
  if (latestStatusMessage && !latestStatusMessage.detectionEnabled) return "App detection is paused above.";
  if (!deviceReady) return "Connect a supported mouse to enable Game Mode.";
  return "";
}

function setCheckbox(selector: string, checked: boolean, disabled: boolean): void {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) return;
  input.checked = checked;
  input.disabled = disabled;
}

function renderUpdateStatus(): void {
  const badge = document.querySelector<HTMLElement>("#background-service-update-badge");
  const button = document.querySelector<HTMLButtonElement>("#background-service-update");
  if (!badge || !button) return;

  const state = updateStatus?.state ?? "checking";
  const labels = {
    checking: ["CHECKING", "is-checking", "Checking…"],
    upToDate: ["UP TO DATE", "is-current", "Check for updates"],
    updateAvailable: ["UPDATE AVAILABLE", "is-update", `Install v${updateStatus?.latestVersion ?? ""}`],
    downloading: ["DOWNLOADING", "is-checking", "Downloading…"],
    installing: ["INSTALLING", "is-checking", "Installing…"],
    error: ["CHECK FAILED", "is-error", "Try again"],
  } as const;
  const [badgeText, badgeClass, buttonText] = labels[state];
  badge.textContent = badgeText;
  badge.className = `background-service-meta-badge ${badgeClass}`;
  badge.title = updateStatus?.error ?? "";
  button.textContent = buttonText;
  button.disabled = state === "checking" || state === "downloading" || state === "installing";
}

function onUpdateClick(): void {
  if (updateStatus?.state === "updateAvailable") client.installUpdate();
  else client.checkForUpdates();
}

function setToggleChecked(checked: boolean): void {
  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");
  if (!toggle) return;
  toggle.setAttribute("aria-checked", String(checked));
  toggle.textContent = checked ? "On" : "Off";
}

async function onToggleClick(): Promise<void> {
  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");
  if (!toggle || !currentDeviceKey) return;
  const turningOn = toggle.getAttribute("aria-checked") !== "true";

  if (!turningOn) {
    client.setGameModeEnabled(currentDeviceKey, false);
    setToggleChecked(false);
    return;
  }

  await captureAndEnroll();
}

async function reapplyIfEnabled(): Promise<void> {
  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");
  if (toggle?.getAttribute("aria-checked") !== "true") return;
  await captureAndEnroll();
}

async function captureAndEnroll(): Promise<void> {
  const activeClientRef = getActiveClientRef();
  if (!activeClientRef || !currentDeviceKey) return;

  capturing = true;
  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");
  if (toggle) { toggle.disabled = true; toggle.textContent = "Applying…"; }

  try {
    const { client: activeClient, brand, name } = activeClientRef;
    const message = await captureGameModeRecipe(
      activeClient,
      activeClient.device.vendorId,
      activeClient.device.productId,
      brand,
      name,
      idleRateHz,
      gamingRateHz,
    );
    client.enrollDevice(message);
    setToggleChecked(true); // optimistic, onEnrollResult reverts on denial/error
  } catch {
    capturing = false;
    setToggleChecked(false);
  } finally {
    if (toggle) toggle.disabled = false;
  }
}

let activeClientRefProvider: (() => { client: PollingRateClient; brand: string; name: string } | null) | null = null;

/** control.ts registers how to get the currently active vendor client + display name, once, at startup. */
export function setActiveClientRefProvider(provider: () => { client: PollingRateClient; brand: string; name: string } | null): void {
  activeClientRefProvider = provider;
}

function getActiveClientRef() {
  return activeClientRefProvider?.() ?? null;
}
