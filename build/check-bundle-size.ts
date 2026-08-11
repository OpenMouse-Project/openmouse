import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES: Record<string, number> = {
  // Raised from 47 kB for the concept-18 workspace redesign: the persistent
  // product panel, status strip, section tabs, stacked cards, responsive
  // layout, and fixed apply bar are all implemented in the existing CSS
  // bundle without adding a UI framework or runtime dependency.
  // Raised from 54 kB for the in-app lighting colour picker: the SV panel,
  // hue bar, drag thumbs, swatch, and hex field in the dedicated Lighting tab.
  // Raised from 55.5 kB for the standalone Mouse Check diagnostics page.
  // Raised from 61.5 kB for the theme system: the Hatsune Miku palette and the
  // Catppuccin family (Mocha, Macchiato, Frappé). Each variant ships its raw
  // palette plus a shared semantic token mapping, and the whole family shares
  // one block of component-level overrides — no UI framework was added.
  ".css": 72_000,
  // Raised from 280 kB for the production Logitech onboard-profile codec,
  // guarded flash editor, verification exporter, upstream Finalmouse driver,
  // the dedicated Viper Mini protocol driver, Viper V3 sleep/low-power plus
  // asymmetric lift-off protocol and controls, Keychron Nape Pro, and the
  // moddoMOUSE wired/wireless config driver, plus the Teevolution Compx codec
  // and staged Terra Pro controls, plus Logi Bolt / MX Master 3S transport.
  // Raised from 390 kB for the Ninjutso NinjaForce integration: Sora V2 uses
  // the legacy settings-block protocol, while Sora V3 and TEN use the current
  // command protocol. No framework or runtime dependency was added.
  // Raised from 410 kB for capability-gated NinjaForce performance controls,
  // multi-stage DPI selection, and Sora V3 receiver lighting read/write UI.
  // Raised from 425 kB for the in-app lighting colour picker: pointer-event
  // binding, canvas-drawn SV/hue surfaces, and hex/swatch sync.
  // Raised from 427 kB for the second, dedicated Lighting-tab card: the
  // render path now drives both the Advanced-tab card and the new tab.
  // Raised from 429 kB for the dedicated Razer Cobra driver: the protocol
  // registry now bundles the Cobra HID client, its extended-matrix lighting
  // payloads, and the Cobra picker filter alongside the other Razer drivers.
  // Protocol tests and preview fixtures remain unbundled.
  // Raised from 435 kB for Mouse Check's HID inventory UI and reuse of the
  // protocol package's validated Razer request/response codec.
  // Raised from 444 kB after refreshing the protocol lock for Mouse Dock Pro,
  // the Nape Pro codec tests/limits, and hardware-verified Razer corrections.
  // Raised from 446 kB for the theme system: the persisted theme list and the
  // display-name → dataset slug mapping for the Miku and Catppuccin themes.
  ".js": 446_000,
};

const ASSETS = join("dist", "assets");

function bundles(): { name: string; ext: string; bytes: number }[] {
  return readdirSync(ASSETS)
    .filter((name) => name.endsWith(".css") || name.endsWith(".js"))
    .map((name) => ({
      name,
      ext: name.slice(name.lastIndexOf(".")),
      bytes: statSync(join(ASSETS, name)).size,
    }));
}

const found = bundles();
if (found.length === 0) {
  console.error(`No bundles in ${ASSETS}. Run "npm run build" first.`);
  process.exit(1);
}

const totals = new Map<string, number>();
for (const { ext, bytes } of found) totals.set(ext, (totals.get(ext) ?? 0) + bytes);

let failed = false;
for (const [ext, budget] of Object.entries(BUDGET_BYTES)) {
  const bytes = totals.get(ext) ?? 0;
  const percent = Math.round((bytes / budget) * 100);
  const label = `${ext.slice(1).toUpperCase().padEnd(3)} ${String(bytes).padStart(7)} / ${budget} bytes (${percent}%)`;
  if (bytes > budget) {
    failed = true;
    console.error(`over budget  ${label}`);
  } else {
    console.log(`ok           ${label}`);
  }
}

if (failed) {
  console.error("");
  console.error("A bundle grew past its budget. Justify the growth and raise BUDGET_BYTES,");
  console.error("or find what was added. Adding a CSS framework once cost 19 kB unnoticed.");
  process.exit(1);
}
