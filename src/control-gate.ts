import "./control.css";

const app = document.querySelector<HTMLDivElement>("#control-app");
if (!app) throw new Error("OpenMouse could not find the license application root.");
const appRoot = app;

function escapeMarkup(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

function renderGate(message = ""): void {
  appRoot.innerHTML = `
    <style>
      .build-identity { display:flex;align-items:center;gap:.65rem;margin-bottom:5rem }
      .build-identity .demo-wordmark { margin-bottom:0 }
      .build-badge { display:inline-flex;align-items:center;min-height:1.35rem;padding:.2rem .45rem;border:1px solid rgb(105 210 141 / 35%);border-radius:999px;background:rgb(105 210 141 / 9%);color:#8be3a9;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.52rem;font-weight:700;letter-spacing:.07em;line-height:1;white-space:nowrap }
    </style>
    <main class="access-gate">
      <div class="build-identity">
        <a class="demo-wordmark" href="/">OpenMouse</a>
        <span class="build-badge">${__BUILD_CHANNEL__.toUpperCase()} · v${__APP_VERSION__}</span>
      </div>
      <p class="overline">PRIVATE CONTROL PANEL</p>
      <h1>Enter your license.</h1>
      <p>Use your OpenMouse license code to unlock device control.</p>
      <form id="access-form" class="access-form">
        <label for="license-key">License code</label>
        <input id="license-key" type="text" autocomplete="off" spellcheck="false" autofocus required />
        <button type="submit">Unlock control panel</button>
        <output aria-live="polite">${escapeMarkup(message)}</output>
      </form>
    </main>`;

  document.querySelector<HTMLFormElement>("#access-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#license-key");
    const button = document.querySelector<HTMLButtonElement>("#access-form button");
    if (!input || !button) return;
    button.disabled = true;
    button.textContent = "Checking license…";

    try {
      const response = await fetch("/api/license/activate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseCode: input.value.trim() }),
      });
      const result = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        renderGate(result.message ?? "Unable to activate this license.");
        return;
      }
      window.location.assign("/control-app");
    } catch {
      renderGate("Unable to contact the license service.");
    }
  });
}

renderGate();
