/**
 * HITS presets: both main buttons' tuning, saved in this browser and shared as a
 * short code. The code holds the values only, with a checksum so a mistyped one
 * is rejected; a preset's name stays out of it.
 */

export interface HitsButtonValues {
  actuation: number;
  rapidTrigger: number;
  rapidTriggerEnabled: boolean;
  haptics: number;
}

export interface HitsPreset {
  name: string;
  left: HitsButtonValues;
  right: HitsButtonValues;
}

export interface HitsLimits {
  maxActuation: number;
  maxRapidTrigger: number;
  maxHaptics: number;
}

const side = (actuation: number, rapidTrigger: number, rapidTriggerEnabled: boolean, haptics: number): HitsButtonValues =>
  ({ actuation, rapidTrigger, rapidTriggerEnabled, haptics });
const both = (actuation: number, rapidTrigger: number, rapidTriggerEnabled: boolean, haptics: number): Pick<HitsPreset, "left" | "right"> =>
  ({ left: side(actuation, rapidTrigger, rapidTriggerEnabled, haptics), right: side(actuation, rapidTrigger, rapidTriggerEnabled, haptics) });

/** Starting points that ship with the app. Default is also what Reset goes back to. */
export const BUILT_IN_HITS_PRESETS: readonly HitsPreset[] = [
  { name: "Default", ...both(5, 2, false, 3) },
  { name: "Competitive", ...both(2, 1, true, 0) },
  { name: "Balanced", ...both(5, 2, true, 3) },
  { name: "Casual", ...both(7, 3, false, 3) },
];

/** The pro player profiles G HUB lists, as its cards show them: actuation, rapid trigger, haptics. */
export const PRO_HITS_PRESETS: readonly HitsPreset[] = [
  // Whzy's right button has rapid trigger off in G HUB; its stored step is kept at the lowest.
  { name: "Whzy", left: side(1, 1, true, 2), right: side(4, 1, false, 2) },
  { name: "ShowMaker", ...both(2, 1, true, 2) },
  { name: "MrFaliN", left: side(4, 2, true, 3), right: side(5, 2, true, 5) },
  { name: "Gryffinn", ...both(2, 2, true, 2) },
  { name: "m0NESY", ...both(5, 4, true, 5) },
];

const CODE_PREFIX = "HITS1-";
const STORAGE_KEY = "openmouse-hits-presets-v1";
const MAX_PRESETS = 20;
const MAX_NAME_LENGTH = 40;

// The widest ranges any HITS mouse has reported. A mouse's own limits are checked on top of these.
const ABSOLUTE = { actuation: 63, rapidTrigger: 63, haptics: 63 };

function inRange(values: HitsButtonValues | undefined, limits: HitsLimits): boolean {
  // Stored data can be missing a button or be the wrong shape; that is not valid, and must not throw.
  if (typeof values !== "object" || values === null) return false;
  return Number.isInteger(values.actuation) && values.actuation >= 1 && values.actuation <= limits.maxActuation
    && Number.isInteger(values.rapidTrigger) && values.rapidTrigger >= 1 && values.rapidTrigger <= limits.maxRapidTrigger
    && Number.isInteger(values.haptics) && values.haptics >= 0 && values.haptics <= limits.maxHaptics
    && typeof values.rapidTriggerEnabled === "boolean";
}

/**
 * True when two setups are the same on the mouse. A rapid trigger step that is
 * switched off does nothing, so it is not compared.
 */
export function presetMatches(a: Pick<HitsPreset, "left" | "right">, b: Pick<HitsPreset, "left" | "right">): boolean {
  const side = (x: HitsButtonValues, y: HitsButtonValues) => x.actuation === y.actuation
    && x.haptics === y.haptics
    && x.rapidTriggerEnabled === y.rapidTriggerEnabled
    && (!x.rapidTriggerEnabled || x.rapidTrigger === y.rapidTrigger);
  return side(a.left, b.left) && side(a.right, b.right);
}

/** True when every value is inside what the mouse reports it can do. */
export function presetFits(preset: Pick<HitsPreset, "left" | "right">, limits: HitsLimits): boolean {
  return inRange(preset.left, limits) && inRange(preset.right, limits);
}

const ABSOLUTE_LIMITS: HitsLimits = {
  maxActuation: ABSOLUTE.actuation,
  maxRapidTrigger: ABSOLUTE.rapidTrigger,
  maxHaptics: ABSOLUTE.haptics,
};

export function toBase64Url(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(text: string): number[] | null {
  try {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    return [...atob(padded)].map((character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function checksum(bytes: number[]): number {
  return bytes.reduce((sum, value) => (sum + value) & 0xff, 0x5a);
}

export function encodeHitsCode(preset: Pick<HitsPreset, "left" | "right">): string {
  const bytes = [1];
  for (const side of [preset.left, preset.right]) {
    bytes.push(side.actuation, side.rapidTrigger, side.haptics, side.rapidTriggerEnabled ? 1 : 0);
  }
  bytes.push(checksum(bytes));
  return CODE_PREFIX + toBase64Url(bytes);
}

/** Null for anything that is not a well-formed, checksum-correct HITS code. */
export function decodeHitsCode(text: string): Pick<HitsPreset, "left" | "right"> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) return null;
  const bytes = fromBase64Url(trimmed.slice(CODE_PREFIX.length));
  if (!bytes || bytes.length !== 10 || bytes[0] !== 1) return null;
  if (checksum(bytes.slice(0, 9)) !== bytes[9]) return null;
  const side = (offset: number): HitsButtonValues => ({
    actuation: bytes[offset],
    rapidTrigger: bytes[offset + 1],
    haptics: bytes[offset + 2],
    rapidTriggerEnabled: bytes[offset + 3] === 1,
  });
  const preset = { left: side(1), right: side(5) };
  if (bytes[4] > 1 || bytes[8] > 1) return null;
  return presetFits(preset, ABSOLUTE_LIMITS) ? preset : null;
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

export function loadHitsPresets(storage: Storage): HitsPreset[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is HitsPreset =>
      typeof entry === "object" && entry !== null
      && typeof (entry as HitsPreset).name === "string" && (entry as HitsPreset).name !== ""
      && presetFits(entry as HitsPreset, ABSOLUTE_LIMITS));
  } catch {
    return [];
  }
}

/** Saves under the name, replacing a preset of the same name. Returns the new list, or null if the name is empty. */
export function saveHitsPreset(storage: Storage, preset: HitsPreset): HitsPreset[] | null {
  const name = cleanName(preset.name);
  if (!name) return null;
  const others = loadHitsPresets(storage).filter((existing) => existing.name !== name);
  const next = [...others, { ...preset, name }].slice(-MAX_PRESETS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return null;
  }
  return next;
}

export function deleteHitsPreset(storage: Storage, name: string): HitsPreset[] {
  const next = loadHitsPresets(storage).filter((existing) => existing.name !== name);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the list simply stays as it was.
  }
  return next;
}
