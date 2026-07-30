import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("OpenMouse could not find its application root.");
}

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function preferredTheme(): ThemePreference {
  let savedTheme: string | null = null;

  try {
    savedTheme = localStorage.getItem("openmouse-theme-preference");
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

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
  const theme = resolvedTheme(themePreference);
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#09090b" : "#ffffff");

  try {
    localStorage.setItem("openmouse-theme-preference", themePreference);
  } catch {
    // The theme still works for the current page when storage is unavailable.
  }
}

applyTheme();

app.innerHTML = `
  <header class="site-header">
    <a class="wordmark" href="#top" aria-label="OpenMouse home">OpenMouse</a>
    <div class="header-actions">
      <span class="status-badge">In development</span>
      <a class="demo-link" href="/demo.html">UI demo</a>
      <a class="github-link" href="https://github.com/snekxs/openmouse" target="_blank" rel="noreferrer" aria-label="OpenMouse on GitHub">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7A11.5 11.5 0 0 0 8.4 23c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.8 3.7 17 4 17 4c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.8 5.4-5.5 5.7.4.4.8 1.1.8 2.2v4.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7Z"/></svg>
        GitHub <span aria-hidden="true">↗</span>
        <span id="github-stars" class="github-stars" aria-label="GitHub stars" hidden></span>
      </a>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch color mode"></button>
    </div>
  </header>

  <main id="top">
    <section class="hero">
      <p class="eyebrow">ONE PLACE FOR EVERY MOUSE</p>
      <h1>All your mice.<br><em>One control panel.</em></h1>
      <p class="hero-copy">OpenMouse is a browser-based app for managing supported gaming mice in one place. Connect a mouse, see its settings, and make changes without switching between vendor utilities.</p>
      <div class="hero-actions">
        <a class="button" href="/demo.html">Preview the interface <span aria-hidden="true">→</span></a>
        <a class="text-link" href="#roadmap">See the roadmap <span aria-hidden="true">↓</span></a>
      </div>
      <div class="compatibility" aria-label="Browser compatibility">
        <span>Browser support</span>
        <ul>
          <li class="supported" data-browser="chrome">Chrome</li>
          <li class="supported" data-browser="edge">Edge</li>
          <li class="unsupported" data-browser="firefox">Firefox</li>
          <li class="unsupported" data-browser="safari">Safari</li>
        </ul>
        <p id="browser-support-message" aria-live="polite">Checking your browser for WebHID support…</p>
      </div>
    </section>

    <section class="promise" aria-label="OpenMouse principles">
      <article>
        <span class="number">01</span>
        <h2>Browser-based</h2>
        <p>The planned app uses WebHID to communicate with compatible devices directly from a secure website.</p>
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

    <section class="how-it-works" aria-labelledby="how-title">
      <div class="section-heading">
        <p class="eyebrow">HOW IT WORKS</p>
        <h2 id="how-title">From connected to configured.</h2>
      </div>
      <ol class="steps">
        <li>
          <span class="number">01</span>
          <h3>Connect your mouse</h3>
          <p>Plug in a supported mouse and open OpenMouse in a compatible browser.</p>
        </li>
        <li>
          <span class="number">02</span>
          <h3>Grant permission</h3>
          <p>Choose your device in the browser prompt. Access is only granted after you approve it.</p>
        </li>
        <li>
          <span class="number">03</span>
          <h3>Adjust its settings</h3>
          <p>View the available controls and change verified settings from one consistent interface.</p>
        </li>
      </ol>
    </section>

    <section class="devices" aria-labelledby="devices-title">
      <div class="section-heading">
        <p class="eyebrow">FIRST DEVICES</p>
        <h2 id="devices-title">The first supported mice.</h2>
        <p class="section-copy">Support starts with these models. If other mice from the same brand use similar commands, they may be added more quickly.</p>
      </div>
      <div class="device-list">
        <article class="device-card"><p>Logitech</p><h3>Superlight 2C</h3><span>Planned</span></article>
        <article class="device-card"><p>Pulsar</p><h3>X2 CrazyLight</h3><span>Planned</span></article>
        <article class="device-card"><p>Endgame Gear</p><h3>OP1 8K</h3><span>Planned</span></article>
        <article class="device-card"><p>Ninjutso</p><h3>Sora V3</h3><span>Planned</span></article>
      </div>
    </section>

    <section id="roadmap" class="roadmap" aria-labelledby="roadmap-title">
      <div class="section-heading">
        <p class="eyebrow">ROADMAP</p>
        <h2 id="roadmap-title">A shared control panel, built carefully.</h2>
      </div>
      <ol>
        <li><span>Now</span><div><h3>Device explorer</h3><p>Identify compatible HID interfaces and understand how each mouse communicates.</p></div></li>
        <li><span>Available</span><div><h3>Device control</h3><p>View battery level, firmware, DPI, polling rate, and other supported settings.</p></div></li>
        <li><span>Planned</span><div><h3>Offline-ready app</h3><p>Cache the control panel and device definitions after the first online visit, so supported mice can be managed without an internet connection.</p></div></li>
        <li><span>Later</span><div><h3>Verified controls</h3><p>Enable supported settings only after they have a known command and a reliable read-back check.</p></div></li>
      </ol>
    </section>

    <section class="closing">
      <p class="eyebrow">OPEN SOURCE SPIRIT</p>
      <h2>Built one device at a time.</h2>
      <p>OpenMouse is at an early stage. It starts with the hardware currently available, then expands one supported device at a time.</p>
    </section>

    <section class="discord-community" aria-labelledby="discord-title">
      <div class="discord-intro">
        <p class="eyebrow">JOIN THE COMMUNITY</p>
        <h2 id="discord-title">Follow OpenMouse from the start.</h2>
        <p>Join the OpenMouse Discord to test what’s next, follow development, and help shape device support.</p>
        <a class="discord-cta" href="https://discord.gg/5Vw9uQV3xB" target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.5 5.3A17.2 17.2 0 0 0 15.2 4l-.5 1a16 16 0 0 0-5.3 0l-.6-1a17.5 17.5 0 0 0-4.3 1.3C1.8 9.4 1 13.4 1.3 17.4a17.4 17.4 0 0 0 5.3 2.7l1.3-1.8a11 11 0 0 1-2-1l.5-.4a12.3 12.3 0 0 0 11.2 0l.6.4c-.7.4-1.3.7-2 1l1.3 1.8a17.4 17.4 0 0 0 5.3-2.7c.4-4.6-.8-8.5-3.3-12.1ZM8.3 15.2c-1 0-1.9-1-1.9-2.2s.9-2.2 1.9-2.2 1.9 1 1.9 2.2-.9 2.2-1.9 2.2Zm7.4 0c-1 0-1.9-1-1.9-2.2s.9-2.2 1.9-2.2 1.9 1 1.9 2.2-.9 2.2-1.9 2.2Z"/></svg>
          Join the Discord <span aria-hidden="true">↗</span>
        </a>
      </div>
      <ul class="discord-benefits">
        <li><span>01</span><div><h3>Early access</h3><p>Try beta features and new device support before wider releases.</p></div></li>
        <li><span>02</span><div><h3>Progress updates</h3><p>Follow development, changelogs, milestones, and project updates.</p></div></li>
        <li><span>03</span><div><h3>Help shape OpenMouse</h3><p>Request mice you’d like supported, share feedback, and find opportunities to contribute to the project.</p></div></li>
      </ul>
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
          <summary>Why won’t OpenMouse work in Firefox?</summary>
          <p>Firefox does not currently implement WebHID, the browser API OpenMouse needs to communicate with a mouse. Mozilla currently lists the proposal as negative, so use a Chromium-based browser such as Chrome or Edge for now. <a href="https://github.com/mozilla/standards-positions/pull/193" target="_blank" rel="noreferrer">Read Mozilla’s discussion on GitHub <span aria-hidden="true">↗</span></a></p>
        </details>
        <details>
          <summary>Can OpenMouse update firmware?</summary>
          <p>No. Firmware flashing and other high-risk device actions are intentionally outside the project’s scope.</p>
        </details>
      </div>
    </section>
  </main>

  <footer>
    <span>OpenMouse · One place to manage supported mice.</span>
    <div class="footer-links">
      <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer">Follow @openmouseapp on X <span aria-hidden="true">↗</span></a>
      <a href="https://github.com/snekxs/openmouse" target="_blank" rel="noreferrer">View source and contribute on GitHub <span aria-hidden="true">↗</span></a>
    </div>
  </footer>
`;

const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
const githubStars = document.querySelector<HTMLSpanElement>("#github-stars");
const browserSupportMessage = document.querySelector<HTMLParagraphElement>("#browser-support-message");

function currentBrowser(): { id: string; name: string } {
  const userAgent = navigator.userAgent;

  if (/\bEdg\//.test(userAgent)) return { id: "edge", name: "Edge" };
  if (/\bFirefox\//.test(userAgent)) return { id: "firefox", name: "Firefox" };
  if (/\bChrome\//.test(userAgent) && !/\b(?:OPR|Edg)\//.test(userAgent)) {
    return { id: "chrome", name: "Chrome" };
  }
  if (/\bSafari\//.test(userAgent) && !/\b(?:Chrome|Chromium|CriOS|FxiOS|EdgiOS)\//.test(userAgent)) {
    return { id: "safari", name: "Safari" };
  }

  return { id: "other", name: "Your browser" };
}

function updateBrowserSupport(): void {
  if (!browserSupportMessage) return;

  const browser = currentBrowser();
  const supportsWebHid = "hid" in navigator;
  const currentBrowserBadge = document.querySelector<HTMLElement>(
    `.compatibility [data-browser="${browser.id}"]`,
  );

  currentBrowserBadge?.classList.add("current");
  currentBrowserBadge?.setAttribute("aria-current", "true");

  if (supportsWebHid) {
    browserSupportMessage.className = "browser-result compatible";
    browserSupportMessage.textContent = `You’re using ${browser.name}. Your browser supports WebHID and is compatible with OpenMouse.`;
  } else {
    browserSupportMessage.className = "browser-result incompatible";
    browserSupportMessage.textContent = `You’re using ${browser.name}. Your browser does not support WebHID, so OpenMouse won’t be able to connect to your mouse. Use Chrome or Edge on desktop.`;
  }
}

updateBrowserSupport();

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

async function updateGithubStars(): Promise<void> {
  if (!githubStars) {
    return;
  }

  try {
    const response = await fetch("https://api.github.com/repos/snekxs/openmouse", {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) {
      return;
    }

    const repository = await response.json() as { stargazers_count?: number };

    if (typeof repository.stargazers_count === "number") {
      githubStars.textContent = `★ ${new Intl.NumberFormat().format(repository.stargazers_count)}`;
      githubStars.hidden = false;
    }
  } catch {
    // The GitHub link remains usable when its public API is unavailable.
  }
}

void updateGithubStars();

const revealTargets = document.querySelectorAll<HTMLElement>(
  ".promise, .how-it-works, .devices, .roadmap, .closing, .discord-community, .faq",
);

if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  revealTargets.forEach((target) => target.classList.add("reveal"));

  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  revealTargets.forEach((target) => revealObserver.observe(target));
}
