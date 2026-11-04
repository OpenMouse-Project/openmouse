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
// 2026-11-04: @openmouse/protocol 0.49.0 -> 0.51.x adds the Hitscan web
// protocol driver, Amkette XS, Attack Shark X3 Pro, MCHOSE A7 Ultra and
// L7 Pro+, Paro Aurora and Corsair Scimitar RGB Elite, about 70 kB of JS
// (3,743,762 -> 3,813,797 bytes measured); main is 1,384,701 bytes, below its cap.
export const BUDGET_BYTES: Record<string, number> = {
  ".css": 170_000,
  ".js": 3_850_000,
};

// main-*.js measured 1,511,619 bytes right after the split (posthog ~377 kB
// and the registry's 320 kB chunk are behind dynamic import() now). The
// remainder still holds the driver classes controller.ts references directly
// (instanceof checks and NEEDS_OPEN) — that is the follow-up slice for this
// issue. The budget keeps those honest: a driver that grows the initial load
// fails the check instead of silently riding along.
export const MAIN_CHUNK_BUDGET_BYTES = 1_600_000;

export const ASSETS = join("dist", "assets");

// Preview-fixture chunks only exist in local verification builds; the slack
// keeps the JS budget green for those runs without hiding real growth.
export const PREVIEW_FIXTURES_SLACK_BYTES = 18_000;

export interface BundleEntry {
  name: string;
  ext: string;
  bytes: number;
}

export function bundles(assetsDir: string = ASSETS): BundleEntry[] {
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith(".css") || name.endsWith(".js"))
    .map((name) => ({
      name,
      ext: name.slice(name.lastIndexOf(".")),
      bytes: statSync(join(assetsDir, name)).size,
    }));
}

/** Check the bundles in assetsDir against the budgets. Returns true on failure. */
export function checkBundles(assetsDir: string = ASSETS): boolean {
  const found = bundles(assetsDir);
  if (found.length === 0) {
    console.error(`No bundles in ${assetsDir}. Run "npm run build" first.`);
    return true;
  }

  const budgets = {
    ...BUDGET_BYTES,
    ".js": BUDGET_BYTES[".js"] + (found.some(({ name }) => name.startsWith("preview-fixtures-")) ? PREVIEW_FIXTURES_SLACK_BYTES : 0),
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
  }
  return failed;
}

if (process.argv[1]?.endsWith("check-bundle-size.ts")) {
  if (checkBundles()) process.exit(1);
}
