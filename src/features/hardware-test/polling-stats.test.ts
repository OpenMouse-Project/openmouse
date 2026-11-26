import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeResults, rollingLiveHz } from "./polling-stats.ts";

describe("polling stats", () => {
  it("rejects sub-interval aliasing artifacts from the peak", () => {
    const intervals = Array.from({ length: 2000 }, () => 1.0);
    intervals.push(0.4, 0.42, 0.5, 0.38);
    const r = computeResults(intervals, 2000);
    assert.ok(r.peakHz <= 1000, `peak ${r.peakHz}Hz must not exceed nominal`);
    assert.ok(r.avgHz > 900 && r.avgHz < 1100, `avg ${r.avgHz}Hz ~ 1000`);
  });

  it("never reports a peak above the modal (nominal) rate", () => {
    const intervals = Array.from({ length: 2000 }, () => 1.0);
    intervals.push(0.95, 0.92, 0.98, 0.85);
    const r = computeResults(intervals, 2000);
    assert.ok(r.peakHz <= 1000.1, `peak ${r.peakHz}Hz capped at modal rate`);
    assert.ok(r.peakHz >= 990, `peak ${r.peakHz}Hz should sit near 1000`);
  });

  it("applies the same ceiling to a real 2k mouse", () => {
    const intervals = Array.from({ length: 4000 }, () => 0.5);
    intervals.push(0.45);
    const r = computeResults(intervals, 2000);
    assert.ok(r.avgHz > 1900 && r.avgHz < 2150, `avg ${r.avgHz}Hz ~ 2000`);
    assert.ok(r.peakHz > 1950 && r.peakHz <= 2000.1, `peak ${r.peakHz}Hz ~ 2000`);
  });

  it("reports the true sustained rate of an 8k mouse", () => {
    const intervals = Array.from({ length: 8000 }, () => 0.125);
    const r = computeResults(intervals, 1000);
    assert.ok(r.avgHz > 7000 && r.avgHz < 8500, `avg ${r.avgHz}Hz ~ 8000`);
    assert.ok(r.peakHz > 7000 && r.peakHz <= 8000.1, `peak ${r.peakHz}Hz ~ 8000`);
  });

  it("gives green stability for a tight poll stream", () => {
    const intervals = Array.from({ length: 2000 }, () => 1.0);
    const r = computeResults(intervals, 2000);
    assert.ok(r.stability >= 90, `stability ${r.stability}% must be green`);
    assert.ok(r.jitter <= 10, `jitter ${r.jitter}% must be low`);
  });

  it("stability stays green with normal jitter and a few gaps", () => {
    const intervals = Array.from({ length: 2000 }, () => 1.0 + (Math.random() - 0.5) * 0.1);
    for (let i = 0; i < 30; i++) intervals.push(2.5, 3.0);
    const r = computeResults(intervals, 2000);
    assert.ok(r.stability >= 85, `stability ${r.stability}%`);
    assert.ok(r.dropouts >= 30 && r.dropouts <= 60, `dropouts ${r.dropouts}`);
  });

  it("rolling live reading is median-stable against artifacts", () => {
    const intervals = [1.0, 1.0, 1.0, 1.0, 1.0, 0.3, 1.0, 1.0];
    assert.equal(rollingLiveHz(intervals), 1000);
  });
});