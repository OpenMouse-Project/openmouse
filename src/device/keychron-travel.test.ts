import assert from "node:assert/strict";
import test from "node:test";
import type { KeychronState } from "@openmouse/keyboard-protocol/drivers";
import { mmToSteps, stepsToMm, travelBounds, travelToSteps } from "./keychron-travel.ts";

const base: KeychronState = {
  productId: 0x040c, heVersion: 4, features: { switchAxis: true, resetSingleKey: false, dkr: false, turbo: false, gamepadDisable: false, supportMechanical: true },
  unit: 0.1, profileSize: 0, dksCount: null, snapTapCount: null, rows: 6, cols: 19, travel: { min: 0.2, max: 3.3, deadzone: 0.2 },
};

test("steps and millimetres round trip without float drift", () => {
  assert.equal(stepsToMm(33, 0.1), 3.3);
  assert.equal(mmToSteps(3.3, 0.1), 33);
  assert.equal(stepsToMm(7, 0.01), 0.07);
  assert.equal(mmToSteps(0.07, 0.01), 7);
});

test("the dead zone extends the top of the range, not the bottom", () => {
  assert.deepEqual(travelBounds(base), { stepMm: 0.1, minMm: 0.2, maxMm: 3.5, deadzoneMm: 0.2, fromBoard: true });
  const deep = travelBounds({ ...base, travel: { min: 0.1, max: 3.1, deadzone: 0.4 } });
  assert.equal(deep.minMm, 0.1);
  assert.equal(deep.maxMm, 3.5);
  assert.equal(travelBounds({ ...base, travel: { min: 0.1, max: 3.35 } }).maxMm, 3.35);
});

test("a board without a declared range is limited to what a slot can store", () => {
  const older = travelBounds({ ...base, travel: null });
  assert.equal(older.fromBoard, false);
  assert.equal(older.maxMm, 6.3);
  const v5 = travelBounds({ ...base, travel: null, heVersion: 5, unit: 0.01 });
  assert.equal(v5.maxMm, 163.83);
  assert.equal(travelBounds({ ...base, travel: { min: 0.1, max: 9 } }).maxMm, 6.3);
});

test("requests convert to steps and out-of-range values throw", () => {
  assert.deepEqual(travelToSteps(base, { pressMm: 1.5, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.4 }), { press: 15, sensitivePress: 3, sensitiveRelease: 4 });
  assert.throws(() => travelToSteps(base, { pressMm: 0.1, sensitivePressMm: 0.3, sensitiveReleaseMm: 0.4 }), RangeError);
  assert.throws(() => travelToSteps(base, { pressMm: 1, sensitivePressMm: 3.6, sensitiveReleaseMm: 0.4 }), RangeError);
  assert.equal(travelToSteps(base, { pressMm: 3.5, sensitivePressMm: 0.2, sensitiveReleaseMm: 0.4 }).press, 35);
});
