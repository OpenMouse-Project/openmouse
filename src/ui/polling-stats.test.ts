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

  it("keeps a genuine burst within jitter range", () => {
    const intervals = Array.from({ length: 2000 }, () => 1.0);
    intervals.push(0.85, 0.9, 0.88);
    const r = computeResults(intervals, 2000);
    assert.ok(r.peakHz >= 1100 && r.peakHz <= 1200, `burst ${r.peakHz}Hz allowed`);
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