import "./control.css";
import { LogitechHidppClient } from "./logitech-hidpp";
import type { MouseStatus } from "./mouse-types";
import { PulsarHidClient } from "./pulsar-hid";
import { PulsarProHidClient } from "./pulsar-pro-hid";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

const appRoot = controlApp;

const ACCESS_KEY = "openmouse-control-access-v2";
const BATTERY_HISTORY_KEY = "openmouse-battery-history-v1";
const ACCESS_USERNAME = "snekxs";
const ACCESS_PASSWORD = "3734";
const BATTERY_CHECKPOINT_MS = 5 * 60 * 1000;
const BATTERY_MAX_SAMPLE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BATTERY_MAX_CONTINUOUS_GAP_MS = 10 * 60 * 1000;
const BATTERY_MIN_ESTIMATE_SPAN_MS = 10 * 60 * 1000;
const BATTERY_MAX_SAMPLES_PER_DEVICE = 500;
let activeClient: LogitechHidppClient | null = null;
let activePulsarClient: PulsarClient | null = null;
let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;
let lastRenderedStatusKey: string | null = null;

type PulsarClient = PulsarHidClient | PulsarProHidClient;
type SupportedClient = LogitechHidppClient | PulsarClient;

type BatteryMode = "charging" | "discharging";

interface BatterySample {
  timestamp: number;
  percent: number;
  mode: BatteryMode;
}

type BatteryHistory = Record<string, BatterySample[]>;

function renderGate(message = ""): void {
  appRoot.innerHTML = `
    <main class="access-gate">
      <a class="demo-wordmark" href="/">OpenMouse</a>
      <p class="overline">PRIVATE CONTROL PANEL</p>
      <h1>Sign in to continue.</h1>
      <p>Private control for supported devices through WebHID.</p>
      <form id="access-form" class="access-form">
        <label for="access-username">Username</label>
        <input id="access-username" type="text" autocomplete="username" autofocus />
        <label for="access-password">Password</label>
        <input id="access-password" type="password" inputmode="numeric" autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <output id="access-error" aria-live="polite">${message}</output>
      </form>
    </main>`;

  document.querySelector<HTMLFormElement>("#access-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = document.querySelector<HTMLInputElement>("#access-username");
    const password = document.querySelector<HTMLInputElement>("#access-password");
    if (username?.value === ACCESS_USERNAME && password?.value === ACCESS_PASSWORD) {
      sessionStorage.setItem(ACCESS_KEY, "granted");
      renderControl();
      return;
    }
    renderGate("Incorrect username or password.");
  });
}

function renderControl(): void {
  appRoot.innerHTML = `
    <div class="control-shell is-empty">
      <aside class="sidebar">
        <a class="demo-wordmark" href="/">OpenMouse</a>
        <div class="device-label">CONNECTED DEVICE</div>
        <div class="device-select">
          <span class="device-dot is-idle"></span>
          <span><strong id="sidebar-device-name">No device connected</strong><small id="sidebar-device-status">Choose a supported device</small></span>
        </div>
        <button id="connect-button" class="sidebar-action" type="button">Add device</button>
        <div class="sidebar-footer"><span>WebHID device control</span><a href="/">Back to website</a></div>
      </aside>

      <main class="control-panel" style="overflow-y:auto">
        <div class="preview-banner"><span>WEBHID</span><p id="connection-banner">Connect a supported device to view and change its settings.</p></div>
        <header class="panel-header">
          <div><p class="overline">DEVICE CONTROL</p><h1 id="device-title">Connect a mouse</h1></div>
          <div class="device-status"><span class="status-dot is-idle"></span><span id="device-status">No device connected</span></div>
        </header>
        <section class="empty-state" aria-labelledby="empty-state-title">
          <p class="overline">READY WHEN YOU ARE</p>
          <h2 id="empty-state-title">Connect a supported mouse.</h2>
          <p>Use <strong>Add device</strong> in the sidebar, then choose your device in the browser prompt.</p>
          <small>Compatible devices will appear in the browser prompt.</small>
        </section>
        <section class="device-overview device-data" aria-label="Device status">
          <article class="summary-stat"><span>BATTERY</span><strong id="battery-value">—</strong><small id="battery-detail">Read after connection</small><div class="meter"><i id="battery-meter" style="width:0%"></i></div></article>
          <article class="summary-stat"><span>FIRMWARE</span><strong id="firmware-value">—</strong><small id="firmware-detail">Read after connection</small></article>
          <article class="summary-stat"><span>CONNECTION</span><strong id="connection-value">—</strong><small id="connection-detail">2.4 GHz receiver</small><button id="dongle-led-toggle" type="button" style="align-self:flex-start;margin-top:.45rem;padding:.28rem .5rem;border:1px solid #3a3a3f;border-radius:5px;background:#19191c;color:#d8d8dc;font-size:.61rem;font-weight:600" hidden disabled>Receiver LED</button></article>
        </section>
        <section class="settings-grid device-data" aria-label="Mouse status">
          <article class="setting-card dpi-card"><div class="setting-heading"><div><p>DPI</p><h2>Sensitivity</h2></div><output id="dpi-output">— DPI</output></div><div id="dpi-presets" class="segmented dpi-presets" aria-label="Common DPI values"></div><div class="setting-action"><span id="dpi-pending">Choose a DPI value</span><button id="custom-dpi" type="button" disabled>Custom DPI</button></div></article>
          <article class="setting-card"><div class="setting-heading"><div><p>POLLING RATE</p><h2>Report frequency</h2></div></div><div class="segmented rate-options"><button data-rate="125" disabled>125</button><button data-rate="250" disabled>250</button><button data-rate="500" disabled>500</button><button data-rate="1000" disabled>1K</button><button data-rate="2000" disabled>2K</button><button data-rate="4000" disabled>4K</button><button data-rate="8000" disabled>8K</button></div><small class="setting-note">Higher rates update cursor movement more often, but use more battery.</small></article>
          <article class="setting-card"><div class="setting-heading"><div><p>SENSOR</p><h2>Lift-off distance</h2></div></div><div class="segmented three"><button data-lod="Low" disabled>0.7 mm</button><button data-lod="Medium" disabled>1 mm</button><button data-lod="High" disabled>2 mm</button></div><small class="setting-note">Controls how far you can lift the mouse before tracking stops. Higher values keep tracking a little longer.</small></article>
        </section>
        <section id="pulsar-advanced" class="device-data" aria-label="Advanced Pulsar settings" style="display:none;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.65rem;margin-top:.65rem;padding-bottom:.4rem">
          <article class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>WIRELESS</p><h2>Signal strength</h2></div><output id="signal-output">—</output></div><small id="signal-detail" class="setting-note">Receiver signal is unavailable.</small></article>
          <article class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>CLICK</p><h2>Debounce</h2></div></div><select id="debounce-select" style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"></select></article>
          <article class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>POWER</p><h2>Auto sleep</h2></div></div><select id="sleep-select" style="width:100%;padding:.48rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option value="1">10 seconds</option><option value="3">30 seconds</option><option value="6">1 minute</option><option value="12">2 minutes</option><option value="30">5 minutes</option><option value="60">10 minutes</option><option value="180">30 minutes</option></select></article>
          <article class="setting-card" style="min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>SENSOR</p><h2>Processing</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Motion Sync</span><button id="motion-sync-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Angle snapping</span><button id="angle-snapping-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Ripple control</span><button id="ripple-control-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Performance mode</span><button id="performance-mode-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div></article>
          <article id="pulsar-pro-settings" class="setting-card" style="display:none;min-height:0;padding:.8rem"><div class="setting-heading" style="margin-bottom:.55rem"><div><p>PRO</p><h2>Advanced</h2></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;color:#b3b3b7;font-size:.7rem"><span>Wheel acceleration</span><button id="wheel-acceleration-toggle" type="button" role="switch" aria-checked="false" style="min-width:42px;padding:.2rem .45rem;border:1px solid #3a3a3f;border-radius:999px;background:#202023;color:#8b8b90;font-size:.58rem">Off</button></div><label style="display:block;margin-top:.35rem;color:#77777c;font-size:.62rem">Angle tuning<select id="angle-tuning-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"></select></label><label style="display:block;margin-top:.35rem;color:#77777c;font-size:.62rem">Onboard profile<select id="profile-select" style="width:100%;margin-top:.2rem;padding:.4rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#eee"><option value="1">Profile 1</option><option value="2">Profile 2</option><option value="3">Profile 3</option><option value="4">Profile 4</option><option value="5">Profile 5</option><option value="6">Profile 6</option></select></label></article>
        </section>
        <footer class="panel-footer device-data"><span class="live-status-label"><i></i>LIVE STATUS</span><span id="read-status">Add a supported device from the sidebar to read its current status.</span></footer>
      </main>
    </div>`;

  document.querySelector<HTMLButtonElement>("#connect-button")?.addEventListener("click", () => {
    void connect();
  });
  document.querySelector<HTMLButtonElement>("#custom-dpi")?.addEventListener("click", () => {
    void chooseCustomDpi();
  });
  document.querySelector<HTMLButtonElement>("#dongle-led-toggle")?.addEventListener("click", () => {
    void toggleDongleLed();
  });
  for (let debounce = 0; debounce <= 15; debounce += 1) {
    document.querySelector<HTMLSelectElement>("#debounce-select")?.add(new Option(`${debounce} ms`, String(debounce)));
  }
  for (let angle = -30; angle <= 30; angle += 1) {
    document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.add(new Option(`${angle}°`, String(angle)));
  }
  document.querySelector<HTMLSelectElement>("#debounce-select")?.addEventListener("change", (event) => {
    void applyPulsarValue("debounce", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#sleep-select")?.addEventListener("change", (event) => {
    void applyPulsarValue("sleep", Number((event.target as HTMLSelectElement).value));
  });
  const toggles = [
    ["#motion-sync-toggle", "motionSync"],
    ["#angle-snapping-toggle", "angleSnapping"],
    ["#ripple-control-toggle", "rippleControl"],
    ["#performance-mode-toggle", "performanceMode"],
  ] as const;
  for (const [selector, setting] of toggles) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void applyPulsarToggle(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  document.querySelector<HTMLButtonElement>("#wheel-acceleration-toggle")?.addEventListener("click", (event) => {
    void applyProSetting("wheelAcceleration", (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
  });
  document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.addEventListener("change", (event) => {
    void applyProSetting("angleTuning", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#profile-select")?.addEventListener("change", (event) => {
    void applyProSetting("profile", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    button.addEventListener("click", () => {
      void applyPollingRate(Number(button.dataset.rate));
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    button.addEventListener("click", () => {
      const lod = button.dataset.lod as MouseStatus["liftOffDistance"];
      if (lod) void applyLiftOffDistance(lod);
    });
  });
  void reconnectAuthorizedDevice();
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function batteryMode(state: MouseStatus["batteryState"]): BatteryMode | null {
  if (state === "Charging" || state === "Charging slowly" || state === "Almost full") return "charging";
  if (state === "Discharging") return "discharging";
  return null;
}

function loadBatteryHistory(): BatteryHistory {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BATTERY_HISTORY_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as BatteryHistory : {};
  } catch {
    return {};
  }
}

function saveBatterySample(deviceName: string, percent: number, mode: BatteryMode, now = Date.now()): BatterySample[] {
  const history = loadBatteryHistory();
  const cutoff = now - BATTERY_MAX_SAMPLE_AGE_MS;
  const storedSamples = Array.isArray(history[deviceName]) ? history[deviceName] : [];
  const samples = storedSamples.filter((sample) =>
    Number.isFinite(sample.timestamp)
    && Number.isFinite(sample.percent)
    && sample.timestamp >= cutoff
    && sample.percent >= 0
    && sample.percent <= 100
    && (sample.mode === "charging" || sample.mode === "discharging"));
  const previous = samples.at(-1);
  const shouldSave = !previous
    || previous.mode !== mode
    || previous.percent !== percent
    || now - previous.timestamp >= BATTERY_CHECKPOINT_MS;

  if (shouldSave) samples.push({ timestamp: now, percent, mode });
  const retainedSamples = samples.slice(-BATTERY_MAX_SAMPLES_PER_DEVICE);
  history[deviceName] = retainedSamples;
  if (shouldSave || retainedSamples.length !== storedSamples.length) {
    try {
      localStorage.setItem(BATTERY_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // Estimates remain optional when browser storage is unavailable or full.
    }
  }
  return retainedSamples;
}

function formatEstimate(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `~${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `~${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr`;
  const days = hours / 24;
  return `~${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}

function estimateBatteryTime(samples: BatterySample[], percent: number, mode: BatteryMode, now = Date.now()): string | null {
  const continuous: BatterySample[] = [];
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    const newer = continuous[0];
    if (sample.mode !== mode || (newer && newer.timestamp - sample.timestamp > BATTERY_MAX_CONTINUOUS_GAP_MS)) break;
    continuous.unshift(sample);
  }

  const first = continuous[0];
  const last = continuous.at(-1);
  if (!first || !last || now - last.timestamp > BATTERY_MAX_CONTINUOUS_GAP_MS) return null;
  const elapsed = last.timestamp - first.timestamp;
  const change = mode === "charging" ? last.percent - first.percent : first.percent - last.percent;
  if (elapsed < BATTERY_MIN_ESTIMATE_SPAN_MS || change < 1) return null;

  const remainingPercent = mode === "charging" ? 100 - percent : percent;
  if (remainingPercent <= 0) return null;
  return formatEstimate(remainingPercent / (change / elapsed));
}

function batteryDetail(status: MouseStatus): string {
  const voltage = status.batteryVoltageMv ? `${(status.batteryVoltageMv / 1000).toFixed(3)} V` : null;
  const withVoltage = (detail: string): string => voltage ? `${detail} · ${voltage}` : detail;
  if (status.batteryPercent === null) return withVoltage(status.batteryState);
  if (status.batteryState === "Full") return withVoltage("Fully charged");
  const mode = batteryMode(status.batteryState);
  if (!mode) return withVoltage(status.batteryState);
  const now = Date.now();
  const samples = saveBatterySample(status.name, status.batteryPercent, mode, now);
  const estimate = estimateBatteryTime(samples, status.batteryPercent, mode, now);
  const label = mode === "charging" ? "until full" : "remaining";
  return withVoltage(estimate ? `${status.batteryState} · ${estimate} ${label}` : `${status.batteryState} · Calculating estimate`);
}

function showStatus(status: MouseStatus): void {
  lastRenderedStatusKey = JSON.stringify(status);
  const battery = status.batteryPercent === null ? "—" : `${status.batteryPercent}%`;
  setText("#dpi-output", `${status.dpi.toLocaleString()} DPI`);
  setText("#battery-value", battery);
  setText("#battery-detail", batteryDetail(status));
  setText("#firmware-value", status.firmware[0] ?? "—");
  setText("#firmware-detail", status.firmware.slice(1).join(" · ") || "Firmware reported by mouse");
  setText("#connection-value", "Wireless");
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
  if (advanced) advanced.style.display = status.brand === "Pulsar" ? "grid" : "none";
  if (status.brand === "Pulsar") {
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
  setText("#sidebar-device-name", status.name);
  setText("#sidebar-device-status", `${status.brand} · Connected`);
  setText("#device-status", "Connected");
  setText("#connection-banner", "Connected directly through WebHID. Supported settings can be adjusted here.");
  setText("#read-status", `Current: ${status.dpi.toLocaleString()} DPI · ${status.pollingRateHz.toLocaleString()} Hz`);
  const meter = document.querySelector<HTMLElement>("#battery-meter");
  if (meter) meter.style.width = status.batteryPercent === null ? "0%" : `${status.batteryPercent}%`;
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  const connectButton = document.querySelector<HTMLButtonElement>("#connect-button");
  if (connectButton) connectButton.hidden = true;
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.rate) === status.pollingRateHz));
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => button.classList.toggle("selected", button.dataset.lod === status.liftOffDistance));
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    button.disabled = false;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    button.disabled = status.brand === "Logitech" && button.dataset.lod === "Low";
  });
  document.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.dpi) === status.dpi));
}

function setControlValue(selector: string, value: number | null | undefined): void {
  const control = document.querySelector<HTMLSelectElement>(selector);
  if (!control) return;
  control.disabled = value === null || value === undefined;
  if (control.disabled) return;
  control.value = String(value);
}

function setToggleValue(selector: string, value: boolean | null | undefined): void {
  const control = document.querySelector<HTMLButtonElement>(selector);
  if (!control) return;
  control.disabled = value === null || value === undefined;
  if (control.disabled) {
    control.textContent = "N/A";
    control.style.background = "#202023";
    control.style.borderColor = "#3a3a3f";
    control.style.color = "#66666b";
    return;
  }
  control.setAttribute("aria-checked", String(value));
  control.textContent = value ? "On" : "Off";
  control.style.background = value ? "#69d28d" : "#202023";
  control.style.borderColor = value ? "#69d28d" : "#3a3a3f";
  control.style.color = value ? "#07120b" : "#8b8b90";
}

function formatHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

async function showPulsarExplorer(client: PulsarClient): Promise<void> {
  await client.open();
  const device = client.device;
  setText("#connection-value", "Connected");
  setText("#connection-detail", "Reading Pulsar receiver identity");
  setText("#device-title", device.productName || "Pulsar Mouse");
  setText("#sidebar-device-name", device.productName || "Pulsar Mouse");
  setText("#sidebar-device-status", "Pulsar · Connecting");
  setText("#device-status", "Connected");
  setText("#connection-banner", "Pulsar vendor HID connected. Reading verified settings.");
  setText("#read-status", client.describeCollections());
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  const connectButton = document.querySelector<HTMLButtonElement>("#connect-button");
  if (connectButton) connectButton.hidden = true;
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

function createSupportedClient(device: HIDDevice): SupportedClient | null {
  if (PulsarProHidClient.isSupported(device)) return new PulsarProHidClient(device);
  if (PulsarHidClient.isSupported(device)) return new PulsarHidClient(device);
  if (device.vendorId === 0x046d && device.productId === 0xc54d) return new LogitechHidppClient(device);
  return null;
}

async function requestSupportedClient(): Promise<SupportedClient | null> {
  if (!navigator.hid) throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
  const devices = await navigator.hid.requestDevice({
    filters: [
      { vendorId: 0x3710 },
      { vendorId: 0x046d, productId: 0xc54d, usagePage: 0xff00, usage: 0x0001 },
    ],
  });
  for (const device of devices) {
    const client = createSupportedClient(device);
    if (client) return client;
  }
  return null;
}

async function connect(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Connecting…";
  setText("#device-status", "Requesting permission");
  setText("#read-status", "Choose your device in the browser prompt.");

  try {
    const client = await requestSupportedClient();
    if (!client) {
      setText("#device-status", "Not connected");
      setText("#read-status", "No supported device was selected.");
      return;
    }
    if (!(client instanceof LogitechHidppClient)) {
      activePulsarClient = client;
      await showPulsarExplorer(client);
      return;
    }
    activeClient = client;
    const status = await activeClient.readStatus();
    dpiOptions = await activeClient.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
    startAutomaticRefresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the mouse.";
    setText("#device-status", "Connection failed");
    setText("#connection-banner", message);
    setText("#read-status", message);
  } finally {
    if (!activeClient && !activePulsarClient) {
      button.disabled = false;
      button.textContent = "Add device";
    }
  }
}

async function reconnectAuthorizedDevice(): Promise<void> {
  if (activeClient || activePulsarClient) return;
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Checking for device…";

  try {
    const devices = await navigator.hid?.getDevices() ?? [];
    const client = devices.map(createSupportedClient).find((candidate): candidate is SupportedClient => candidate !== null);
    if (!client) return;
    if (!(client instanceof LogitechHidppClient)) {
      activePulsarClient = client;
      await showPulsarExplorer(client);
      return;
    }
    activeClient = client;
    setText("#device-status", "Reconnecting");
    setText("#read-status", "Reading the previously authorized device.");
    const status = await activeClient.readStatus();
    dpiOptions = await activeClient.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
    startAutomaticRefresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconnect to the mouse.";
    await activeClient?.close().catch(() => undefined);
    await activePulsarClient?.close().catch(() => undefined);
    activeClient = null;
    activePulsarClient = null;
    setText("#device-status", "Not connected");
    setText("#connection-banner", message);
    setText("#read-status", "Use Add device to reconnect.");
  } finally {
    if (!activeClient && !activePulsarClient) {
      button.disabled = false;
      button.textContent = "Add device";
    }
  }
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
  const answer = window.prompt("Enter a DPI value supported by this mouse:", "800");
  if (answer === null) return;
  const dpi = Number(answer);
  if (!Number.isInteger(dpi) || !dpiOptions.includes(dpi)) {
    setText("#read-status", "That DPI value is not supported by this mouse.");
    return;
  }
  await applyDpiValue(dpi);
}

async function applyDpiValue(dpi: number): Promise<void> {
  const client = activeClient ?? activePulsarClient;
  if (!client || !dpiOptions.includes(dpi) || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-dpi], #custom-dpi");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${dpi.toLocaleString()} DPI…`);
  try {
    await client.setDpi(dpi);
    showStatus(await client.readStatus());
    setText("#dpi-pending", `Confirmed at ${dpi.toLocaleString()} DPI`);
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set DPI.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function applyPollingRate(rate: number): Promise<void> {
  const client = activeClient ?? activePulsarClient;
  if (!client || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-rate]");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  setText("#read-status", `Setting ${rate.toLocaleString()} Hz…`);
  try {
    await client.setPollingRate(rate);
    showStatus(await client.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set polling rate.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
  const client = activeClient ?? activePulsarClient;
  if (!client || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-lod]");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${lod.toLowerCase()} lift-off distance…`);
  try {
    await client.setLiftOffDistance(lod);
    showStatus(await client.readStatus());
  } catch (error) {
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
  try {
    await activePulsarClient.setDongleLed(enabled);
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the receiver LED.");
  } finally {
    settingInProgress = false;
    button.disabled = false;
  }
}

type PulsarToggleSetting = "motionSync" | "angleSnapping" | "rippleControl" | "performanceMode";

async function applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): Promise<void> {
  if (!activePulsarClient || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `${enabled ? "Enabling" : "Disabling"} ${settingLabel(setting)}…`);
  try {
    if (setting === "motionSync") await activePulsarClient.setMotionSync(enabled);
    if (setting === "angleSnapping") await activePulsarClient.setAngleSnapping(enabled);
    if (setting === "rippleControl") await activePulsarClient.setRippleControl(enabled);
    if (setting === "performanceMode") await activePulsarClient.setPerformanceMode(enabled);
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar setting.");
    const status = await activePulsarClient.readStatus().catch(() => null);
    if (status) showStatus(status);
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

async function applyPulsarValue(setting: "debounce" | "sleep", value: number): Promise<void> {
  if (!activePulsarClient || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Setting ${setting === "debounce" ? `${value} ms debounce` : "auto sleep"}…`);
  try {
    if (setting === "debounce") await activePulsarClient.setDebounceTime(value);
    else await activePulsarClient.setSleepTimeout(value);
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar setting.");
  } finally {
    settingInProgress = false;
  }
}

async function applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): Promise<void> {
  if (!(activePulsarClient instanceof PulsarProHidClient) || settingInProgress) return;
  settingInProgress = true;
  setText("#read-status", `Changing ${setting === "wheelAcceleration" ? "wheel acceleration" : setting === "angleTuning" ? "angle tuning" : "onboard profile"}…`);
  try {
    if (setting === "wheelAcceleration") await activePulsarClient.setWheelAcceleration(Boolean(value));
    if (setting === "angleTuning") await activePulsarClient.setAngleTuning(Number(value));
    if (setting === "profile") await activePulsarClient.setProfile(Number(value));
    showStatus(await activePulsarClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the Pulsar Pro setting.");
  } finally {
    settingInProgress = false;
  }
}

function startAutomaticRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void refreshStatus();
  }, 5000);
}

async function refreshStatus(): Promise<void> {
  const client = activeClient ?? activePulsarClient;
  if (!client || refreshInProgress || settingInProgress) return;
  refreshInProgress = true;
  try {
    const status = await client.readStatus();
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
  void activeClient?.close();
  void activePulsarClient?.close();
});

if (sessionStorage.getItem(ACCESS_KEY) === "granted") {
  renderControl();
} else {
  renderGate();
}
