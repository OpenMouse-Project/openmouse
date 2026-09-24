// Mirrors the supported-devices table into src/supported-devices-data.ts.
//
// The source of truth is the landing page's `supported-mice.ts` (the table the
// openmouse.app/supported page renders; itself re-checked against the
// @openmouse/protocol driver registry by its own tests). The hardware-test
// report crosschecks the connected device against this mirrored copy, so the
// two repos must not silently drift.
//
// Usage:
//   node scripts/sync-supported-devices.mjs
// (Requires Node ≥ 23.6 so the landing page's .ts table can be imported
// directly with type stripping. Run from the openmouse repo root.)
//
// The mirror keeps only the fields the crosscheck needs (brand, model, status,
// pids) and drops votes/notes, so the generated file is a compact snapshot.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const source = join(root, "..", "openmouse-landing-page", "src", "supported-mice.ts");

const { MICE } = await import(pathToFileURL(source).href);

const rows = MICE.map((entry) => {
  const pids = entry.pids?.length ? `, pids: [${entry.pids.map((id) => `0x${id.toString(16)}`).join(", ")}]` : "";
  return `  { brand: ${JSON.stringify(entry.brand)}, model: ${JSON.stringify(entry.model)}, status: "${entry.status}"${pids} },`;
});

const out = `// Supported-devices table, mirrored from the landing page.
//
// AUTO-GENERATED — do not edit by hand. Source of truth:
//   openmouse-landing-page/src/supported-mice.ts
// (the table behind openmouse.app/supported, re-checked against the
// @openmouse/protocol driver registry every time the landing page builds).
//
// Regenerate with:
//   node scripts/sync-supported-devices.mjs

export type SupportedDevicesStatus =
  | "supported"
  | "pr"
  | "quickwin"
  | "likely"
  | "driver"
  | "unknown"
  | "bridge"
  | "pending";

export interface SupportedDeviceEntry {
  brand: string;
  model: string;
  status: SupportedDevicesStatus;
  /** Known product ids from the page table (hex), when the driver pins them. */
  pids?: readonly number[];
}

export const SUPPORTED_DEVICES: readonly SupportedDeviceEntry[] = [
${rows.join("\n")}
];
`;

writeFileSync(join(root, "src", "supported-devices-data.ts"), out);
console.log(`Wrote src/supported-devices-data.ts with ${MICE.length} entries from ${source}`);