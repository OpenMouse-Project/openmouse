import assert from "node:assert/strict";
import { test } from "node:test";

import { atkSensorModes, atkVisibleButtons } from "./atk-capabilities.ts";

test("sensor modes drop Shard MAX on noAthleticsMax models", () => {
  assert.deepEqual(atkSensorModes(undefined), [0, 1, 2]);
  assert.deepEqual(atkSensorModes({}), [0, 1, 2]);
  assert.deepEqual(atkSensorModes({ noAthleticsMax: true }), [0, 1]);
});

test("button rows drop the bottom row on noBottomButton models", () => {
  const rows = [{ id: "left" }, { id: "right" }, { id: "bottom" }];
  assert.deepEqual(atkVisibleButtons(rows, undefined), rows);
  assert.deepEqual(atkVisibleButtons(rows, {}), rows);
  assert.deepEqual(
    atkVisibleButtons(rows, { noBottomButton: true }),
    [{ id: "left" }, { id: "right" }],
  );
  assert.deepEqual(atkVisibleButtons(undefined, {}), []);
});
