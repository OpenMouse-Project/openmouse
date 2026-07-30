import "./control.css";
import { LogitechHidppClient, type LogitechMouseStatus } from "./logitech-hidpp";

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
let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;

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

      <main class="control-panel">
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
          <article class="summary-stat"><span>CONNECTION</span><strong id="connection-value">—</strong><small id="connection-detail">2.4 GHz receiver</small></article>
        </section>
        <section class="settings-grid device-data" aria-label="Mouse status">
          <article class="setting-card dpi-card"><div class="setting-heading"><div><p>DPI</p><h2>Sensitivity</h2></div><output id="dpi-output">— DPI</output></div><div id="dpi-presets" class="segmented dpi-presets" aria-label="Common DPI values"></div><div class="setting-action"><span id="dpi-pending">Choose a DPI value</span><button id="custom-dpi" type="button" disabled>Custom DPI</button></div></article>
          <article class="setting-card"><div class="setting-heading"><div><p>POLLING RATE</p><h2>Report frequency</h2></div></div><div class="segmented rate-options"><button data-rate="125" disabled>125</button><button data-rate="250" disabled>250</button><button data-rate="500" disabled>500</button><button data-rate="1000" disabled>1K</button><button data-rate="2000" disabled>2K</button><button data-rate="4000" disabled>4K</button><button data-rate="8000" disabled>8K</button></div><small class="setting-note">Higher rates update cursor movement more often, but use more battery.</small></article>
          <article class="setting-card"><div class="setting-heading"><div><p>SENSOR</p><h2>Lift-off distance</h2></div></div><div class="segmented two"><button data-lod="Medium" disabled>Medium</button><button data-lod="High" disabled>High</button></div><small class="setting-note">Controls how far you can lift the mouse before tracking stops. High keeps tracking a little longer.</small></article>
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
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => {
    button.addEventListener("click", () => {
      void applyPollingRate(Number(button.dataset.rate));
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    button.addEventListener("click", () => {
      const lod = button.dataset.lod as LogitechMouseStatus["liftOffDistance"];
      if (lod) void applyLiftOffDistance(lod);
    });
  });
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function batteryMode(state: LogitechMouseStatus["batteryState"]): BatteryMode | null {
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

function batteryDetail(status: LogitechMouseStatus): string {
  if (status.batteryPercent === null) return status.batteryState;
  if (status.batteryState === "Full") return "Fully charged";
  const mode = batteryMode(status.batteryState);
  if (!mode) return status.batteryState;
  const now = Date.now();
  const samples = saveBatterySample(status.name, status.batteryPercent, mode, now);
  const estimate = estimateBatteryTime(samples, status.batteryPercent, mode, now);
  const label = mode === "charging" ? "until full" : "remaining";
  return estimate ? `${status.batteryState} · ${estimate} ${label}` : `${status.batteryState} · Calculating estimate`;
}

function showStatus(status: LogitechMouseStatus): void {
  const battery = status.batteryPercent === null ? "—" : `${status.batteryPercent}%`;
  setText("#dpi-output", `${status.dpi.toLocaleString()} DPI`);
  setText("#battery-value", battery);
  setText("#battery-detail", batteryDetail(status));
  setText("#firmware-value", status.firmware[0] ?? "—");
  setText("#firmware-detail", status.firmware.slice(1).join(" · ") || "Firmware reported by mouse");
  setText("#connection-value", "Wireless");
  setText("#connection-detail", status.activeProfile ? `2.4 GHz · Profile ${status.activeProfile}` : "2.4 GHz receiver");
  setText("#device-title", status.name);
  setText("#sidebar-device-name", status.name);
  setText("#sidebar-device-status", "Logitech · Connected");
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
    button.disabled = false;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.dpi) === status.dpi));
}

async function connect(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Connecting…";
  setText("#device-status", "Requesting permission");
  setText("#read-status", "Choose your device in the browser prompt.");

  try {
    const client = await LogitechHidppClient.requestReceiver();
    if (!client) {
      setText("#device-status", "Not connected");
      setText("#read-status", "No receiver was selected.");
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
    if (!activeClient) button.disabled = false;
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
  if (!activeClient || !dpiOptions.includes(dpi) || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-dpi], #custom-dpi");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${dpi.toLocaleString()} DPI…`);
  try {
    await activeClient.setDpi(dpi);
    showStatus(await activeClient.readStatus());
    setText("#dpi-pending", `Confirmed at ${dpi.toLocaleString()} DPI`);
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set DPI.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function applyPollingRate(rate: number): Promise<void> {
  if (!activeClient || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-rate]");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  setText("#read-status", `Setting ${rate.toLocaleString()} Hz…`);
  try {
    await activeClient.setPollingRate(rate);
    showStatus(await activeClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set polling rate.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function applyLiftOffDistance(lod: NonNullable<LogitechMouseStatus["liftOffDistance"]>): Promise<void> {
  if (!activeClient || refreshInProgress || settingInProgress) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-lod]");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Setting ${lod.toLowerCase()} lift-off distance…`);
  try {
    await activeClient.setLiftOffDistance(lod);
    showStatus(await activeClient.readStatus());
  } catch (error) {
    setText("#read-status", error instanceof Error ? error.message : "Unable to set lift-off distance.");
  } finally {
    settingInProgress = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function startAutomaticRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void refreshStatus();
  }, 5000);
}

async function refreshStatus(): Promise<void> {
  if (!activeClient || refreshInProgress || settingInProgress) return;
  refreshInProgress = true;
  try {
    showStatus(await activeClient.readStatus());
  } catch (error) {
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
});

if (sessionStorage.getItem(ACCESS_KEY) === "granted") {
  renderControl();
} else {
  renderGate();
}
