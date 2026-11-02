import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATK_BUTTON_CLASS,
  ATK_R1_MACRO_START_TYPES,
} from "@openmouse/protocol/atk";
import {
  atkMacroBindingStartType,
  atkSensorModes,
  atkVisibleButtons,
} from "./atk-capabilities.ts";

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

test("macro start mode follows the selected button's binding, not the slot's first binding", () => {
  const back = {
    keyClass: ATK_BUTTON_CLASS.macro,
    value1: 2,
    value2: ATK_R1_MACRO_START_TYPES.stopImmediately,
  };
  const forward = {
    keyClass: ATK_BUTTON_CLASS.macro,
    value1: 2,
    value2: ATK_R1_MACRO_START_TYPES.repeatUntilTriggerPress,
  };

  assert.equal(atkMacroBindingStartType(back, 2), ATK_R1_MACRO_START_TYPES.stopImmediately);
  assert.equal(
    atkMacroBindingStartType(forward, 2),
    ATK_R1_MACRO_START_TYPES.repeatUntilTriggerPress,
  );
  assert.equal(
    atkMacroBindingStartType(forward, 3),
    ATK_R1_MACRO_START_TYPES.stopImmediately,
  );
  assert.equal(atkMacroBindingStartType(undefined, 2), ATK_R1_MACRO_START_TYPES.stopImmediately);
});
