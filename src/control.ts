import "./control.css";
import { LogitechHidppClient, type LogitechMouseStatus } from "./logitech-hidpp";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

const appRoot = controlApp;

const ACCESS_KEY = "openmouse-control-access";
const ACCESS_CODE = "3734";
let activeClient: LogitechHidppClient | null = null;
let refreshTimer: number | null = null;
let refreshInProgress = false;

function renderGate(message = ""): void {
  appRoot.innerHTML = `
    <main class="access-gate">
      <a class="demo-wordmark" href="/">OpenMouse</a>
      <p class="overline">PRIVATE CONTROL PANEL</p>
      <h1>Enter access code.</h1>
      <p>This temporary control panel reads supported Logitech devices through WebHID.</p>
      <form id="access-form" class="access-form">
        <label for="access-code">Access code</label>
        <input id="access-code" type="password" inputmode="numeric" autocomplete="current-password" autofocus />
        <button type="submit">Continue</button>
        <output id="access-error" aria-live="polite">${message}</output>
      </form>
    </main>`;

  document.querySelector<HTMLFormElement>("#access-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#access-code");
    if (input?.value === ACCESS_CODE) {
      sessionStorage.setItem(ACCESS_KEY, "granted");
      renderControl();
      return;
    }
    renderGate("Incorrect access code.");
  });
}

function renderControl(): void {
  appRoot.innerHTML = `
    <div class="control-shell">
      <aside class="sidebar">
        <a class="demo-wordmark" href="/">OpenMouse</a>
        <div class="device-label">CONNECTED DEVICE</div>
        <div class="device-select">
          <span class="device-dot is-idle"></span>
          <span><strong id="sidebar-device-name">No device connected</strong><small id="sidebar-device-status">Logitech receiver required</small></span>
        </div>
        <button id="connect-button" class="sidebar-action" type="button">Add device</button>
        <div class="sidebar-footer"><span>Read-only WebHID status</span><a href="/">Back to website</a></div>
      </aside>

      <main class="control-panel">
        <div class="preview-banner"><span>WEBHID</span><p id="connection-banner">Connect a supported Logitech receiver to read its current status. No settings are changed.</p></div>
        <header class="panel-header">
          <div><p class="overline">LOGITECH</p><h1 id="device-title">Connect a mouse</h1></div>
          <div class="device-status"><span class="status-dot is-idle"></span><span id="device-status">No device connected</span></div>
        </header>
        <section class="device-overview">
          <div class="mouse-stage"><img class="mouse-image" src="/superlight-2c-black.png" alt="Gaming mouse" /><span id="model-caption" class="model-caption">SUPPORTED LOGITECH RECEIVER</span></div>
          <div class="quick-stats">
            <article><span>BATTERY</span><strong id="battery-value">—</strong><small id="battery-detail">Read after connection</small><div class="meter"><i id="battery-meter" style="width:0%"></i></div></article>
            <article><span>FIRMWARE</span><strong id="firmware-value">—</strong><small id="firmware-detail">Read after connection</small></article>
            <article><span>CONNECTION</span><strong id="connection-value">—</strong><small id="connection-detail">2.4 GHz receiver</small></article>
          </div>
        </section>
        <section class="settings-grid" aria-label="Mouse status">
          <article class="setting-card dpi-card"><div class="setting-heading"><div><p>DPI</p><h2>Sensitivity</h2></div><output id="dpi-output">— DPI</output></div><input id="dpi-range" type="range" min="100" max="3200" value="100" disabled /><div class="range-labels"><span>Read-only</span><span>Current value</span></div><p class="setting-note">Read directly from the mouse. Settings writes are deliberately disabled.</p></article>
          <article class="setting-card"><div class="setting-heading"><div><p>POLLING RATE</p><h2>Report frequency</h2></div></div><div class="segmented"><button data-rate="125" disabled>125</button><button data-rate="500" disabled>500</button><button data-rate="1000" disabled>1000</button><button data-rate="8000" disabled>8000</button></div><small class="setting-note">Hz. The selected value is the active report rate.</small></article>
          <article class="setting-card"><div class="setting-heading"><div><p>SENSOR</p><h2>Lift-off distance</h2></div></div><div class="segmented two"><button data-lod="Low" disabled>Low</button><button data-lod="High" disabled>High</button></div><small class="setting-note" id="profile-value">Onboard profile will appear after connection.</small></article>
        </section>
        <footer class="panel-footer"><span id="read-status">Add a Logitech receiver from the sidebar to read its current status.</span></footer>
      </main>
    </div>`;

  document.querySelector<HTMLButtonElement>("#connect-button")?.addEventListener("click", () => {
    void connect();
  });
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function showStatus(status: LogitechMouseStatus): void {
  const dpiRange = document.querySelector<HTMLInputElement>("#dpi-range");
  if (dpiRange) dpiRange.value = String(Math.max(100, Math.min(3200, status.dpi)));
  const battery = status.batteryPercent === null ? "—" : `${status.batteryPercent}%`;
  setText("#dpi-output", `${status.dpi.toLocaleString()} DPI`);
  setText("#battery-value", battery);
  setText("#battery-detail", status.batteryState);
  setText("#firmware-value", status.firmware[0] ?? "—");
  setText("#firmware-detail", status.firmware.slice(1).join(" · ") || "Firmware reported by mouse");
  setText("#connection-value", "Wireless");
  setText("#connection-detail", status.activeProfile ? `2.4 GHz · Profile ${status.activeProfile}` : "2.4 GHz receiver");
  setText("#profile-value", status.activeProfile ? `Onboard Profile ${status.activeProfile} is active.` : "Onboard profiles are not active.");
  setText("#device-title", status.name);
  setText("#sidebar-device-name", status.name);
  setText("#sidebar-device-status", "Logitech · Connected");
  setText("#model-caption", status.name.toUpperCase());
  setText("#device-status", "Connected");
  setText("#connection-banner", "Live status read directly through WebHID. No device settings have been changed.");
  setText("#read-status", `Current: ${status.dpi.toLocaleString()} DPI · ${status.pollingRateHz.toLocaleString()} Hz`);
  const meter = document.querySelector<HTMLElement>("#battery-meter");
  if (meter) meter.style.width = status.batteryPercent === null ? "0%" : `${status.batteryPercent}%`;
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  const connectButton = document.querySelector<HTMLButtonElement>("#connect-button");
  if (connectButton) connectButton.hidden = true;
  document.querySelectorAll<HTMLButtonElement>("[data-rate]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.rate) === status.pollingRateHz));
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => button.classList.toggle("selected", button.dataset.lod === status.liftOffDistance));
}

async function connect(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Connecting…";
  setText("#device-status", "Requesting permission");
  setText("#read-status", "Choose the Logitech USB Receiver in the browser prompt.");

  try {
    const client = await LogitechHidppClient.requestReceiver();
    if (!client) {
      setText("#device-status", "Not connected");
      setText("#read-status", "No receiver was selected.");
      return;
    }
    activeClient = client;
    showStatus(await activeClient.readStatus());
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

function startAutomaticRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void refreshStatus();
  }, 5000);
}

async function refreshStatus(): Promise<void> {
  if (!activeClient || refreshInProgress) return;
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
