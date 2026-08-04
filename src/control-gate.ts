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
    <main class="access-shell">
      <header class="access-header">
        <a class="demo-wordmark" href="/" aria-label="Back to OpenMouse">OpenMouse</a>
        <span class="build-meta">${__BUILD_CHANNEL__.toUpperCase()} · v${__APP_VERSION__}</span>
      </header>
      <section class="access-gate" aria-labelledby="access-title">
        <div class="access-mark" aria-hidden="true">OM</div>
        <p class="overline">Private control panel</p>
        <h1 id="access-title">Enter your license.</h1>
        <p>Use your OpenMouse license code to unlock verified device controls in this browser.</p>
        <form id="access-form" class="access-form">
          <label for="license-key">License code</label>
          <input id="license-key" type="text" autocomplete="off" spellcheck="false" autofocus required />
          <button type="submit">Unlock control panel</button>
          <output aria-live="polite">${escapeMarkup(message)}</output>
        </form>
      </section>
      <p class="access-footnote">Your code is used only to validate access to the private control panel.</p>
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
