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

export function saveBatterySample(
  storage: Storage,
  deviceName: string,
  percent: number,
  mode: BatteryMode,
  now = Date.now(),
): BatterySample[] {
  const history = loadHistory(storage);
  const cutoff = now - MAX_SAMPLE_AGE_MS;
  const storedSamples = Array.isArray(history[deviceName]) ? history[deviceName] : [];
  const samples = storedSamples.filter((sample) =>
    Number.isFinite(sample.timestamp)
    && Number.isFinite(sample.percent)
    && sample.timestamp >= cutoff
    && sample.percent >= 0
    && sample.percent <= 100
    && (sample.mode === "charging" || sample.mode === "discharging"));
  const previous = samples.at(-1);
  const shouldSave = !previous
    || previous.mode !== mode
    || previous.percent !== percent
    || now - previous.timestamp >= CHECKPOINT_MS;

  if (shouldSave) samples.push({ timestamp: now, percent, mode });
  const retainedSamples = samples.slice(-MAX_SAMPLES_PER_DEVICE);
  history[deviceName] = retainedSamples;
  if (shouldSave || retainedSamples.length !== storedSamples.length) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Estimates remain optional when browser storage is unavailable or full.
    }
  }
  return retainedSamples;
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
