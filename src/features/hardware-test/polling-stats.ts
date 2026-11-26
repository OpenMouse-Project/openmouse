export interface TestResults {
  avgHz: number;
  peakHz: number;
  low5Hz: number;
  jitter: number;
  stability: number;
  dropouts: number;
  events: number;
  duration: number;
  avgInterval: number;
  intervals: number[];
}

export function computeResults(intervals: number[], durationMs: number): TestResults {
  const filtered = intervals.filter((ms) => ms > 0.05 && ms <= 1000);
  if (filtered.length < 2) {
    return { avgHz: 0, peakHz: 0, low5Hz: 0, jitter: 0, stability: 0, dropouts: 0, events: 0, duration: 0, avgInterval: 0, intervals: [] };
  }
  const sortedInts = [...filtered].sort((a, b) => a - b);
  const medianInterval = sortedInts[Math.floor(sortedInts.length / 2)] ?? 1;
  const hzValues = filtered.map((ms) => 1000 / ms).filter((h) => h > 0 && h < 20000);
  const sorted = [...hzValues].sort((a, b) => a - b);
  const sumMs = filtered.reduce((s, v) => s + v, 0);
  const avg = (filtered.length * 1000) / sumMs;
  const medianHz = 1000 / medianInterval;
  const minValidInterval = medianInterval * 0.9;
  const peak = Math.min(
    filtered.reduce((mx, ms) => (ms >= minValidInterval ? Math.max(mx, 1000 / ms) : mx), 0),
    medianHz
  ) || medianHz;
  const low5Idx = Math.max(0, Math.floor(sorted.length * 0.05));
  const low5 = sorted[low5Idx]!;
  const meanInterval = sumMs / filtered.length;
  const tolerance = medianInterval * 0.5;
  const inBand = filtered.filter((ms) => ms >= medianInterval - tolerance && ms <= medianInterval + tolerance).length;
  const stability = (inBand / filtered.length) * 100;
  const jitter = Math.round(Math.max(0, 100 - stability) * 10) / 10;
  const dropouts = filtered.filter((ms) => ms > medianInterval * 2.5).length;
  return { avgHz: avg, peakHz: peak, low5Hz: low5, jitter, stability, dropouts, events: hzValues.length, duration: durationMs / 1000, avgInterval: meanInterval, intervals };
}

const LIVE_WINDOW = 24;

export function rollingLiveHz(intervals: number[]): number {
  const recent = intervals.slice(-LIVE_WINDOW);
  if (recent.length < 3) return 0;
  const sorted = recent.map((ms) => (ms > 0 ? 1000 / ms : 0)).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function formatHz(hz: number): string {
  return hz > 0 ? `${Math.round(hz)}` : "--";
}

export function stabilityClass(stability: number): string {
  if (stability >= 90) return "is-good";
  if (stability >= 70) return "is-mid";
  return "is-poor";
}