import assert from "node:assert/strict";
import test from "node:test";

import { nearestRate, RATE_STEPS_HZ, shortRate } from "./rate-slider.ts";

test("shortRate keeps the scale narrow enough to fit under a card", () => {
  assert.equal(shortRate(125), "125");
  assert.equal(shortRate(1000), "1K");
  assert.equal(shortRate(8000), "8K");
});

test("nearestRate picks a default the mouse actually supports", () => {
  const supported = [500, 1000, 2000, 4000, 8000]; // Finalmouse UltralightX: no 125/250

  assert.equal(nearestRate(supported, 4000), 4000, "an exact match wins");
  assert.equal(nearestRate(supported, 125), 500, "below the range clamps up to the lowest");
  assert.equal(nearestRate(supported, 16000), 8000, "above the range clamps down to the highest");
  assert.equal(nearestRate(RATE_STEPS_HZ, 1000), 1000);
});

test("nearestRate breaks ties downward so a default never picks the faster rate", () => {
  assert.equal(nearestRate([1000, 2000], 1500), 1000);
});

test("nearestRate reports no answer rather than undefined for an empty list", () => {
  // Game Mode enrolls automatically, so a driver that advertises no rates must
  // not be able to enroll `undefined` as a polling rate.
  assert.equal(nearestRate([], 1000), null);
});
