import assert from "node:assert/strict";
import test from "node:test";

import { averageMs, bounceReport, savedMs, stepTimes } from "./hits-test.ts";

const press = (...steps: [number, number][]) => steps.map(([t, depth]) => ({ t, depth }));

test("a low actuation fires before the conventional step, by the travel time between them", () => {
  const samples = press([0, 1], [4, 2], [9, 3], [15, 4], [22, 5], [30, 7]);
  assert.equal(savedMs(samples, 2), 18);
  assert.equal(savedMs(samples, 4), 7);
});

test("actuation at the conventional step saves nothing, and a deeper one costs time", () => {
  const samples = press([0, 1], [5, 3], [10, 5], [16, 7]);
  assert.equal(savedMs(samples, 5), 0);
  assert.equal(savedMs(samples, 7), -6);
});

test("a press that never reaches a step cannot be compared", () => {
  assert.equal(savedMs(press([0, 1], [5, 3]), 2), null);
  assert.equal(savedMs([], 2), null);
});

test("step times count from the start and are null for steps the press skipped", () => {
  const samples = press([100, 1], [110, 3], [120, 4], [135, 6]);
  assert.deepEqual(stepTimes(samples, 80), [20, 30, 30, 40, 55, 55, null, null, null, null]);
});

test("the average skips presses that could not be compared", () => {
  assert.equal(averageMs([10, null, 20]), 15);
  assert.equal(averageMs([null, null]), null);
});

test("presses closer than the bounce gap are counted as bounce", () => {
  assert.deepEqual(bounceReport([0, 120, 135, 300, 310, 600]), { clicks: 6, bounces: 2, longestGap: 15 });
  assert.deepEqual(bounceReport([0, 100, 250]), { clicks: 3, bounces: 0, longestGap: null });
  assert.deepEqual(bounceReport([]), { clicks: 0, bounces: 0, longestGap: null });
});
