import assert from "node:assert/strict";
import test from "node:test";
import type { KeychronState } from "@openmouse/keyboard-protocol/drivers";
import type { KeychronCurve } from "@openmouse/keyboard-protocol/keychron";
import { CURVE_MAX_Y, clampCurve, curveInRange, curveScale, linearCurve, setCurvePoint } from "./keychron-curve.ts";

const base: KeychronState = {
  productId: 0x040c, heVersion: 4, features: { switchAxis: true, resetSingleKey: false, dkr: false, turbo: false, gamepadDisable: false, supportMechanical: true },
  unit: 0.1, profileSize: 0, dksCount: null, snapTapCount: null, rows: 6, cols: 19, travel: { min: 0.2, max: 3.3, deadzone: 0.2 },
};

test("x runs to floor(10 * (max + dead zone)) and y to 127", () => {
  assert.deepEqual(curveScale(base, null), { maxX: 35, fromBoard: true, unverifiedStep: false });
  assert.equal(curveScale({ ...base, travel: { min: 0.1, max: 3.35 } }, null).maxX, 33);
  assert.equal(curveScale({ ...base, travel: null }, 3.3).maxX, 33);
  assert.deepEqual(curveScale({ ...base, travel: null }, null), { maxX: 255, fromBoard: false, unverifiedStep: false });
  assert.equal(curveScale({ ...base, heVersion: 5 }, null).unverifiedStep, true);
});

test("the linear preset is Launcher's: thirds along, ending at (max, 127)", () => {
  assert.deepEqual(linearCurve(35), [[0, 0], [12, 42], [23, 85], [35, 127]]);
  assert.ok(curveInRange(linearCurve(35), 35));
  assert.ok(curveInRange(linearCurve(255), 255));
});

test("a point stays between its neighbours and inside the ranges", () => {
  const curve = linearCurve(35);
  assert.deepEqual(setCurvePoint(curve, 1, 99, 500, 35)[1], [23, 127]);
  assert.deepEqual(setCurvePoint(curve, 2, -4, -9, 35)[2], [12, 0]);
  assert.deepEqual(setCurvePoint(curve, 0, 8, 3, 35)[0], [8, 3]); // the first point may move right, up to the second point
  assert.deepEqual(setCurvePoint(curve, 0, 40, 3, 35)[0], [12, 3]);
  assert.deepEqual(setCurvePoint(curve, 3, 200, 10, 35)[3], [35, 10]);
  assert.deepEqual(setCurvePoint(curve, 1, Number.NaN, Number.NaN, 35)[1], [0, 0]);
});

test("no sequence of edits can leave a byte out of range", () => {
  let seed = 7;
  const random = (): number => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (const maxX of [1, 33, 35, 255]) {
    let curve: KeychronCurve = linearCurve(maxX);
    for (let step = 0; step < 500; step++) {
      curve = setCurvePoint(curve, Math.floor(random() * 4), (random() - 0.3) * 600, (random() - 0.3) * 400, maxX);
      assert.ok(curveInRange(curve, maxX), JSON.stringify(curve));
    }
  }
});

test("clampCurve repairs a curve outside the ranges", () => {
  const repaired = clampCurve([[40, 200], [30, -3], [220, 50], [10, 127]], 35);
  assert.deepEqual(repaired, [[35, CURVE_MAX_Y], [35, 0], [35, 50], [35, 127]]);
  assert.ok(curveInRange(repaired, 35));
  assert.equal(curveInRange([[0, 0], [36, 0], [36, 0], [36, 0]], 35), false);
});
