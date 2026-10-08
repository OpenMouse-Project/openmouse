import assert from "node:assert/strict";
import test from "node:test";
import { pollingRateText, selectedPollingStep } from "./polling-rate.ts";

const RATES = [125, 250, 500, 1000, 2000, 4000, 8000];

test("unavailable driver rates display a dash and never select the 125 Hz button", () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(pollingRateText(value), "—");
    assert.equal(selectedPollingStep(RATES, value), null);
  }
  assert.equal(selectedPollingStep(RATES, null), null);
});

test("8K polling can select its real step and known off-grid rates keep nearest-step behavior", () => {
  assert.equal(selectedPollingStep(RATES, 8000), 6);
  assert.equal(selectedPollingStep(RATES, 1000), 3);
  assert.equal(selectedPollingStep(RATES, 750), 2);
  assert.equal(selectedPollingStep([], 1000), null);
  assert.notEqual(pollingRateText(8000), "—");
});
