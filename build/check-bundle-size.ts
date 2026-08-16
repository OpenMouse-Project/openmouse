import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES: Record<string, number> = {
  // Raised from 103 kB for the interface themes: NieR: Automata and Liquid
  // Glass each ship their own token block, and the liquid-glass material
  // layer (SVG displacement filters plus their component rules) adds the
  // largest share. The measured bundle is 153.7 kB; 175 kB adds headroom for
  // the Developer Hall of Fame page (~15 kB of animated card and hero
  // styles that load only on /contributors.html). Raised again to 177 kB for
  // the Bridge "Native devices" panel (per-device rows, polling control, and
  // the Enable/Remove-driver buttons); measured 175.5 kB.
  ".css": 177_000,
  // Raised from 510 kB for Bridge discovery, profile editing, automatic
  // reconnection, and recent device support, which have since grown further
  // with the supported-device page and MX Master remap controls. Preview
  // fixtures retain their separate allowance below; the measured aggregate
  // is 573.4 kB with them, plus the ~11 kB Hall of Fame chunk.
  //
  // Raised again from 590 kB (+2 kB) for native Bridge device control: the
  // /v1/devices client and the "Native devices" panel that lists Bridge-
  // reached mice (e.g. the Attack Shark X11, unreachable over WebHID) and
  // sets their polling rate. Measured aggregate 609.9 kB.
  ".js": 612_000,
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

const budgets = {
  ...BUDGET_BYTES,
  ".js": BUDGET_BYTES[".js"] + (found.some(({ name }) => name.startsWith("preview-fixtures-")) ? 18_000 : 0),
};

const totals = new Map<string, number>();
for (const { ext, bytes } of found) totals.set(ext, (totals.get(ext) ?? 0) + bytes);

let failed = false;
for (const [ext, budget] of Object.entries(budgets)) {
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
