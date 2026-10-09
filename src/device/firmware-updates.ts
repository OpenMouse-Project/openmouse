/** Per-mouse firmware check, G Hub-style, without hammering the vendor.
 *
 *  How Logitech G Hub does it (confirmed against shipped lghub artifacts):
 *  `lghub_agent` reads the mouse fingerprint over HID++ (feature 0x0003 ->
 *  pid / firmware_version / serial), looks the pid up in a manifest fetched
 *  from updates.logitech.com, compares package_version vs device_version
 *  (`_isPackageVersionInstalled`), and pushes
 *  dfuInfo{dfuAvailable, dfuRequired, version, downloadUrl} over
 *  ws://localhost:9010. The Electron UI never compares versions itself —
 *  it only renders dfuInfo.
 *
 *  This module mirrors that split: version comparison lives here against a
 *  small manifest, and `FirmwareCard` only renders the resulting DfuInfo.
 *
 *  Distribution mirrors `news.ts`: the manifest source of truth is
 *  `public/firmware-manifest.json`, served primarily from the jsDelivr CDN
 *  mirror with a same-origin fallback. A scheduled job refreshes that file
 *  (e.g. a weekly Action scraping vendor feeds once), so N clients cause one
 *  upstream hit per refresh, not N hits per poll. The client additionally
 *  caches for 24h (manual "Check" bypasses), so "no new version" costs
 *  nothing until the next interval. Dismissing a version suppresses its
 *  badge until a NEWER version appears.
 */

export interface FirmwareManifestEntry {
  /** Stable id. Generated ids look like "<depot>@<version>[:<interfaceId>]". */
  id: string;
  /** Must equal MouseStatus.brand (case-insensitive). Absent = any brand (generated entries match by interfaceId). */
  brand?: string;
  /** Any substring match against MouseStatus.name (case-insensitive). */
  nameMatch?: string[];
  /** Optional exact match against MouseStatus.modelId. */
  modelId?: string;
  /**
   * HID interface identities this package fits ("046d_xxxx", lowercase).
   * From each depot dfu.json interfaceInfos — the same identity every HID
   * device reports, so matching needs no name guessing. Preferred over
   * brand/nameMatch whenever the connected device exposes its VID/PID.
   */
  interfaceIds?: string[];
  /** Source depot name on the update CDN. */
  depot?: string;
  /** Full download URL of the source depot (plain HTTPS, no auth). */
  depotUrl?: string;
  /** Logical binary key inside the depot (e.g. "dfu_binary"). */
  firmwareKey?: string;
  /** SHA256 of the firmware binary (uppercase hex, from dfu.json). */
  binaryHash?: string;
  /** Previously seen versions, newest first — written by the generator. */
  history?: Array<{ version: string; date: string | null }>;
  /** Flashing constraints, e.g. "BLOCKER_CONNECT_USB". */
  startBlockers?: string[];
  /** Advisory warnings, e.g. receiver/device pairing notes. */
  startWarnings?: string[];
  /**
   * Optional HID++ 0x0003 entity prefix (e.g. "MPM"). When set, the entry
   * compares only the status.firmware element starting with that prefix
   * instead of the first firmware entry — this is what keeps a receiver or
   * bootloader entity from being compared against the mouse's latest.
   */
  firmwareName?: string;
  /** Latest known firmware, e.g. "27.1.2". Compared numerically. */
  latestVersion: string;
  /** True = G Hub would show REQUIRED instead of AVAILABLE. */
  required?: boolean;
  /** Where the update button goes until in-app DFU exists. */
  downloadUrl?: string;
  releaseNotes?: string;
}

export interface FirmwareManifest {
  manifestVersion: number;
  updatedAt: string;
  /** Human-readable provenance, e.g. "weekly mirror of vendor feeds". */
  source: string;
  devices: FirmwareManifestEntry[];
}

export interface DfuInfo {
  currentVersion: string | null;
  latestVersion: string;
  dfuAvailable: boolean;
  dfuRequired: boolean;
  downloadUrl?: string;
  releaseNotes?: string;
  /** Which status.firmware entity was compared (e.g. "MPM"). */
  entityName?: string;
  /** Previously seen versions, newest first — accumulated by the generator. */
  history?: Array<{ version: string; date: string | null }>;
}

export interface FirmwareDeviceRef {
  /** HID identity "046d_xxxx" (lowercase), when known. */
  interfaceId?: string | null;
  brand: string;
  name: string;
  modelId?: string | null;
  firmware: string[];
}

const CDN_URL = "https://cdn.jsdelivr.net/gh/OpenMouse-Project/openmouse@main/public/firmware-manifest.json";
const FALLBACK_URL = "/firmware-manifest.json";

const MANIFEST_CACHE_KEY = "openmouse.firmware-manifest-cache.v3";
const DISMISSED_KEY = "openmouse.firmware-dismissed";

/** Background cadence — manual checks bypass this. */
export const FIRMWARE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** First `1.2.3`-shaped token in a driver string like "Mouse v27.1.2". */
export function extractVersionToken(raw: string): string | null {
  const match = raw.match(/\d+(?:\.\d+)+/);
  if (match) return match[0];
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitNumeric(version: string): number[] {
  return version
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ""), 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/** Numeric dot-separated compare. Returns -1 / 0 / 1. */
export function compareVersions(a: string, b: string): number {
  const pa = splitNumeric(a);
  const pb = splitNumeric(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function currentFirmwareVersion(firmware: string[]): string | null {
  for (const entry of firmware) {
    const token = extractVersionToken(entry);
    if (token) return token;
  }
  return null;
}

function interfaceMatches(entry: FirmwareManifestEntry, device: FirmwareDeviceRef): boolean {
  const want = (device.interfaceId ?? "").toLowerCase();
  if (!want) return false;
  return (entry.interfaceIds ?? []).some((id) => id.toLowerCase() === want);
}

function deviceMatches(entry: FirmwareManifestEntry, device: FirmwareDeviceRef): boolean {
  // Interface identity is exact — a generated entry pins its device.
  if ((entry.interfaceIds?.length ?? 0) > 0) return interfaceMatches(entry, device);
  if (entry.brand && entry.brand.toLowerCase() !== device.brand.toLowerCase()) return false;
  if (entry.modelId && device.modelId && entry.modelId === device.modelId) return true;
  const name = device.name.toLowerCase();
  if ((entry.nameMatch ?? []).some((needle) => needle.length > 0 && name.includes(needle.toLowerCase()))) {
    return true;
  }
  // Brand-only entry with no other matchers acts as a fallback for that
  // brand. An entry with no usable matcher at all never matches.
  if (!entry.brand) return false;
  return (entry.nameMatch ?? []).length === 0 && !entry.modelId;
}

export function matchManifestEntry(
  device: FirmwareDeviceRef,
  manifest: FirmwareManifest,
): FirmwareManifestEntry | null {
  for (const entry of manifest.devices) {
    // Entity-specific entries are evaluated in getDfuInfo's entity pass,
    // never as device-level fallbacks.
    if (entry.firmwareName) continue;
    if (deviceMatches(entry, device)) return entry;
  }
  return null;
}

/** Per-element readout, so multi-entity firmware like
 *  ["MPM 39.00.B0004", "BL2 73.00.B0011"] never blames the wrong element.
 *  Element 0 falls back to the device-level entry; later elements only match
 *  entity (`firmwareName`) entries. `available` is null when unknown. */
export interface FirmwareEntityInfo {
  element: string;
  version: string | null;
  latestVersion: string | null;
  entryId: string | null;
  available: boolean | null;
  required: boolean;
}

export function describeFirmwareEntities(
  device: FirmwareDeviceRef,
  manifest: FirmwareManifest,
): FirmwareEntityInfo[] {
  return device.firmware.map((element, index) => {
    const version = extractVersionToken(element);
    const lowered = element.toLowerCase();
    const entityEntry = manifest.devices.find(
      (entry) =>
        entry.firmwareName &&
        deviceMatches(entry, device) &&
        lowered.startsWith(entry.firmwareName.toLowerCase()),
    );
    const entry = entityEntry ?? (index === 0 ? matchManifestEntry(device, manifest) : null);
    if (!entry || !version) {
      return { element, version, latestVersion: null, entryId: entry?.id ?? null, available: null, required: false };
    }
    const available = compareVersions(version, entry.latestVersion) < 0;
    return {
      element,
      version,
      latestVersion: entry.latestVersion,
      entryId: entry.id,
      available,
      required: available && entry.required === true,
    };
  });
}

/** Pure G Hub `dfuInfo` equivalent: null when unknown (no entry / no version).
 *
 *  Entity-specific entries (`firmwareName`) are evaluated first so a
 *  multi-entity readout like ["MPM 39.00.B0004", "BL2 73.00.B0011"] never
 *  compares the wrong element. First available update wins; otherwise the
 *  first matched entity is reported (up to date). Falls back to the
 *  device-level match (first firmware entry) when nothing entity-specific
 *  matches.
 */
export function getDfuInfo(device: FirmwareDeviceRef, manifest: FirmwareManifest): DfuInfo | null {
  const entityInfos: DfuInfo[] = [];
  for (const entry of manifest.devices) {
    if (!entry.firmwareName) continue;
    if (!deviceMatches(entry, device)) continue;
    const element = device.firmware.find((item) =>
      item.toLowerCase().startsWith(entry.firmwareName!.toLowerCase()),
    );
    if (!element) continue;
    const current = extractVersionToken(element);
    if (!current) continue;
    const available = compareVersions(current, entry.latestVersion) < 0;
    entityInfos.push({
      currentVersion: current,
      latestVersion: entry.latestVersion,
      dfuAvailable: available,
      dfuRequired: available && entry.required === true,
      downloadUrl: entry.downloadUrl,
      releaseNotes: entry.releaseNotes,
      entityName: entry.firmwareName,
      history: entry.history,
    });
  }
  const update = entityInfos.find((info) => info.dfuAvailable);
  if (update) return update;
  if (entityInfos.length > 0) return entityInfos[0]!;

  const entry = matchManifestEntry(device, manifest);
  if (!entry) return null;
  const current = currentFirmwareVersion(device.firmware);
  if (!current) return null;
  const available = compareVersions(current, entry.latestVersion) < 0;
  return {
    currentVersion: current,
    latestVersion: entry.latestVersion,
    dfuAvailable: available,
    dfuRequired: available && entry.required === true,
    downloadUrl: entry.downloadUrl,
    releaseNotes: entry.releaseNotes,
    history: entry.history,
  };
}

interface ManifestCache {
  fetchedAt: number;
  manifest: FirmwareManifest;
}

function readCache(): ManifestCache | null {
  try {
    const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ManifestCache;
  } catch {
    return null;
  }
}

function writeCache(manifest: FirmwareManifest): number {
  const fetchedAt = Date.now();
  try {
    localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify({ fetchedAt, manifest }));
  } catch {
    // Storage full / blocked — the check still worked, just not cached.
  }
  return fetchedAt;
}

function isManifest(value: unknown): value is FirmwareManifest {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as { devices?: unknown }).devices);
}

async function fetchManifestFrom(url: string, signal?: AbortSignal): Promise<FirmwareManifest> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Manifest endpoint returned HTTP ${response.status}.`);
  const body = (await response.json()) as unknown;
  if (!isManifest(body)) throw new Error("Manifest is malformed.");
  return body;
}

/**
 * Loads the manifest, using the 24h cache unless `force` (manual "Check").
 * CDN first with same-origin fallback (see news.ts). Never throws when a
 * stale cache exists — a flaky CDN shouldn't hide the last known versions.
 * Throws only when there is nothing to show at all.
 */
export async function loadFirmwareManifest(opts?: {
  force?: boolean;
  signal?: AbortSignal;
}): Promise<{ manifest: FirmwareManifest; fetchedAt: number; fromCache: boolean }> {
  const cached = readCache();
  if (!opts?.force && cached && Date.now() - cached.fetchedAt < FIRMWARE_CHECK_INTERVAL_MS) {
    return { manifest: cached.manifest, fetchedAt: cached.fetchedAt, fromCache: true };
  }
  try {
    const manifest = await fetchManifestFrom(CDN_URL, opts?.signal).catch(() =>
      fetchManifestFrom(FALLBACK_URL, opts?.signal),
    );
    const fetchedAt = writeCache(manifest);
    return { manifest, fetchedAt, fromCache: false };
  } catch (error) {
    if (cached && !opts?.signal?.aborted) {
      return { manifest: cached.manifest, fetchedAt: cached.fetchedAt, fromCache: true };
    }
    throw error;
  }
}

type DismissedMap = Record<string, string>;

function readDismissed(): DismissedMap {
  try {
    return (JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "{}") as DismissedMap) ?? {};
  } catch {
    return {};
  }
}

/** Suppresses the badge for this exact latest version (a newer one re-arms it). */
export function dismissDfuVersion(deviceKey: string, version: string): void {
  try {
    const map = readDismissed();
    map[deviceKey] = version;
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal.
  }
}

export function isDfuDismissed(deviceKey: string, version: string): boolean {
  return readDismissed()[deviceKey] === version;
}

/** Stable per-model key so a dismissal survives reconnects. */
export function dismissKeyFor(device: FirmwareDeviceRef): string {
  return `${device.brand.toLowerCase()}::${device.name.toLowerCase()}::${(device.modelId ?? "").toLowerCase()}`;
}
