import { captureGameModeRecipe, computeDeviceKey, type PollingRateClient } from "./capture";
import { buildFingerprint } from "./fingerprint";
import type { DeviceStatus, StatusMessage } from "./types";
import { GameModeClient, type ConnectionState } from "./ws-client";
import type { MouseStatus } from "../devices/mouse-types";

const DEFAULT_RATES = [125, 500, 1000, 2000, 4000, 8000];

let latestStatusMessage: StatusMessage | null = null;
let currentDeviceKey: string | null = null;
let capturing = false;

const client = new GameModeClient({
  onStateChange: (state) => refreshConnectionUi(state),
  onStatus: (status) => {
    latestStatusMessage = status;
    refreshDeviceUi();
  },
  onEnrollResult: (ok, deviceKey) => {
    if (deviceKey !== currentDeviceKey) return;
    capturing = false;
    if (!ok) setToggleChecked(false);
    refreshDeviceUi();
  },
});

/** Called once at startup — independent of any device being connected yet. */
export function initGameMode(): void {
  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");
  const idleSelect = document.querySelector<HTMLSelectElement>("#game-mode-idle-rate");
  const gamingSelect = document.querySelector<HTMLSelectElement>("#game-mode-gaming-rate");

  toggle?.addEventListener("click", () => void onToggleClick());
  idleSelect?.addEventListener("change", () => void reapplyIfEnabled());
  gamingSelect?.addEventListener("change", () => void reapplyIfEnabled());

  client.connect();
}

/** Called from control.ts's showStatus() whenever the active device/status changes. supported comes from support.ts's isGameModeSupported() against the real SupportedClient union, which this module intentionally doesn't import (it only needs the narrower PollingRateClient shape). */
export function refreshGameModeCard(status: MouseStatus, supported: boolean, device: HIDDevice | null): void {
  const card = document.querySelector<HTMLElement>("#game-mode-card");
  if (!card) return;

  card.hidden = !supported || !device;
  if (!supported || !device) {
    currentDeviceKey = null;
    return;
  }

  populateRateSelect("#game-mode-idle-rate", status, status.pollingRateHz);
  const rates = status.supportedPollingRates?.length ? status.supportedPollingRates : DEFAULT_RATES;
  populateRateSelect("#game-mode-gaming-rate", status, Math.max(...rates));

  void computeDeviceKey(device.vendorId, device.productId, buildFingerprint(device)).then((key) => {
    currentDeviceKey = key;
    refreshDeviceUi();
  });
}

function populateRateSelect(selector: string, status: MouseStatus, defaultValue: number): void {
  const select = document.querySelector<HTMLSelectElement>(selector);
  if (!select || select.dataset.filled === String(status.pollingRateHz)) return;
  const rates = status.supportedPollingRates?.length ? status.supportedPollingRates : DEFAULT_RATES;
  select.innerHTML = "";
  for (const rate of rates) {
    const option = new Option(rate >= 1000 ? `${rate / 1000}K Hz` : `${rate} Hz`, String(rate));
    select.add(option);
  }
  select.value = String(defaultValue);
}

function refreshConnectionUi(state: ConnectionState): void {
  const status = document.querySelector<HTMLElement>("#game-mode-status");
  const install = document.querySelector<HTMLElement>("#game-mode-install");
  const controls = document.querySelector<HTMLElement>("#game-mode-controls");
  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");

  const connected = state === "connected";
  if (install) install.hidden = connected;
  if (controls) controls.hidden = !connected;
  if (toggle) toggle.disabled = !connected || capturing;

  if (status) {
    status.textContent = {
      disconnected: "Companion: not connected. Install and launch it, then this page will pair automatically.",
      connecting: "Companion: connecting…",
      denied: "Companion: connection was blocked. Approve it in the Companion app, then reload this page.",
      connected: "Companion: connected.",
    }[state];
  }

  if (!connected) currentDeviceKey = null;
  refreshDeviceUi();
}

function refreshDeviceUi(): void {
  const toggle = document.querySelector<HTMLButtonElement>("#game-mode-toggle");
  if (!toggle || !currentDeviceKey) return;

  const entry = findDeviceEntry(currentDeviceKey);
  if (entry) {
    setToggleChecked(entry.gameModeEnabled);
    if (entry.idleRateHz) setSelectValue("#game-mode-idle-rate", entry.idleRateHz);
    if (entry.gamingRateHz) setSelectValue("#game-mode-gaming-rate", entry.gamingRateHz);
  }
}

function findDeviceEntry(deviceKey: string): DeviceStatus | undefined {
  return latestStatusMessage?.devices.find((d) => d.deviceKey === deviceKey);
}

function setSelectValue(selector: string, value: number): void {
  const select = document.querySelector<HTMLSelectElement>(selector);
  if (select) select.value = String(value);
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

  const idleRate = Number(document.querySelector<HTMLSelectElement>("#game-mode-idle-rate")?.value);
  const gamingRate = Number(document.querySelector<HTMLSelectElement>("#game-mode-gaming-rate")?.value);
  if (!idleRate || !gamingRate) return;

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
      idleRate,
      gamingRate,
    );
    client.enrollDevice(message);
    setToggleChecked(true); // optimistic — onEnrollResult reverts on denial/error
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
