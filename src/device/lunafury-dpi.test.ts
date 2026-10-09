import assert from "node:assert/strict";
import test from "node:test";
import { lunaFuryDpiEdits, lunaFuryDpiInput } from "./lunafury-dpi.ts";

test("vendor DPI inputs round down to 50 and stay within the sensor range", () => {
  for (const [raw, expected] of [["", 50], ["0", 50], ["-100", 50], ["849", 800],
    ["850", 850], ["30001", 30000], ["Infinity", 50], ["bad", 50]] as const) {
    assert.equal(lunaFuryDpiInput(raw), expected);
  }
});

const rows = [
  { enabled: true, x: 400, y: 800 },
  { enabled: true, x: 800, y: 1600 },
  { enabled: true, x: 1600, y: 3200 },
];

test("removing a middle DPI stage moves its surviving X/Y pairs together", () => {
  assert.deepEqual(lunaFuryDpiEdits(rows.map((row, index) => ({ ...row, enabled: index !== 1 })),
    [400, 800, 1600], [800, 1600, 3200], true), [{ stage: 1, x: 1600, y: 3200 }]);
});

test("removing the first stage retains the Y values of both surviving stages", () => {
  assert.deepEqual(lunaFuryDpiEdits(rows.map((row, index) => ({ ...row, enabled: index !== 0 })),
    [400, 800, 1600], [800, 1600, 3200], true), [
    { stage: 0, x: 800, y: 1600 }, { stage: 1, x: 1600, y: 3200 },
  ]);
});

test("editing X preserves independent Y and linked axes use X for both", () => {
  const changed = [{ ...rows[0], x: 1200 }];
  assert.deepEqual(lunaFuryDpiEdits(changed, [400], [800], true), [{ stage: 0, x: 1200, y: 800 }]);
  assert.deepEqual(lunaFuryDpiEdits(changed, [400], [800], false), [{ stage: 0, x: 1200, y: 1200 }]);
  assert.deepEqual(lunaFuryDpiEdits(rows, [400, 800, 1600], [800, 1600, 3200], true), []);
});
