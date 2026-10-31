import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// JS raised from 2_800_000: posthog-js (anonymous analytics, src/platform/analytics.ts,
// the no-external build so nothing is injected past Trusted Types) added about 385 kB;
// measured 3_171_143 bytes with it.
//
// 2026-10-25 code split (issue #140): posthog, the driver registry and the
// secondary pages (settings, hardware test, games, dialogs) moved behind
// dynamic import() boundaries, so the .js total now spans the initial chunk
// plus lazy chunks. MAIN_CHUNK_BUDGET_BYTES bounds main-*.js — the bytes the
// first paint waits on — so new drivers landing in the registry grow the lazy
// chunk, not the initial load. The total budget is unchanged: shipped bytes
// still count, only later.
// 2026-10-27: The locally linked keyboard-protocol Wooting driver and its
// panel (default and per-key actuation save, keyboard map) take total JS past the old 3.2 MB cap. Measured: 3,408,090 bytes.
// 2026-10-27: Descriptor-driven effect editors, chunked AKC editor, typed
// RGB/profile surfaces and their strings. Measured: 3,474,377 bytes.
// 2026-10-29: Razer, Logitech and SteelSeries keyboard HID clients and panels
// add three real device protocols. Measured: 3,558,003 bytes across all
// chunks, with the main chunk at 1,149,146 bytes (below its existing cap).
// 2026-10-30: Keychron Hall-effect panel (key map, response curve graph) adds
// styles/areas/keychron.css, about 3 kB. Measured: 164,771 bytes of CSS before the
// bump; the lazy layout tables add a 251 kB chunk of JS (main grew 6.7 kB).
// 2026-10-30: Arbiter Studio controls and Keychron Hall-effect controls together
// add two keyboard workspaces, layouts, localized strings and device artwork.
// Measured after merging both: 168,860 bytes CSS, 3,652,136 bytes JS;
// main is 1,288,217 bytes, below its existing cap.
//
// 2026-10-31: VIA keyboard support adds the keycode tables, the definition
// parser, macro/encoder/lighting editors and their strings, about 82 kB of JS
// (3,734,304 bytes measured); it is lazy-loaded, main stays under its cap.
//
// 2026-10-31: MCHOSE Ace 68 Air support (keyboard-protocol codec and driver,
// per-key travel, keymap, macros, DKS/mod-tap/toggle, lighting, calibration
// panels and their strings in 12 languages), about 209 kB of JS (3,947,820
// bytes measured) and the keyboard deck, macro step and DKS grid styles,
// about 6 kB of CSS (174,587 bytes measured). The panel and the HID driver
// are lazy-loaded; the main chunk grew 20 kB, mostly English strings.
//
// 2026-10-31: MCHOSE follow-ups: media keycap icons (nine lucide icons), Mac
// layer labels, keyboard-function names and a shared slider with a typed
// number field (Wooting's millimetre field, now reused), about 5 kB of JS
// (3,953,032 bytes measured).
//
// 2026-10-31: MCHOSE parity with the vendor app's trigger, key and advanced
// tabs: per-direction rapid-trigger precision, travel view and selection
// tools, ready-made shortcuts, layer restore, live key depth, binding list,
// and 18 new strings in 12 languages, about 14 kB of JS (3,969,768 bytes
// measured).
//
// 2026-10-31: MCHOSE profile save/load to a file, official setups in the
// profile card and their strings in 12 languages, about 14 kB of JS
// (3,983,809 bytes measured).
//
// 2026-10-31: MCHOSE gradient editor and key-colour reset, factory reset
// (one profile or the whole keyboard), and their strings in 12 languages:
// about 21 kB of JS (4,004,460 bytes measured) and the gradient bar's styles,
// about 0.5 kB of CSS (175,264 bytes measured).
const BUDGET_BYTES: Record<string, number> = {
  ".css": 176_000,
  ".js": 4_010_000,
};

// main-*.js measured 1,511,619 bytes right after the split (posthog ~377 kB
// and the registry's 320 kB chunk are behind dynamic import() now). The
// remainder still holds the driver classes controller.ts references directly
// (instanceof checks and NEEDS_OPEN) — that is the follow-up slice for this
// issue. The budget keeps those honest: a driver that grows the initial load
// fails the check instead of silently riding along.
const MAIN_CHUNK_BUDGET_BYTES = 1_600_000;

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

// The initial chunk is everything first paint waits on: main-*.js plus its
// eager CSS. Lazy chunks (registry, posthog, secondary pages, locales) do not
// count toward it.
const mainBytes = found
  .filter(({ name }) => /^main-.*\.js$/.test(name))
  .reduce((sum, { bytes }) => sum + bytes, 0);

let failed = false;
{
  const percent = Math.round((mainBytes / MAIN_CHUNK_BUDGET_BYTES) * 100);
  const label = `MAIN ${String(mainBytes).padStart(7)} / ${MAIN_CHUNK_BUDGET_BYTES} bytes (${percent}%)`;
  if (mainBytes > MAIN_CHUNK_BUDGET_BYTES) {
    failed = true;
    console.error(`over budget  ${label}`);
  } else {
    console.log(`ok           ${label}`);
  }
}
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
