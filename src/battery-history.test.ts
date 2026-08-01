import assert from "node:assert/strict";
import test from "node:test";

import { estimateBatteryTime, saveBatterySample } from "./battery-history.ts";

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
