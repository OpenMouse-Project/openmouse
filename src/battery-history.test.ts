import assert from "node:assert/strict";
import test from "node:test";

import { cachedBatterySamples, estimateBatteryTime, estimateFromRatedLife, fullChargeHoursAt, ratedBattery, ratedFullChargeHours, recordBatterySample, saveBatterySample } from "./battery-history.ts";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

test("battery history keeps only meaningful checkpoints", () => {
  const storage = new MemoryStorage();
  const first = saveBatterySample(storage, "Mouse", 75, "discharging", 0);
  const unchanged = saveBatterySample(storage, "Mouse", 75, "discharging", 60_000);
  const changed = saveBatterySample(storage, "Mouse", 74, "discharging", 120_000);

  assert.equal(first.length, 1);
  assert.equal(unchanged.length, 1);
  assert.equal(changed.length, 2);
});

test("battery estimate requires a recent continuous trend", () => {
  const samples = [
    { timestamp: 0, percent: 100, mode: "discharging" as const },
    { timestamp: 10 * 60 * 1000, percent: 98, mode: "discharging" as const },
    { timestamp: 20 * 60 * 1000, percent: 96, mode: "discharging" as const },
    { timestamp: 30 * 60 * 1000, percent: 94, mode: "discharging" as const },
    { timestamp: 40 * 60 * 1000, percent: 92, mode: "discharging" as const },
    { timestamp: 50 * 60 * 1000, percent: 91, mode: "discharging" as const },
    { timestamp: 60 * 60 * 1000, percent: 90, mode: "discharging" as const },
  ];

  assert.equal(estimateBatteryTime(samples, 90, "discharging", 60 * 60 * 1000), "~9.0 hr");
  assert.equal(estimateBatteryTime(samples, 90, "discharging", 2 * 60 * 60 * 1000), null);
});

test("cached battery samples serve renders without storage IO", () => {
  const storage = new MemoryStorage();
  recordBatterySample(storage, "RenderMouse", 75, "discharging", 0);
  storage.getItem = () => { throw new Error("render path must not touch storage"); };
  const samples = cachedBatterySamples(storage, "RenderMouse", 60_000);
  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.percent, 75);
});

test("cached battery samples load once from storage on cold start", () => {
  const storage = new MemoryStorage();
  saveBatterySample(storage, "ColdMouse", 75, "discharging", 0);
  const samples = cachedBatterySamples(storage, "ColdMouse", 60_000);
  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.percent, 75);
});

test("rated battery life is known for the Superstrike mice, whatever the spacing of the name", () => {
  assert.equal(ratedBattery("PRO X3 SUPERSTRIKE")?.hours, 135);
  assert.equal(ratedBattery("PRO X 2 Superstrike")?.hours, 90);
  assert.equal(ratedBattery("PRO X2 SUPERSTRIKE")?.hours, 90);
  assert.equal(ratedBattery("Some other mouse"), null);
});

test("the PRO X 3's full-charge hours follow the polling rate by its power draw", () => {
  const x3 = ratedBattery("PRO X3 SUPERSTRIKE")!;
  // 135 h at 1000 Hz (4 + 4 mW) is 1080 mWh; 8000 Hz draws 12 + 20 = 32 mW.
  assert.equal(ratedFullChargeHours(x3, 1000), 135);
  assert.equal(ratedFullChargeHours(x3, 8000), 33.75);
  assert.equal(ratedFullChargeHours(x3, 125), 216, "125 Hz draws 4 + 1 = 5 mW");
  assert.equal(ratedFullChargeHours(x3, 3000), 135, "an unlisted rate falls back to the rated hours");
  assert.equal(ratedFullChargeHours(x3, null), 135);
  // The PRO X 2 has no power table, so the rate changes nothing.
  assert.equal(ratedFullChargeHours(ratedBattery("PRO X2 SUPERSTRIKE")!, 8000), 90);
});

test("the rated-life estimate scales with the charge and the rate, in the usual format", () => {
  const x3 = ratedBattery("PRO X3 SUPERSTRIKE")!;
  assert.equal(estimateFromRatedLife(100, x3, 1000), "~5.6 days");
  assert.equal(estimateFromRatedLife(51, x3, 1000), "~2.9 days");
  assert.equal(estimateFromRatedLife(51, x3, 8000), "~17 hr", "51% of 33.75 h");
  assert.equal(estimateFromRatedLife(10, ratedBattery("PRO X2 SUPERSTRIKE")!, 1000), "~9.0 hr");
  assert.equal(estimateFromRatedLife(0, x3, 1000), null, "an empty battery has no time left to show");
});

test("full-charge hours follow the polling rate on a model with a power table, and are unknown otherwise", () => {
  assert.equal(fullChargeHoursAt("PRO X3 SUPERSTRIKE", 1000), 135);
  assert.equal(fullChargeHoursAt("PRO X3 SUPERSTRIKE", 8000), 33.75);
  assert.equal(fullChargeHoursAt("PRO X3 SUPERSTRIKE", 3000), null);
  assert.equal(fullChargeHoursAt("Some other mouse", 1000), null);
});
