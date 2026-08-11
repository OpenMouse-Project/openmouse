import "./demo.css";

const demoApp = document.querySelector<HTMLDivElement>("#demo-app");

if (!demoApp) {
  throw new Error("OpenMouse could not find the demo application root.");
}

const mobileNavigator = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
const isMobileDevice = mobileNavigator.userAgentData?.mobile === true
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

if (isMobileDevice) {
  document.documentElement.classList.add("blocked-device");
}

const DEMO_SETTINGS_KEY = "openmouse-demo-settings-v1";
const POLLING_VALUES = [125, 250, 500, 1000] as const;
type PollingValue = typeof POLLING_VALUES[number];
const DPI_PRESETS = [400, 800, 1600, 3200, 6400] as const;

let appliedDpi = 1600;
let appliedPolling: PollingValue = 1000;
let pendingDpi = appliedDpi;
let pendingPolling: PollingValue = appliedPolling;

try {
  const saved = JSON.parse(localStorage.getItem(DEMO_SETTINGS_KEY) ?? "{}") as Partial<{ dpi: number; polling: number }>;
  if (typeof saved.dpi === "number" && (DPI_PRESETS as readonly number[]).includes(saved.dpi)) {
    appliedDpi = pendingDpi = saved.dpi;
  }
  if (typeof saved.polling === "number" && (POLLING_VALUES as readonly number[]).includes(saved.polling)) {
    appliedPolling = pendingPolling = saved.polling as PollingValue;
  }
} catch {
  // Use defaults if storage is unavailable.
}

function fmtDpi(dpi: number): string {
  return `${dpi.toLocaleString()} DPI`;
}

function fmtHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K Hz` : `${hz} Hz`;
}

demoApp.innerHTML = `
  <section class="small-screen-blocker" aria-labelledby="desktop-required-title">
    <span class="blocker-mark">OM</span>
    <p class="blocker-label">INTERFACE PREVIEW</p>
    <h1 id="desktop-required-title">Desktop required.</h1>
    <p>The OpenMouse interface preview needs a larger screen. Open this page on a desktop or laptop with a window at least 900px wide.</p>
    <a href="/">Back to OpenMouse</a>
  </section>

  <div class="demo-shell">
    <aside class="sidebar">
      <div class="sidebar-header">
        <a class="demo-wordmark" href="/" aria-label="Back to OpenMouse">OpenMouse</a>
        <div class="sidebar-icons">
          <a class="icon-link" href="https://discord.gg/5Vw9uQV3xB" target="_blank" rel="noreferrer" aria-label="Discord">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M19.5 5.3A17.2 17.2 0 0 0 15.2 4l-.5 1a16 16 0 0 0-5.3 0l-.6-1a17.5 17.5 0 0 0-4.3 1.3C1.8 9.4 1 13.4 1.3 17.4a17.4 17.4 0 0 0 5.3 2.7l1.3-1.8a11 11 0 0 1-2-1l.5-.4a12.3 12.3 0 0 0 11.2 0l.6.4c-.7.4-1.3.7-2 1l1.3 1.8a17.4 17.4 0 0 0 5.3-2.7c.4-4.6-.8-8.5-3.3-12.1ZM8.3 15.2c-1 0-1.9-1-1.9-2.2s.9-2.2 1.9-2.2 1.9 1 1.9 2.2-.9 2.2-1.9 2.2Zm7.4 0c-1 0-1.9-1-1.9-2.2s.9-2.2 1.9-2.2 1.9 1 1.9 2.2-.9 2.2-1.9 2.2Z"/></svg>
          </a>
          <a class="icon-link" href="https://x.com/openmouseapp" target="_blank" rel="noreferrer" aria-label="X / Twitter">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M17.751 3h3.067l-6.7 7.625L22 21h-6.172l-4.833-6.293L5.464 21H2.395l7.167-8.155L2 3h6.328l4.37 5.752zm-1.076 16.172h1.7L7.404 4.732H5.58z"/></svg>
          </a>
        </div>
      </div>

      <p class="device-label">SELECTED DEVICE</p>
      <div class="selected-device">
        <strong>Superlight 2C</strong>
        <div class="device-connection"><span class="device-dot"></span>Connected</div>
      </div>

      <p class="device-label" style="margin-top:1.75rem">CONNECTED DEVICES</p>
      <button class="device-select is-selected" type="button" aria-pressed="true">
        <span class="device-dot"></span>
        <span><strong>Superlight 2C</strong><small>Logitech · Wireless</small></span>
      </button>
      <button class="add-device-btn" type="button" disabled>+ Add device</button>

      <hr class="sidebar-divider" />
      <button class="sidebar-action" type="button" disabled>
        <svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM.87 10.8a1.5 1.5 0 0 1 0-1.6l1.19-1.87A1.5 1.5 0 0 1 3.84 6.7l.41.05c.36.04.72-.07 1-.28l.35-.27a1.5 1.5 0 0 0 .55-.96l.07-.41A1.5 1.5 0 0 1 7.7 3.5h2.6a1.5 1.5 0 0 1 1.47 1.33l.07.4a1.5 1.5 0 0 0 .55.97l.35.27c.28.2.64.32 1 .28l.41-.05a1.5 1.5 0 0 1 1.78.63l1.19 1.87a1.5 1.5 0 0 1 0 1.6l-1.19 1.87a1.5 1.5 0 0 1-1.78.63l-.41-.05a1.5 1.5 0 0 0-1 .28l-.35.27a1.5 1.5 0 0 0-.55.97l-.07.4a1.5 1.5 0 0 1-1.47 1.33H7.7a1.5 1.5 0 0 1-1.47-1.33l-.07-.41a1.5 1.5 0 0 0-.55-.96l-.35-.27a1.5 1.5 0 0 0-1-.28l-.41.05a1.5 1.5 0 0 1-1.78-.63z"/></svg>
        Interface settings
      </button>
      <a class="sidebar-action" href="https://openmouse.app/mouse-check" target="_blank" rel="noreferrer">Mouse Check</a>

      <div class="sidebar-footer">
        <span>INSIDERS · v0.1.0</span>
        <span>Interface concept</span>
      </div>
    </aside>

    <main class="control-panel">
      <div class="preview-banner">
        <span>CONCEPT PREVIEW</span>
        <p id="preview-message" aria-live="polite">This demo does not connect to or change a real device.</p>
      </div>

      <div class="status-bar">
        <span class="status-dot"></span>
        <span id="status-text">Current: ${fmtDpi(appliedDpi)} · ${fmtHz(appliedPolling)}</span>
      </div>

      <nav class="tab-bar" aria-label="Device settings">
        <button class="tab-btn" type="button" data-tab="overview">Overview</button>
        <button class="tab-btn active" type="button" data-tab="performance">Performance</button>
        <button class="tab-btn" type="button" data-tab="lighting" disabled>Lighting</button>
        <button class="tab-btn" type="button" data-tab="buttons" disabled>Buttons</button>
        <button class="tab-btn" type="button" data-tab="profiles" disabled>Profiles</button>
        <button class="tab-btn" type="button" data-tab="advanced" disabled>Advanced</button>
      </nav>

      <section id="panel-overview" class="panel" hidden>
        <div class="device-overview">
          <div class="mouse-stage" aria-label="Mouse preview">
            <img class="mouse-image" src="/superlight-2c-black.png" alt="Top view of a black Logitech Superlight 2C gaming mouse" />
            <span class="model-caption">SUPERLIGHT 2C</span>
          </div>
          <div class="quick-stats">
            <article><span>BATTERY</span><strong>82%</strong><div class="meter"><i style="width:82%"></i></div></article>
            <article><span>FIRMWARE</span><strong>1.2.4</strong><small>Up to date</small></article>
            <article><span>CONNECTION</span><strong>Wireless</strong><small>2.4 GHz receiver</small></article>
          </div>
        </div>
      </section>

      <section id="panel-performance" class="panel">
        <div class="settings-stack">
          <article class="setting-card">
            <div class="setting-heading">
              <div><p>DPI</p><h2>Sensitivity</h2></div>
              <div class="dpi-heading-right">
                <span id="dpi-display" class="dpi-large">${fmtDpi(pendingDpi)}</span>
                <button class="custom-btn" type="button" id="custom-dpi-btn" disabled>Custom</button>
              </div>
            </div>
            <div class="dpi-grid" id="dpi-grid" aria-label="DPI presets">
              ${DPI_PRESETS.map((dpi) =>
                `<button type="button" data-dpi="${dpi}" class="${dpi === pendingDpi ? "selected" : ""}">${dpi.toLocaleString()}</button>`,
              ).join("")}
            </div>
            <small id="dpi-note" class="setting-note">Current ${fmtDpi(appliedDpi)}</small>
          </article>

          <article class="setting-card">
            <div class="setting-heading">
              <div><p>POLLING RATE</p><h2>Report frequency</h2></div>
            </div>
            <div class="polling-wrap">
              <input id="polling-range" type="range" min="0" max="3" step="1" value="${POLLING_VALUES.indexOf(appliedPolling)}" class="polling-range" aria-label="Polling rate" />
              <div class="polling-ticks" aria-hidden="true">
                <span>125</span><span>250</span><span>500</span><span>1K</span>
              </div>
            </div>
            <small class="setting-note">Stored in this mouse's onboard profile — OpenMouse writes it there.</small>
          </article>
        </div>
      </section>

      <footer class="panel-footer">
        <div class="footer-status">
          <span id="pending-label">No pending changes</span>
          <small id="pending-sub">Adjust a setting to preview it before writing.</small>
        </div>
        <div class="footer-actions">
          <button id="revert-btn" type="button" class="revert-btn" disabled>↩ Revert</button>
          <button id="apply-btn" type="button" class="apply-btn" disabled>⚡ Apply changes</button>
        </div>
      </footer>
    </main>
  </div>
`;

// Tab switching
const tabBtns = document.querySelectorAll<HTMLButtonElement>(".tab-btn");

function showTab(tabId: string): void {
  tabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
  const overview = document.getElementById("panel-overview");
  const performance = document.getElementById("panel-performance");
  if (overview) overview.hidden = tabId !== "overview";
  if (performance) performance.hidden = tabId !== "performance";
  const msg = document.querySelector<HTMLElement>("#preview-message");
  if (msg) {
    msg.textContent = tabId === "overview"
      ? "This demo shows a simulated device status — no real connection."
      : "This demo does not connect to or change a real device.";
  }
}

tabBtns.forEach((btn) => {
  if (!btn.disabled) {
    btn.addEventListener("click", () => showTab(btn.dataset.tab ?? "performance"));
  }
});

// Pending state
function hasPendingChanges(): boolean {
  return pendingDpi !== appliedDpi || pendingPolling !== appliedPolling;
}

function updatePendingState(): void {
  const hasChanges = hasPendingChanges();
  const pendingLabel = document.getElementById("pending-label");
  const pendingSub = document.getElementById("pending-sub");
  const revertBtn = document.getElementById("revert-btn") as HTMLButtonElement | null;
  const applyBtn = document.getElementById("apply-btn") as HTMLButtonElement | null;
  if (pendingLabel) pendingLabel.textContent = hasChanges ? "Pending changes" : "No pending changes";
  if (pendingSub) {
    pendingSub.textContent = hasChanges
      ? "Preview is active — click Apply to write settings."
      : "Adjust a setting to preview it before writing.";
  }
  if (revertBtn) revertBtn.disabled = !hasChanges;
  if (applyBtn) applyBtn.disabled = !hasChanges;
}

// DPI controls
const dpiGrid = document.getElementById("dpi-grid");
const dpiDisplay = document.getElementById("dpi-display");
const dpiNote = document.getElementById("dpi-note");

function setDpi(dpi: number): void {
  pendingDpi = dpi;
  if (dpiDisplay) dpiDisplay.textContent = fmtDpi(dpi);
  dpiGrid?.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((btn) => {
    btn.classList.toggle("selected", Number(btn.dataset.dpi) === dpi);
  });
  updatePendingState();
}

dpiGrid?.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((btn) => {
  btn.addEventListener("click", () => setDpi(Number(btn.dataset.dpi)));
});

// Polling slider
const pollingRange = document.querySelector<HTMLInputElement>("#polling-range");

pollingRange?.addEventListener("input", () => {
  pendingPolling = POLLING_VALUES[Number(pollingRange.value)];
  updatePendingState();
});

// Apply / Revert
const applyBtn = document.getElementById("apply-btn") as HTMLButtonElement | null;
const revertBtn = document.getElementById("revert-btn") as HTMLButtonElement | null;
const statusText = document.getElementById("status-text");

applyBtn?.addEventListener("click", () => {
  if (!hasPendingChanges() || !applyBtn) return;
  appliedDpi = pendingDpi;
  appliedPolling = pendingPolling;
  if (dpiNote) dpiNote.textContent = `Current ${fmtDpi(appliedDpi)}`;
  if (statusText) statusText.textContent = `Current: ${fmtDpi(appliedDpi)} · ${fmtHz(appliedPolling)}`;
  try {
    localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify({ dpi: appliedDpi, polling: appliedPolling }));
  } catch { /* ignore */ }
  applyBtn.textContent = "Applied!";
  window.setTimeout(() => { applyBtn.textContent = "⚡ Apply changes"; }, 1600);
  updatePendingState();
});

revertBtn?.addEventListener("click", () => {
  pendingDpi = appliedDpi;
  pendingPolling = appliedPolling;
  setDpi(appliedDpi);
  if (pollingRange) pollingRange.value = String(POLLING_VALUES.indexOf(appliedPolling));
  updatePendingState();
});
