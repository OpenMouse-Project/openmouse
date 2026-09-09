import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeResults, rollingLiveHz } from "./polling-stats.ts";

describe("polling stats", () => {
  it("rejects sub-interval aliasing artifacts from the peak", () => {
    const trueInterval = 1.0;
    const intervals = Array.from({ length: 2000 }, () => trueInterval);
    intervals.push(0.4, 0.42, 0.5, 0.38);
    const r = computeResults(intervals, 2000);
    assert.ok(r.peakHz < 1500, `peak ${r.peakHz}Hz must stay near the real rate`);
    assert.ok(r.avgHz > 900 && r.avgHz < 1100, `avg ${r.avgHz}Hz ~ 1000`);
  });

  it("keeps a genuine burst within the jitter ceiling", () => {
    const intervals = Array.from({ length: 2000 }, () => 1.0);
    intervals.push(0.95, 0.92, 0.98);
    const r = computeResults(intervals, 2000);
    assert.ok(r.peakHz >= 1010 && r.peakHz <= 1111, `burst ${r.peakHz}Hz bounded`);
  });

  it("caps peak at ~11% above the modal rate", () => {
    const intervals = Array.from({ length: 2000 }, () => 1.0);
    intervals.push(0.95);
    const r = computeResults(intervals, 2000);
    assert.ok(r.peakHz <= 1100.1, `peak ${r.peakHz}Hz must not cross ceiling`);
  });

  it("applies the same ceiling to a real 2k mouse", () => {
    const intervals = Array.from({ length: 4000 }, () => 0.5);
    intervals.push(0.45);
    const r = computeResults(intervals, 2000);
    assert.ok(r.avgHz > 1900 && r.avgHz < 2150, `avg ${r.avgHz}Hz ~ 2000`);
    assert.ok(r.peakHz > 1950 && r.peakHz < 2250, `peak ${r.peakHz}Hz ~ 2000`);
  });

  it("reports the true sustained rate of an 8k mouse", () => {
    const intervals = Array.from({ length: 8000 }, () => 0.125);
    const r = computeResults(intervals, 1000);
    assert.ok(r.avgHz > 7000 && r.avgHz < 8500, `avg ${r.avgHz}Hz ~ 8000`);
    assert.ok(r.peakHz > 7000 && r.peakHz < 8500, `peak ${r.peakHz}Hz ~ 8000`);
  });

  it("rolling live reading is median-stable against artifacts", () => {
    const intervals = [1.0, 1.0, 1.0, 1.0, 1.0, 0.3, 1.0, 1.0];
    assert.equal(rollingLiveHz(intervals), 1000);
  });
});