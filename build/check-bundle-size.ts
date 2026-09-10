import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES: Record<string, number> = {
  // Raised from 103 kB for the interface themes: NieR: Automata and Liquid
  // Glass each ship their own token block, and the liquid-glass material
  // layer (SVG displacement filters plus their component rules) added the
  // largest share. Liquid Glass was removed in the theme sync (main CSS is
  // ~104 kB again). The measured bundle is 153.7 kB; 175 kB adds headroom for
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
  // mapping code to the measured aggregate (720.5 kB). Raised to 765 kB for
  // the SteelSeries/device-support and Cloudflare R2 artwork-serve work merged
  // on dev: those land with the measured aggregate already at ~750 kB. The
  // donate page rebuild (Hall of Fame -> Support) does not drive this; its
  // rebuilt donate chunk is lighter than the old Minecraft-themed hof chunk it
  // replaced. 765 kB leaves ~15 kB of headroom over the measured aggregate.
  // Raised to 790 kB for the MCHOSE A7 V2 mouse and MagDock driver support:
  // the measured aggregate is 779.1 kB, leaving ~11 kB of headroom.
  // Raised to 800 kB for the ATK ZERO driver (AtkCards.tsx, device/atk.ts)
  // and the mouse-reported lift-off range plumbing: the measured aggregate is
  // 790.6 kB, leaving ~9 kB of headroom.
  // Raised to 895 kB for the Portuguese (pt) localization: the full
  // en+pt UI dictionary adds ~85 kB of strings to the measured aggregate
  // (883.2 kB, on top of the 800 kB budget's own ~790.8 kB baseline). The pt
  // table ships as its own lazy chunk (i18n-pt-*.js, loaded only when a
  // non-English locale is selected), so the initial load is unaffected — the
  // aggregate counts it because the check sums every emitted chunk.
  // Raised to 1,065 kB for Spanish, French, German, and Simplified Chinese:
  // each ships as its own lazy chunk (i18n-es/fr/de/zh-*.js) at ~40-55 kB,
  // loaded only when that locale is selected — none of them touch the
  // initial (English) bundle. Measured aggregate is 1,061.8 kB.
  // Raised to 1,165 kB for Japanese and Korean, same lazy-chunk pattern.
  // Measured aggregate is 1,160.9 kB.
  // Raised to 1,185 kB for Attack Shark R2 support (GearHub-V5 driver,
  // traits.ts entry, device artwork name-fallback): the measured aggregate
  // is 1,171.4 kB, leaving ~14 kB of headroom.
  // Raised to 1,250 kB for the Russian (ru) interface locale: the new
  // translation strings push the measured aggregate to 1,232.4 kB.
  // Raised to 1,290 kB for the control-app support/UI work that landed
  // together: the OpenMouse AI chat overlay (AiOverlay.tsx with its topic
  // flow and Discord fallback), the Discord-embed FeedbackDialog, the
  // What's New Desktop-app dialog, the desktop-style AppSidebar /
  // OverviewPage shell, and the ai.* + wn.* keys added across all nine
  // locale tables. Those add ~21 kB of strings and UI to the measured
  // aggregate (1,271.9 kB), leaving ~18 kB of headroom.
  // Raised to 1,300 kB for swapping hand-rolled icons for lucide-react,
  // tree-shaken per icon: the profile-row icons in icons.tsx
  // (enable/disable, link/unlink, rename, running/activate, refresh, trash),
  // the AppSidebar nav icons (home, mouse config, docs, what's new,
  // feedback, settings, chevron), the AiOverlay launcher/close/header
  // icons, and the OverviewPage icons (workspace tabs, device-tile stats,
  // back/share/plus controls, and the add-device mouse/keyboard glyphs,
  // which replace their old hand-drawn illustrations). The measured
  // aggregate is 1,290.4 kB, leaving ~10 kB of headroom.
  // Raised to 1,310 kB for the crowd-sourced device artwork system:
  // ArtworkUploadDialog.tsx (drag-drop upload UI with verification
  // states), artwork-verification.ts (canvas-based heuristic analysis),
  // artwork-storage.ts (R2 API fetch + localStorage cache), Cloudflare
  // Functions for R2 list/upload endpoints, and artwork.* i18n keys
  // across all nine locale tables. Measured aggregate is ~1,305.5 kB.
  // Raised to 1,345 kB for the in-app Mouse Test page: MouseTestPage.tsx
  // (live polling-rate sampler, rolling chart canvas, DPI/battery device
  // card, button tester), its Activity nav icon, and the test.* i18n keys
  // across all nine locale tables. Measured aggregate is ~1,329.5 kB.
  // Raised to 1,370 kB for the HyperX and Incott drivers: both register in
  // registry.ts/vendors.ts, and the Incott one brings a full vendor codec
  // plus applyPulsarValue/traits/device-images wiring. Measured aggregate
  // is 1,351.0 kB, leaving ~19 kB of headroom.
  ".js": 1_370_000,
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
