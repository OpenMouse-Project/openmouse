import assert from "node:assert/strict";
import test from "node:test";

import { snapCpiToDevice, valuesWithCurrent } from "./options.ts";

test("a current value outside the writable range remains visible", () => {
  assert.deepEqual(valuesWithCurrent([1, 2, 3], 0), [0, 1, 2, 3]);
  assert.deepEqual(valuesWithCurrent([1, 2, 3], 4), [1, 2, 3, 4]);
});

test("a writable current value is not duplicated", () => {
  const offered = [1, 2, 3];
  assert.equal(valuesWithCurrent(offered, 2), offered);
  assert.equal(valuesWithCurrent(offered, null), offered);
  assert.equal(valuesWithCurrent(offered, undefined), offered);
});

test("CPI snaps to the step of the range the value sits in", () => {
  // OP1/XM2 8K v2 (0x1978): 10–30,000, 10-CPI steps up to 10,000 and 50 above.
  const v2 = { min: 10, max: 30_000, stepLow: 10, stepHigh: 50 };
  assert.equal(snapCpiToDevice(8_000, v2), 8_000);
  assert.equal(snapCpiToDevice(9_995, v2), 10_000);
  assert.equal(snapCpiToDevice(10_000, v2), 10_000);
  // Above the boundary a 10-CPI value is not something the mouse can store.
  assert.equal(snapCpiToDevice(10_010, v2), 10_000);
  assert.equal(snapCpiToDevice(10_030, v2), 10_050);
  assert.equal(snapCpiToDevice(10_060, v2), 10_050);
  assert.equal(snapCpiToDevice(0, v2), 10);
  assert.equal(snapCpiToDevice(30_040, v2), 30_000);
});

test("a single-step mouse is left on its own grid", () => {
  // OP1 8K (0x1964): 50–26,000 in 50s at both ends.
  const v1 = { min: 50, max: 26_000, stepLow: 50, stepHigh: 50 };
  assert.equal(snapCpiToDevice(800, v1), 800);
  assert.equal(snapCpiToDevice(26_030, v1), 26_000);
  assert.equal(snapCpiToDevice(26_093, v1), 26_000);
});
