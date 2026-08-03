import "./demo.css";

const demoApp = document.querySelector<HTMLDivElement>("#demo-app");

if (!demoApp) {
  throw new Error("OpenMouse could not find the demo application root.");
}

const mobileNavigator = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
const isMobileDevice = mobileNavigator.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const DEMO_SETTINGS_KEY = "openmouse-demo-settings-v1";

if (isMobileDevice) {
  document.documentElement.classList.add("blocked-device");
}

// Inject tooltip styles
const styleElement = document.createElement('style');
styleElement.textContent = `
  
`;
document.head.appendChild(styleElement);

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
      <a class="demo-wordmark" href="/" aria-label="Back to OpenMouse">OpenMouse</a>
      <div class="device-label">CONNECTED DEVICE</div>
      <div class="device-select" aria-label="Selected device">
        <span class="device-dot"></span>
        <span><strong>Superlight 2C</strong><small>Logitech · Connected</small></span>
      </div>
      <nav aria-label="Device settings">
        <button class="nav-item active" type="button" data-panel="overview">Overview</button>
        <button class="nav-item" type="button" data-panel="performance">Performance</button>
        <button class="nav-item" type="button" data-panel="buttons">Buttons</button>
        <button class="nav-item" type="button" data-panel="profiles">Profiles</button>
      </nav>
      <div class="sidebar-footer">
        <span>Interface concept</span>
        <a href="/">Back to website</a>
      </div>
    </aside>

    <main class="control-panel">
      <div class="preview-banner">
        <span>CONCEPT PREVIEW</span>
        <p id="preview-message" aria-live="polite">This demo does not connect to or change a real device.</p>
      </div>

      <header class="panel-header">
        <div>
          <p class="overline">LOGITECH</p>
          <h1>Superlight 2C</h1>
        </div>
        <div class="device-status"><span></span>Connected</div>
      </header>

      <section class="device-overview">
        <div class="mouse-stage" aria-label="Mouse preview">
          <img class="mouse-image" src="/superlight-2c-black.png" alt="Top view of a black Logitech Superlight 2C gaming mouse" />
          <span class="model-caption">SUPERLIGHT 2C</span>
        </div>
        <div class="quick-stats">
          <article><span>BATTERY</span><strong>82%</strong><div class="meter"><i style="width:82%"></i></div></article>
          <article><span>FIRMWARE</span><strong>1.2.4</strong><small>Up to date</small></article>
          <article><span>CONNECTION</span><strong>Wireless</strong><small>2.4 GHz receiver</small></article>
        </div>
      </section>

      <section class="settings-grid" aria-label="Mouse settings">
        <article class="setting-card dpi-card">
          <div class="setting-heading">
            <div><p>DPI</p><h2>Sensitivity</h2></div>
            <output id="dpi-output">1600 DPI</output>
          </div>
          <input id="dpi-range" type="range" min="100" max="3200" step="100" value="1600" aria-label="DPI sensitivity" />
          <div class="range-labels"><span>100</span><span>3200</span></div>
          <div class="dpi-stages" aria-label="DPI presets">
            <button type="button" data-dpi="400">400</button>
            <button type="button" data-dpi="800">800</button>
            <button class="selected" type="button" data-dpi="1600">1600</button>
            <button type="button" data-dpi="3200">3200</button>
          </div>
        </article>

        <article class="setting-card polling-card">
          <div class="setting-heading">
            <div><p>POLLING RATE</p><h2>Report frequency</h2></div>
            <div class="polling-tooltip-wrapper">
              <span class="info" id="polling-info-btn" role="button" tabindex="0" aria-label="What is polling rate?">?</span>
              <!-- Polling Rate Tooltip -->
              <div class="polling-tooltip" id="polling-tooltip" role="dialog" aria-label="Polling rate explanation">
                <button class="tooltip-close" id="polling-tooltip-close" aria-label="Close explanation">✕</button>
                <h4>What is Polling Rate?</h4>
                <p>Polling rate is how often your mouse tells your computer where it is.</p>
                <ul>
                  <li><strong>Measured in Hz</strong> — times per second</li>
                  <li><strong>1000 Hz</strong> = 1,000 updates per second</li>
                  <li><strong>Higher = smoother</strong>more responsive cursor</li>
                  <li>Higher rates can use <strong>more battery</strong></li>
                </ul>
              </div>
            </div>
          </div>
          <div class="segmented" data-control="polling">
            <button type="button">125</button>
            <button type="button">500</button>
            <button class="selected" type="button">1000</button>
            <button type="button">2000</button>
          </div>
          <small class="setting-note">Higher rates can use more battery.</small>
        </article>

        <article class="setting-card">
          <div class="setting-heading">
            <div><p>SENSOR</p><h2>Lift-off distance</h2></div>
          </div>
          <div class="segmented two" data-control="lift">
            <button class="selected" type="button">Low</button>
            <button type="button">High</button>
          </div>
          <label class="toggle-row">
            <span><strong>Motion sync</strong><small>Align sensor data with USB reports.</small></span>
            <input type="checkbox" checked />
            <i aria-hidden="true"></i>
          </label>
        </article>
      </section>

      <footer class="panel-footer">
        <span id="save-status">Preview settings have not been saved.</span>
        <button id="save-button" type="button">Save changes</button>
      </footer>
    </main>
  </div>
`;

const dpiRange = document.querySelector<HTMLInputElement>("#dpi-range");
const dpiOutput = document.querySelector<HTMLOutputElement>("#dpi-output");
const dpiButtons = document.querySelectorAll<HTMLButtonElement>("[data-dpi]");
const segmentedControls = document.querySelectorAll<HTMLElement>(".segmented");
const saveButton = document.querySelector<HTMLButtonElement>("#save-button");
const saveStatus = document.querySelector<HTMLSpanElement>("#save-status");
const previewMessage = document.querySelector<HTMLParagraphElement>("#preview-message");
const navItems = document.querySelectorAll<HTMLButtonElement>(".nav-item");

// ─── Polling Tooltip Elements ──────────────────────────────────────────

const infoBtn = document.querySelector<HTMLSpanElement>("#polling-info-btn");
const tooltip = document.getElementById("polling-tooltip") as HTMLDivElement | null;
const tooltipClose = document.getElementById("polling-tooltip-close") as HTMLButtonElement | null;

// ─── Polling Tooltip Functions ─────────────────────────────────────────

let hoverTimeout: number | null = null;

function showTooltip(): void {
  if (!tooltip || !infoBtn) return;
  // Clear any pending hide timeout
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }
  tooltip.classList.add("visible");
  infoBtn.classList.add("active");
}

function hideTooltip(): void {
  if (!tooltip || !infoBtn) return;
  // Add small delay before hiding to prevent accidental dismissal
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
  }
  hoverTimeout = window.setTimeout(() => {
    tooltip.classList.remove("visible");
    infoBtn.classList.remove("active");
    hoverTimeout = null;
  }, 100);
}

function toggleTooltip(): void {
  if (!tooltip) return;
  if (tooltip.classList.contains("visible")) {
    hideTooltip();
  } else {
    showTooltip();
  }
}

// ─── Polling Tooltip Event Listeners ──────────────────────────────────

// Hover events for desktop
const wrapper = document.querySelector<HTMLDivElement>(".polling-tooltip-wrapper");

wrapper?.addEventListener("mouseenter", () => {
  showTooltip();
});

wrapper?.addEventListener("mouseleave", () => {
  hideTooltip();
});

// Also hover on the tooltip itself to keep it open
tooltip?.addEventListener("mouseenter", () => {
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }
});

tooltip?.addEventListener("mouseleave", () => {
  hideTooltip();
});

// Click events for mobile (fallback)
infoBtn?.addEventListener("click", (e: MouseEvent) => {
  e.stopPropagation();
  toggleTooltip();
});

// Keyboard support: Enter/Space on the "?"
infoBtn?.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleTooltip();
  }
});

// Close button inside tooltip (for mobile)
tooltipClose?.addEventListener("click", (e: MouseEvent) => {
  e.stopPropagation();
  hideTooltip();
});

// Click outside closes tooltip (for mobile)
document.addEventListener("click", (e: MouseEvent) => {
  if (!tooltip || !infoBtn || !wrapper) return;
  const target = e.target as Node;
  const isInside = wrapper.contains(target) || tooltip.contains(target);
  if (!isInside && tooltip.classList.contains("visible")) {
    hideTooltip();
  }
});

// Close on Escape key
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && tooltip?.classList.contains("visible")) {
    hideTooltip();
  }
});

// ─── Existing Functions ────────────────────────────────────────────────

function markChanged(): void {
  if (saveStatus) saveStatus.textContent = "Preview settings have unsaved changes.";
}

function setDpi(value: number): void {
  if (!dpiRange || !dpiOutput) return;
  dpiRange.value = String(value);
  dpiOutput.value = `${value} DPI`;
  dpiButtons.forEach((button) => button.classList.toggle("selected", Number(button.dataset.dpi) === value));
}

dpiRange?.addEventListener("input", () => {
  setDpi(Number(dpiRange.value));
  markChanged();
});
dpiButtons.forEach((button) => button.addEventListener("click", () => {
  setDpi(Number(button.dataset.dpi));
  markChanged();
}));

segmentedControls.forEach((control) => {
  control.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      control.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      markChanged();
    });
  });
});

saveButton?.addEventListener("click", () => {
  if (!saveStatus || !saveButton) return;
  try {
    localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify({
      dpi: Number(dpiRange?.value ?? 1600),
      polling: document.querySelector('[data-control="polling"] .selected')?.textContent?.trim(),
      lift: document.querySelector('[data-control="lift"] .selected')?.textContent?.trim(),
      motionSync: document.querySelector<HTMLInputElement>(".toggle-row input")?.checked,
    }));
  } catch {
    saveStatus.textContent = "Settings could not be stored in this browser.";
    return;
  }
  saveButton.textContent = "Saved";
  saveStatus.textContent = "Demo settings saved in this browser.";
  window.setTimeout(() => {
    saveButton.textContent = "Save changes";
  }, 1600);
});

document.querySelector<HTMLInputElement>(".toggle-row input")?.addEventListener("change", markChanged);

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    // Close tooltip when switching panels
    hideTooltip();

    navItems.forEach((navItem) => {
      const isActive = navItem === item;
      navItem.classList.toggle("active", isActive);
      navItem.setAttribute("aria-pressed", String(isActive));
    });
    const plannedPanel = item.dataset.panel === "buttons" || item.dataset.panel === "profiles";
    const target = item.dataset.panel === "overview"
        ? document.querySelector(".device-overview")
        : document.querySelector(".settings-grid");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (previewMessage) {
      previewMessage.textContent = plannedPanel
          ? `${item.textContent} controls are planned for a future device profile.`
          : "This demo does not connect to or change a real device.";
    }
  });
});