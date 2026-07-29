import "./demo.css";

const demoApp = document.querySelector<HTMLDivElement>("#demo-app");

if (!demoApp) {
  throw new Error("OpenMouse could not find the demo application root.");
}

demoApp.innerHTML = `
  <div class="demo-shell">
    <aside class="sidebar">
      <a class="demo-wordmark" href="/" aria-label="Back to OpenMouse">OpenMouse</a>
      <div class="device-label">CONNECTED DEVICE</div>
      <button class="device-select" type="button" aria-label="Selected device">
        <span class="device-dot"></span>
        <span><strong>Superlight 2C</strong><small>Logitech · Connected</small></span>
        <span aria-hidden="true">⌄</span>
      </button>
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
        <p>This demo does not connect to or change a real device.</p>
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

        <article class="setting-card">
          <div class="setting-heading">
            <div><p>POLLING RATE</p><h2>Report frequency</h2></div>
            <span class="info">?</span>
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

function setDpi(value: number): void {
  if (!dpiRange || !dpiOutput) return;
  dpiRange.value = String(value);
  dpiOutput.value = `${value} DPI`;
  dpiButtons.forEach((button) => button.classList.toggle("selected", Number(button.dataset.dpi) === value));
}

dpiRange?.addEventListener("input", () => setDpi(Number(dpiRange.value)));
dpiButtons.forEach((button) => button.addEventListener("click", () => setDpi(Number(button.dataset.dpi))));

segmentedControls.forEach((control) => {
  control.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      control.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
});

saveButton?.addEventListener("click", () => {
  if (!saveStatus || !saveButton) return;
  saveButton.textContent = "Saved";
  saveStatus.textContent = "Demo settings saved locally for this preview.";
  window.setTimeout(() => {
    saveButton.textContent = "Save changes";
  }, 1600);
});
