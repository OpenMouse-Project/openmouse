export type BatteryMode = "charging" | "discharging";

export interface BatterySample {
  timestamp: number;
  percent: number;
  mode: BatteryMode;
}

type BatteryHistory = Record<string, BatterySample[]>;

const STORAGE_KEY = "openmouse-battery-history-v1";
const CHECKPOINT_MS = 5 * 60 * 1000;
const MAX_SAMPLE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONTINUOUS_GAP_MS = 10 * 60 * 1000;
const MIN_ESTIMATE_SPAN_MS = 10 * 60 * 1000;
const MAX_SAMPLES_PER_DEVICE = 500;

function loadHistory(storage: Storage): BatteryHistory {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as BatteryHistory : {};
  } catch {
    return {};
  }
}

function pruneSamples(stored: unknown, cutoff: number): BatterySample[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((sample): sample is BatterySample =>
    typeof sample === "object"
    && sample !== null
    && Number.isFinite((sample as BatterySample).timestamp)
    && Number.isFinite((sample as BatterySample).percent)
    && (sample as BatterySample).timestamp >= cutoff
    && (sample as BatterySample).percent >= 0
    && (sample as BatterySample).percent <= 100
    && ((sample as BatterySample).mode === "charging" || (sample as BatterySample).mode === "discharging"));
}

// In-memory copy of each device's samples. Renders read from here instead of
// parsing storage on every frame; device updates refresh it via
// recordBatterySample below.
const memorySamples = new Map<string, BatterySample[]>();

export function saveBatterySample(
  storage: Storage,
  deviceName: string,
  percent: number,
  mode: BatteryMode,
  now = Date.now(),
): BatterySample[] {
  const history = loadHistory(storage);
  const cutoff = now - MAX_SAMPLE_AGE_MS;
  const stored = history[deviceName];
  const storedCount = Array.isArray(stored) ? stored.length : 0;
  const samples = pruneSamples(stored, cutoff);
  const previous = samples.at(-1);
  const shouldSave = !previous
    || previous.mode !== mode
    || previous.percent !== percent
    || now - previous.timestamp >= CHECKPOINT_MS;

  if (shouldSave) samples.push({ timestamp: now, percent, mode });
  const retainedSamples = samples.slice(-MAX_SAMPLES_PER_DEVICE);
  history[deviceName] = retainedSamples;
  if (shouldSave || retainedSamples.length !== storedCount) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Estimates remain optional when browser storage is unavailable or full.
    }
  }
  return retainedSamples;
}

/**
 * Records one sample at device-update cadence (not render cadence) and caches
 * it for render reads. Call this when a fresh device status arrives.
 */
export function recordBatterySample(
  storage: Storage,
  deviceName: string,
  percent: number,
  mode: BatteryMode,
  now = Date.now(),
): void {
  memorySamples.set(deviceName, saveBatterySample(storage, deviceName, percent, mode, now));
}

/**
 * Render-safe read: memory first, a single storage parse on cold start, and
 * never a write. Renders must call this instead of saveBatterySample.
 */
export function cachedBatterySamples(
  storage: Storage,
  deviceName: string,
  now = Date.now(),
): BatterySample[] {
  const hit = memorySamples.get(deviceName);
  if (hit) return hit;
  const samples = pruneSamples(loadHistory(storage)[deviceName], now - MAX_SAMPLE_AGE_MS);
  memorySamples.set(deviceName, samples);
  return samples;
}

function formatEstimate(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `~${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `~${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr`;
  const days = hours / 24;
  return `~${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}

export function estimateBatteryTime(
  samples: BatterySample[],
  percent: number,
  mode: BatteryMode,
  now = Date.now(),
): string | null {
  const continuous: BatterySample[] = [];
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    const newer = continuous[0];
    if (sample.mode !== mode || (newer && newer.timestamp - sample.timestamp > MAX_CONTINUOUS_GAP_MS)) break;
    continuous.unshift(sample);
  }

  const first = continuous[0];
  const last = continuous.at(-1);
  if (!first || !last || now - last.timestamp > MAX_CONTINUOUS_GAP_MS) return null;
  const elapsed = last.timestamp - first.timestamp;
  const change = mode === "charging" ? last.percent - first.percent : first.percent - last.percent;
  if (elapsed < MIN_ESTIMATE_SPAN_MS || change < 1) return null;

  const remainingPercent = mode === "charging" ? 100 - percent : percent;
  if (remainingPercent <= 0) return null;
  return formatEstimate(remainingPercent / (change / elapsed));
}

/** Power draw in mW at one polling rate: the sensor and electronics, and the radio. */
interface RatePower {
  system: number;
  signal: number;
}

interface RatedBattery {
  /** The manufacturer's quoted battery life. */
  hours: number;
  /** The polling rate that quote is for. Only needed with powerByRateHz. */
  ratedRateHz?: number;
  /** Draw per polling rate, as G HUB shows it. Lets the estimate follow the rate in use. */
  powerByRateHz?: Record<number, RatePower>;
}

/**
 * Manufacturer battery life for mice that report a percent and nothing else. A
 * rough stand-in until real usage history gives a better figure. Keyed by the
 * device name without spaces, upper-cased.
 *
 * The PRO X 3 draw figures are what G HUB displays. They are not read from the
 * mouse: a capture of G HUB stepping through every rate shows only the set-rate
 * command and no power values, so G HUB has them built in. Logitech quotes 135 h
 * at 1000 Hz, which makes the cell about 1080 mWh (8 mW for 135 h).
 */
const RATED_BATTERY: Record<string, RatedBattery> = {
  PROX2SUPERSTRIKE: { hours: 90 },
  PROX3SUPERSTRIKE: {
    hours: 135,
    ratedRateHz: 1000,
    powerByRateHz: {
      125: { system: 4, signal: 1 },
      250: { system: 4, signal: 1 },
      500: { system: 4, signal: 2 },
      1000: { system: 4, signal: 4 },
      2000: { system: 5, signal: 9 },
      4000: { system: 7, signal: 10 },
      8000: { system: 12, signal: 20 },
    },
  },
};

export function ratedBattery(deviceName: string): RatedBattery | null {
  return RATED_BATTERY[deviceName.replace(/\s+/g, "").toUpperCase()] ?? null;
}

/**
 * Hours a full charge lasts at the given polling rate: the rated hours scaled by
 * how much more or less the mouse draws at that rate than at the rated one.
 * Without a power table for the model, or the rate, it is just the rated hours.
 */
export function ratedFullChargeHours(battery: RatedBattery, pollingRateHz?: number | null): number {
  const table = battery.powerByRateHz;
  const at = (hz: number | null | undefined): number | null => {
    const power = hz == null ? undefined : table?.[hz];
    return power ? power.system + power.signal : null;
  };
  const rated = at(battery.ratedRateHz);
  const current = at(pollingRateHz);
  return rated && current ? (battery.hours * rated) / current : battery.hours;
}

/**
 * Hours a full charge lasts at this polling rate, or null when the model has no
 * power figure for it (so the rates cannot be told apart honestly).
 */
export function fullChargeHoursAt(deviceName: string, pollingRateHz: number): number | null {
  const battery = ratedBattery(deviceName);
  if (!battery?.powerByRateHz?.[pollingRateHz] || !battery.powerByRateHz[battery.ratedRateHz ?? 0]) return null;
  return ratedFullChargeHours(battery, pollingRateHz);
}

/** Time left on the rated figure, in the same format as estimateBatteryTime. */
export function estimateFromRatedLife(
  percent: number,
  battery: RatedBattery,
  pollingRateHz?: number | null,
): string | null {
  if (!(percent > 0) || !(battery.hours > 0)) return null;
  return formatEstimate((percent / 100) * ratedFullChargeHours(battery, pollingRateHz) * 60 * 60 * 1000);
}
