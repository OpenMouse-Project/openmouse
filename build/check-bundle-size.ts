import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES: Record<string, number> = {
  // Raised from 103 kB for the interface themes: NieR: Automata and Liquid
  // Glass each ship their own token block, and the liquid-glass material
  // layer (SVG displacement filters plus their component rules) adds the
  // largest share. The measured bundle is 153.7 kB; 175 kB adds headroom for
  // the Developer Hall of Fame page (~15 kB of animated card and hero
  // styles that load only on /donate.html). Raised to 180 kB in the
  // same pass as the 175 kB target, then to 195 kB for the Minecraft Hall of
  // Fame overhaul: the blocky token block (plank textures, bevels, item-frame
  // avatars), the animated day/night scene (sun/moon/star/cloud/bonfire
  // keyframes) and the credits-style quote widget push the measured CSS
  // aggregate to 183.7 kB.
  ".css": 195_000,
  // Raised from 510 kB for Bridge discovery, profile editing, automatic
  // reconnection, and recent device support, which have since grown further
  // with the supported-device page and MX Master remap controls. Preview
  // fixtures retain their separate allowance below; the measured aggregate
  // is 573.4 kB with them, plus the ~11 kB Hall of Fame chunk. Raised again
  // from 590 kB for the Razer button-mapping card and its codec: the measured
  // aggregate is 588.2 kB, which left under 2 kB of headroom. Raised again to
  // 610 kB for the Pulsar XS-1 feature-report driver and 4K receiver support
  // (mouse-protocol 3c3a445): the X3 family codec plus the 4K DPI/polling work
  // adds ~1.3 kB to the measured aggregate. Raised to 632 kB for the Attack
  // Shark GearHub (0x25a7) protocol routed to 0x1d57 VID devices (+1.6 kB).
  // Raised to 700 kB for four new drivers landing together: Keychron M6,
  // Keychron Nape Pro (layer/keymap/orientation controls), Glorious Model O
  // 2/I 2 lighting, and SteelSeries Rival 3 Gen 1. Measured aggregate is
  // 689.0 kB, which leaves about 11 kB of headroom. Raised to 730 kB for the
  // device artwork pass: ~20 new product models mapped to transparent top-view
  // renders in device-images.ts (PID keys plus name fallbacks) add ~22 kB of
  // mapping code to the measured aggregate (720.5 kB), and 730 kB leaves headroom.
  ".js": 730_000,
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
