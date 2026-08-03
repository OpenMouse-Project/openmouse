type IconName = "arrow" | "browser" | "check" | "cursor" | "discord" | "github" | "mouse" | "shield" | "sliders";

function icon(name: IconName): string {
  const paths: Record<IconName, string> = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    cursor: '<path d="m5 4 6.5 16 2.3-6.2L20 11.5 5 4Z"/>',
    discord: '<path d="M8.2 7.2a9.7 9.7 0 0 1 7.6 0M7 16.4c3.4 1.7 6.6 1.7 10 0M8.8 13h.01M15.2 13h.01"/><path d="M7 5.8C4.8 8.6 4 11.7 4.4 15.5A13.8 13.8 0 0 0 8 17.4l.9-1.3M17 5.8c2.2 2.8 3 5.9 2.6 9.7a13.8 13.8 0 0 1-3.6 1.9l-.9-1.3"/>',
    github: '<path d="M9 19c-4 1.2-4-2-5-2m10 4v-3.1c0-.9.1-1.3-.4-1.9 2.8-.3 5.7-1.4 5.7-6.2 0-1.2-.5-2.4-1.3-3.3.1-.3.6-1.6-.1-3.2 0 0-1.1-.3-3.5 1.3a12.2 12.2 0 0 0-6.4 0C5.6 3 4.5 3.3 4.5 3.3c-.7 1.6-.2 2.9-.1 3.2A4.8 4.8 0 0 0 3 9.8C3 14.6 6 15.7 8.8 16c-.4.5-.6 1-.6 1.9V21"/>',
    mouse: '<path d="M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6Z"/><path d="M12 3v6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.6 2.8 7.8 7 10 4.2-2.2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>',
  };

  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export function renderLandingPage(): string {
  return `
    <header class="site-header">
      <a class="wordmark" href="#top" aria-label="OpenMouse home">
        ${icon("mouse")}
        <span>OpenMouse</span>
      </a>
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#devices">Devices</a>
        <a href="#supported-mice">Supported mice</a>
        <a href="#roadmap">Roadmap</a>
        <a href="#faq">FAQ</a>
      </nav>
      <div class="header-actions">
        <a class="github-link" href="https://github.com/snekxs/openmouse" target="_blank" rel="noreferrer" aria-label="OpenMouse on GitHub">
          ${icon("github")}
          <span>GitHub</span>
          <span id="github-stars" class="github-stars" aria-label="GitHub stars" hidden></span>
        </a>
        <a class="header-cta" href="/demo.html">Preview interface ${icon("arrow")}</a>
      </div>
    </header>

    <main id="top">
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy-block">
          <div class="launch-notice" role="status">
            <span class="launch-notice-dot" aria-hidden="true"></span>
            Early access coming soon
          </div>
          <h1 id="hero-title">All your mice.<br><span>One control panel.</span></h1>
          <p class="hero-copy">OpenMouse brings verified gaming-mouse settings into one clear browser-based workspace. No separate utility for every device.</p>
          <div class="hero-actions">
            <a class="button button-primary" href="/demo.html">Preview the interface ${icon("arrow")}</a>
            <a class="button button-secondary" href="#roadmap">See the roadmap</a>
          </div>
          <div class="compatibility" aria-label="Browser compatibility">
            <span class="compatibility-label">Browser support</span>
            <ul>
              <li class="supported" data-browser="chrome">Chrome</li>
              <li class="supported" data-browser="edge">Edge</li>
              <li class="unsupported" data-browser="firefox">Firefox</li>
              <li class="unsupported" data-browser="safari">Safari</li>
            </ul>
          </div>
        </div>

        <div class="product-stage" aria-label="OpenMouse control panel preview">
          <div class="stage-orbit stage-orbit-one" aria-hidden="true"></div>
          <div class="stage-orbit stage-orbit-two" aria-hidden="true"></div>
          <div class="device-visual">
            <span class="device-caption">Active device</span>
            <img src="/superlight-2c-black.png" alt="Black Logitech Superlight gaming mouse" />
            <div class="device-meta">
              <span>Superlight 2C</span>
              <span class="connected"><i></i> Connected</span>
            </div>
          </div>
          <div class="control-preview" aria-hidden="true">
            <div class="preview-sidebar">
              <span class="preview-logo">OM</span>
              <div class="preview-nav">
                <span class="active">${icon("sliders")}</span>
                <span>${icon("mouse")}</span>
                <span>${icon("shield")}</span>
              </div>
              <span>${icon("cursor")}</span>
            </div>
            <div class="preview-main">
              <div class="preview-topbar">
                <div><small>Device</small><strong>Superlight 2C</strong></div>
                <span class="preview-status"><i></i> Connected</span>
              </div>
              <div class="preview-content">
                <div class="preview-heading"><small>Performance</small><strong>Fine-tune your mouse</strong></div>
                <div class="preview-card preview-dpi">
                  <div><small>DPI sensitivity</small><strong>1600 <em>DPI</em></strong></div>
                  <span class="preview-profile">Profile 2</span>
                  <div class="preview-range"><i></i></div>
                  <div class="range-labels"><span>100</span><span>25,600</span></div>
                </div>
                <div class="preview-grid">
                  <div class="preview-card"><small>Polling rate</small><strong>1000 <em>Hz</em></strong></div>
                  <div class="preview-card"><small>Battery</small><strong>87 <em>%</em></strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="principles" aria-label="OpenMouse principles">
        <article>
          <span class="icon-box">${icon("browser")}</span>
          <div><h2>Browser-based</h2><p>WebHID connects to compatible devices directly from a secure website.</p></div>
        </article>
        <article>
          <span class="icon-box">${icon("shield")}</span>
          <div><h2>Safe by design</h2><p>Only documented settings are available. Firmware and bootloader actions stay out of scope.</p></div>
        </article>
        <article>
          <span class="icon-box">${icon("sliders")}</span>
          <div><h2>One interface</h2><p>Every supported mouse uses the same clear layout, showing only what that device provides.</p></div>
        </article>
      </section>

      <section id="how-it-works" class="how-it-works section-block" aria-labelledby="how-title">
        <div class="section-heading">
          <p class="eyebrow">How it works</p>
          <h2 id="how-title">From connected<br><span>to configured.</span></h2>
          <p>Three steps. No installer, no account, and no hunting through a different utility for every mouse.</p>
        </div>
        <ol class="steps">
          <li><span class="step-index">01</span><span class="icon-box">${icon("mouse")}</span><h3>Connect your mouse</h3><p>Plug in a supported mouse and open OpenMouse in a compatible browser.</p></li>
          <li><span class="step-index">02</span><span class="icon-box">${icon("cursor")}</span><h3>Grant permission</h3><p>Choose your device in the browser prompt. Access begins only after you approve it.</p></li>
          <li><span class="step-index">03</span><span class="icon-box">${icon("sliders")}</span><h3>Adjust its settings</h3><p>View available controls and change verified settings from one consistent interface.</p></li>
        </ol>
      </section>

      <section id="devices" class="devices section-block" aria-labelledby="devices-title">
        <div class="section-heading section-heading-row">
          <div><p class="eyebrow">More mice, one app</p><h2 id="devices-title">Your favorite brands,<br><span>together.</span></h2></div>
          <p>OpenMouse is growing support across the gaming mouse ecosystem, one verified device at a time.</p>
        </div>
        <div class="brand-marquee" aria-label="Gaming mouse brands">
          <div class="brand-track">
            <div class="brand-group"><span>Logitech</span><span>Razer</span><span>Pulsar</span><span>Endgame Gear</span><span>Ninjutso</span><span>More soon</span></div>
            <div class="brand-group" aria-hidden="true"><span>Logitech</span><span>Razer</span><span>Pulsar</span><span>Endgame Gear</span><span>Ninjutso</span><span>More soon</span></div>
          </div>
        </div>
      </section>

      <section id="supported-mice" class="supported-mice section-block" aria-labelledby="supported-mice-title">
        <div class="section-heading section-heading-row">
          <div>
            <p class="eyebrow">Compatibility</p>
            <h2 id="supported-mice-title">Verified on<br><span>real hardware.</span></h2>
          </div>
          <p>Every model below has been tested with OpenMouse. Available controls can vary by device and firmware revision.</p>
        </div>
        <ul class="supported-index">
          <li class="supported-brand">
            <h3>WLMouse</h3>
            <ul><li>Beast G</li><li>Beast X</li><li>Huan</li></ul>
          </li>
          <li class="supported-brand">
            <h3>Endgame Gear</h3>
            <ul><li>OP1 8K</li><li>OP1we</li></ul>
          </li>
          <li class="supported-brand">
            <h3>Pulsar</h3>
            <ul><li>X2 CrazyLight</li></ul>
          </li>
          <li class="supported-brand">
            <h3>Logitech</h3>
            <ul><li>Superlight 2C</li><li>Superlight</li></ul>
          </li>
          <li class="supported-brand">
            <h3>Orbital</h3>
            <ul><li>Pathfinder</li></ul>
          </li>
        </ul>
        <p class="support-request">Don't see your mouse? <a href="https://discord.gg/5Vw9uQV3xB" target="_blank" rel="noreferrer">Request support in Discord.</a></p>
      </section>

      <section id="roadmap" class="roadmap section-block" aria-labelledby="roadmap-title">
        <div class="section-heading section-heading-row">
          <div><p class="eyebrow">Roadmap</p><h2 id="roadmap-title">What’s next<br><span>for OpenMouse.</span></h2></div>
          <p>Reliable support grows carefully: verify the controls, test the hardware, then add the device.</p>
        </div>
        <ol class="roadmap-list">
          <li class="complete"><span class="roadmap-marker">${icon("check")}</span><span class="status-label">Available</span><div><h3>Core device controls</h3><p>Manage DPI, polling rate, battery information, and other verified settings from the browser.</p></div></li>
          <li class="current"><span class="roadmap-marker"></span><span class="status-label">In progress</span><div><h3>More supported mice</h3><p>Expand reliable support across Logitech, Pulsar, Endgame Gear, and other brands.</p></div></li>
          <li><span class="roadmap-marker"></span><span class="status-label">Next</span><div><h3>Offline access</h3><p>Use the control panel with supported mice even when an internet connection isn’t available.</p></div></li>
        </ol>
      </section>

      <section class="closing section-block">
        <p class="eyebrow">Open source spirit</p>
        <h2>Built one device<br><span>at a time.</span></h2>
        <p>OpenMouse starts with the hardware available today, then expands through careful testing, community feedback, and open development.</p>
      </section>

      <section id="discord" class="discord-community" aria-labelledby="discord-title">
        <div class="discord-intro">
          <span class="icon-box icon-box-light">${icon("discord")}</span>
          <p class="eyebrow">Join the community</p>
          <h2 id="discord-title">Follow OpenMouse<br>from the start.</h2>
          <p>Test what’s next, follow development, and help shape support for the mice you use.</p>
          <a class="discord-cta" href="https://discord.gg/5Vw9uQV3xB" target="_blank" rel="noreferrer">Join the Discord ${icon("arrow")}</a>
        </div>
        <ul class="discord-benefits">
          <li><span>01</span><div><h3>Early access</h3><p>Try beta features and new device support before wider releases.</p></div></li>
          <li><span>02</span><div><h3>Progress updates</h3><p>Follow development, changelogs, milestones, and project updates.</p></div></li>
          <li><span>03</span><div><h3>Help shape OpenMouse</h3><p>Request mice, share feedback, and find opportunities to contribute.</p></div></li>
        </ul>
      </section>

      <section id="faq" class="faq section-block" aria-labelledby="faq-title">
        <div class="section-heading section-heading-row">
          <div><p class="eyebrow">FAQ</p><h2 id="faq-title">A few quick<br><span>answers.</span></h2></div>
          <p>The essentials about privacy, compatibility, installation, and contributing to OpenMouse.</p>
        </div>
        <div class="faq-list">
          <details><summary>Is my mouse data uploaded anywhere?</summary><p>No. OpenMouse communicates with your mouse locally through WebHID. Device information and setting changes are not uploaded to an OpenMouse server.</p></details>
          <details><summary>Does OpenMouse work with every mouse?</summary><p>Not yet. Support is added one device at a time so every available setting can be tested and verified.</p></details>
          <details><summary>Does OpenMouse work wirelessly?</summary><p>Supported mice can connect over USB or through a compatible wireless receiver. Bluetooth support is not currently available.</p></details>
          <details><summary>Do I need to install anything?</summary><p>The app is planned to run in a compatible browser using WebHID, without a separate desktop utility.</p></details>
          <details><summary>Why won’t OpenMouse work in Firefox?</summary><p>Firefox does not currently implement WebHID. Use a Chromium-based browser such as Chrome or Edge for now. <a href="https://github.com/mozilla/standards-positions/pull/193" target="_blank" rel="noreferrer">Read Mozilla’s discussion ${icon("arrow")}</a></p></details>
          <details><summary>Can OpenMouse update firmware?</summary><p>No. Firmware flashing and other high-risk device actions are intentionally outside the project’s scope.</p></details>
          <details><summary>How can I request a mouse or contribute?</summary><p>Join the <a href="https://discord.gg/5Vw9uQV3xB" target="_blank" rel="noreferrer">OpenMouse Discord</a> to request support and share feedback, or visit the <a href="https://github.com/snekxs/openmouse" target="_blank" rel="noreferrer">project on GitHub</a> to contribute.</p></details>
        </div>
      </section>
    </main>

    <footer>
      <a class="wordmark footer-wordmark" href="#top">${icon("mouse")}<span>OpenMouse</span></a>
      <span>One place to manage supported mice.</span>
      <div class="footer-links">
        <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer">X / @openmouseapp</a>
        <a href="https://github.com/snekxs/openmouse" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </footer>
  `;
}
