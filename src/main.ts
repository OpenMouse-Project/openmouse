import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("OpenMouse could not find its application root.");
}

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function preferredTheme(): ThemePreference {
  const savedTheme = localStorage.getItem("openmouse-theme-preference");

  if (savedTheme === "system" || savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return "system";
}

function resolvedTheme(preference: ThemePreference): Theme {
  return preference === "system" ? (colorSchemeQuery.matches ? "dark" : "light") : preference;
}

let themePreference = preferredTheme();

function applyTheme(): void {
  document.documentElement.dataset.theme = resolvedTheme(themePreference);
  localStorage.setItem("openmouse-theme-preference", themePreference);
}

applyTheme();

app.innerHTML = `
  <header class="site-header">
    <a class="wordmark" href="#top" aria-label="OpenMouse home">OpenMouse</a>
    <div class="header-actions">
      <span class="status-badge">In development</span>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch color mode"></button>
    </div>
  </header>

  <main id="top">
    <section class="hero">
      <p class="eyebrow">ONE PLACE FOR EVERY MOUSE</p>
      <h1>All your mice.<br><em>One control panel.</em></h1>
      <p class="hero-copy">OpenMouse is a browser-based app for managing supported gaming mice in one place. Connect a mouse, see its settings, and make changes without switching between vendor utilities.</p>
      <a class="button" href="#roadmap">See what’s coming <span aria-hidden="true">↓</span></a>
      
    </section>

    <section class="promise" aria-label="OpenMouse principles">
      <article>
        <span class="number">01</span>
        <h2>Browser-based</h2>
        <p>The planned app uses WebHID to communicate with compatible devices from a secure website. No account is planned.</p>
      </article>
      <article>
        <span class="number">02</span>
        <h2>Limited to safe settings</h2>
        <p>Only documented settings will be available. Firmware flashing, raw-memory access, and bootloader actions are not part of the project.</p>
      </article>
      <article>
        <span class="number">03</span>
        <h2>One interface</h2>
        <p>Each supported mouse will use the same clear layout, while showing only the settings that mouse provides.</p>
      </article>
    </section>

    <section class="devices" aria-labelledby="devices-title">
      <div class="section-heading">
        <p class="eyebrow">FIRST DEVICES</p>
        <h2 id="devices-title">The first supported mice.</h2>
      </div>
      <div class="device-list">
        <article class="device-card"><p>Logitech</p><h3>Superlight 2C</h3><span>Planned</span></article>
        <article class="device-card"><p>Pulsar</p><h3>X2 CrazyLight</h3><span>Planned</span></article>
        <article class="device-card"><p>Endgame Gear</p><h3>OP1 8K</h3><span>Planned</span></article>
      </div>
    </section>

    <section id="roadmap" class="roadmap" aria-labelledby="roadmap-title">
      <div class="section-heading">
        <p class="eyebrow">ROADMAP</p>
        <h2 id="roadmap-title">A shared control panel, built carefully.</h2>
      </div>
      <ol>
        <li><span>Now</span><div><h3>Device explorer</h3><p>Identify compatible HID interfaces and understand how each mouse communicates.</p></div></li>
        <li><span>Next</span><div><h3>Read-only status</h3><p>Surface safe information such as battery level, firmware version, DPI, and polling rate.</p></div></li>
        <li><span>Later</span><div><h3>Verified controls</h3><p>Enable supported settings only after they have a known command and a reliable read-back check.</p></div></li>
      </ol>
    </section>

    <section class="closing">
      <p class="eyebrow">OPEN SOURCE SPIRIT</p>
      <h2>Built one device at a time.</h2>
      <p>OpenMouse is at an early stage. It starts with the hardware currently available, then expands one supported device at a time.</p>
    </section>

    <section class="faq" aria-labelledby="faq-title">
      <div class="section-heading">
        <p class="eyebrow">FAQ</p>
        <h2 id="faq-title">A few quick answers.</h2>
      </div>
      <div class="faq-list">
        <details>
          <summary>Does OpenMouse work with every mouse?</summary>
          <p>Not yet. Support is added one device at a time so every available setting can be tested and verified.</p>
        </details>
        <details>
          <summary>Do I need to install anything?</summary>
          <p>The app is planned to run in a compatible browser using WebHID, without a separate desktop utility.</p>
        </details>
        <details>
          <summary>Will I need an account?</summary>
          <p>No account is planned. Your mouse settings stay between your browser and your device.</p>
        </details>
        <details>
          <summary>Can OpenMouse update firmware?</summary>
          <p>No. Firmware flashing and other high-risk device actions are intentionally outside the project’s scope.</p>
        </details>
      </div>
    </section>
  </main>

  <footer>OpenMouse · One place to manage supported mice.</footer>
`;

const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");

if (!themeToggle) {
  throw new Error("OpenMouse could not initialize its theme toggle.");
}

const toggle = themeToggle;

function updateThemeToggle(): void {
  toggle.textContent = `Theme: ${themePreference[0].toUpperCase()}${themePreference.slice(1)}`;
  toggle.setAttribute("aria-label", "Change color theme");
}

toggle.addEventListener("click", () => {
  themePreference = themePreference === "system" ? "light" : themePreference === "light" ? "dark" : "system";
  applyTheme();
  updateThemeToggle();
});

colorSchemeQuery.addEventListener("change", () => {
  if (themePreference === "system") {
    applyTheme();
  }
});

updateThemeToggle();
