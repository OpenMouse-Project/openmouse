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
const BUDGET_BYTES: Record<string, number> = {
  ".css": 165_000,
  ".js": 3_200_000,
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
