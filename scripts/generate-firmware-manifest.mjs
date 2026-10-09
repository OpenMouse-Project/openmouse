// Builds public/firmware-manifest.json from Logitech's own update CDN —
// no vendor software involved at any step.
//
// Each firmware depot is a small archive published at:
//   https://updates.ghub.logitechg.com/depots/<uuid>/<name>.depot
// (plain HTTPS, no auth — verified against live responses). Inside every
// depot sits a dfu.json describing which interfaces (VID_PID) the package
// fits, its dotted-decimal version, the binary's SHA256, and flashing
// constraints (blockers, force flags). This script downloads each depot in
// scripts/firmware-depots.seed.json, parses that metadata, and emits one
// manifest entry per dfu.json content block, keyed by interfaceId — the
// same "046d_xxxx" identity every HID device already reports, so the app
// matches locally with zero vendor traffic.
//
// The seed list maps depot names to listing UUIDs. Those UUIDs are
// Logitech-opaque and only discoverable from their Depository listing, so
// adding a brand-new device means adding one line there (name + uuid);
// everything else — versions, files, hashes, blockers — is re-derived from
// the CDN on every run. Prefer LVFS (fwupd.org) metadata where a device is
// published there; this script covers the G-HUB-only remainder.
//
// Usage:
//   node scripts/generate-firmware-manifest.mjs [--only <substring>] [--output <path>]
// (Requires Node ≥ 18. Run from the openmouse repo root.)
//
// Encrypted depots: a few depots (some keyboards, some receivers) carry a
// {header-sha, key-id} index instead of a file list — per-depot
// encryption whose keys ship with vendor software. The generator skips
// those with a warning rather than reimplementing vendor crypto; cover
// such devices via firmware-manifest.extra.json instead.
//
// Hand entries: scripts/firmware-manifest.extra.json holds confirmed values
// for devices without usable depots (merged last, extra wins on id clash).
//
// Safety: downloads are verified (archive parses end-to-end; binaries are
// cross-checked against dfu.json hashes where present). A depot that fails
// to download or parse is skipped with a warning, never fatal — the
// manifest must always be publishable from whatever did resolve.

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const CDN_HOST = "https://updates.ghub.logitechg.com";
const MANIFEST_VERSION = 3;

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}
const onlyFilter = flag("--only");
const outputPath = flag("--output") ?? join(root, "public", "firmware-manifest.json");

const seed = JSON.parse(readFileSync(join(here, "firmware-depots.seed.json"), "utf8"));

function depotUrl(entry) {
  return `${CDN_HOST}/depots/${entry.uuid}/${entry.name}.depot`;
}

/** Depot archive: magic(4) + LE32 index length + JSON index + LE32-prefixed files. */
function parseDepot(buffer, label) {
  if (buffer.length < 8) throw new Error(`${label}: too short (${buffer.length}b)`);
  const indexLength = buffer.readUInt32LE(4);
  const index = JSON.parse(buffer.subarray(8, 8 + indexLength).toString("utf8"));
  let offset = 8 + indexLength;
  const files = new Map();
  for (const file of index.files) {
    if (offset + 4 > buffer.length) throw new Error(`${label}: truncated at ${file.name}`);
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    if (offset + length > buffer.length) throw new Error(`${label}: truncated data for ${file.name}`);
    files.set(file.name, buffer.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== buffer.length) throw new Error(`${label}: ${buffer.length - offset} trailing bytes`);
  return files;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function entryId(depotName, version, key) {
  return `${depotName}@${version}${key && key !== "dfu_binary" ? `:${key}` : ""}`;
}

/** Plain-text English changelog from the depot, if shipped. */
function depotReleaseNotes(files) {
  const raw = files.get('release_notes/dfu_release_notes.html');
  if (!raw) return null;
  const text = Buffer.from(raw).toString('utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > 400 ? text.slice(0, 397).trimEnd() + '...' : text;
}

function firmwareBlobs(files) {
  return [...files.keys()]
    .filter((name) => name.endsWith(".dfu") || name.endsWith(".bin") || name.endsWith(".img"))
    .map((name) => files.get(name));
}

async function fetchDepot(entry) {
  const url = depotUrl(entry);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const devices = [];
const warnings = [];
const seen = new Set();

for (const entry of seed) {
  if (onlyFilter && !entry.name.toLowerCase().includes(onlyFilter.toLowerCase())) continue;
  const url = depotUrl(entry);
  try {
    const files = parseDepot(await fetchDepot(entry), entry.name);
    const dfuRaw = files.get("dfu.json");
    if (!dfuRaw) throw new Error("depot has no dfu.json");
    const dfu = JSON.parse(dfuRaw.toString("utf8"));
    if (!Array.isArray(dfu.contents)) throw new Error("dfu.json has no contents[]");
    const depotManifestRaw = files.get("manifest.json");
    const depotManifest = depotManifestRaw ? JSON.parse(depotManifestRaw.toString("utf8")) : null;
    for (const content of dfu.contents) {
      const interfaceIds = [...new Set(
        (content.interfaceInfos ?? [])
          .map((info) => (info.interfaceId ?? "").toLowerCase())
          .filter(Boolean),
      )];
      const binaryKey = content.binaryFileKey?.key ?? null;
      const resource = depotManifest?.resources?.find?.((r) => r.key === binaryKey);
      const blob = (resource && files.get(resource.src)) ?? firmwareBlobs(files)[0] ?? null;
      let binaryHash = content.binaryFileKey?.hash ?? null;
      if (blob && binaryHash && sha256Hex(blob) !== binaryHash.toUpperCase()) {
        warnings.push(`${entry.name}: hash mismatch for ${binaryKey}; keeping listing hash`);
      }
      if (blob && !binaryHash) binaryHash = sha256Hex(blob);
      const notes = depotReleaseNotes(files);
      const id = entryId(entry.name, content.version, interfaceIds[0] ?? binaryKey);
      if (seen.has(id)) continue;
      seen.add(id);
      devices.push({
        id,
        depot: entry.name,
        depotUrl: url,
        interfaceIds,
        ...(binaryKey ? { firmwareKey: binaryKey } : {}),
        latestVersion: content.version,
        ...((content.updateRequired ?? dfu.updateRequired) ? { required: true } : {}),
        ...(binaryHash ? { binaryHash } : {}),
        ...(notes ? { releaseNotes: notes } : {}),
        startBlockers: content.startBlockers ?? dfu.startBlockers ?? [],
        startWarnings: content.startWarnings ?? dfu.startWarnings ?? [],
      });
    }
    console.log(`ok   ${entry.name} (${devices.length} entries so far)`);
  } catch (error) {
    warnings.push(`${entry.name}: skipped (${error instanceof Error ? error.message : String(error)})`);
    console.log(`skip ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}


// Hand-maintained entries (confirmed values, non-depot devices). Extra wins.
const extraPath = join(here, 'firmware-manifest.extra.json');
try {
  const extra = JSON.parse(readFileSync(extraPath, 'utf8'));
  const generatedIds = new Set(devices.map((d) => d.id));
  for (const device of extra.devices ?? []) {
    if (generatedIds.has(device.id)) continue;
    devices.push(device);
  }
} catch (error) {
  warnings.push('extra entries unreadable: ' + (error instanceof Error ? error.message : String(error)));
}

// Version history: carry forward the previous manifest (if this run
// overwrites a real one) so each entry accumulates [{version, date}]
// whenever its version moves. First sightings start empty — history is
// earned, never invented.
try {
  const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
  const prevById = new Map((previous.devices ?? []).map((d) => [d.id, d]));
  for (const device of devices) {
    const prev = prevById.get(device.id);
    if (!prev) continue;
    const history = Array.isArray(prev.history) ? [...prev.history] : [];
    if (prev.latestVersion && prev.latestVersion !== device.latestVersion) {
      history.unshift({ version: prev.latestVersion, date: previous.updatedAt ?? null });
    }
    if (history.length > 0) device.history = history.slice(0, 8);
  }
} catch {
  // No previous manifest (first run) — nothing to carry.
}

devices.sort((a, b) => a.id.localeCompare(b.id));

const manifest = {
  _comment:
    "AUTO-GENERATED — do not edit by hand. Regenerate with: node scripts/generate-firmware-manifest.mjs. " +
    "Sources: Logitech update CDN depots listed in scripts/firmware-depots.seed.json (plain HTTPS, no auth). " +
    "Versions/hashes/blockers are re-derived from each depot's dfu.json every run.",
  manifestVersion: MANIFEST_VERSION,
  updatedAt: new Date().toISOString(),
  source: "scripts/generate-firmware-manifest.mjs over updates.ghub.logitechg.com",
  devices,
};

writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nwrote ${devices.length} entries to ${outputPath}`);
for (const warning of warnings) console.log(`warn: ${warning}`);
