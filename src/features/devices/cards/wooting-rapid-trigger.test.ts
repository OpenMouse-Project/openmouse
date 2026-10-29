import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWootingRapidTriggerMap,
  wootingRapidTriggerBase,
  wootingRapidTriggerStrict,
} from "./wooting-rapid-trigger.ts";

const custom = {
  primarySensitivityRaw: 17203,
  primarySensitivityMm: 0.2,
  secondarySensitivityRaw: null,
  secondarySensitivityMm: null,
  continuousMode: true,
};

test("per-key rapid trigger flattens firmware groups into a matrix lookup", () => {
  const map = buildWootingRapidTriggerMap({
    groups: [
      { keys: [0x20, 0x21], enabled: null, config: custom },
      { keys: [0x22], enabled: false, config: null },
      { keys: [0x23], enabled: true, config: null },
      // Valid matrix position that is not on the 60% drawing.
      { keys: [0x1f], enabled: false, config: null },
    ],
  });
  assert.deepEqual(map.byMatrix.get(0x20), {
    kind: "custom",
    sensitivityMm: 0.2,
    secondarySensitivityMm: null,
    continuous: true,
  });
  assert.equal(map.byMatrix.get(0x20), map.byMatrix.get(0x21));
  assert.deepEqual(map.byMatrix.get(0x22), { kind: "off" });
  assert.deepEqual(map.byMatrix.get(0x23), { kind: "base" });
  assert.deepEqual(map.unmapped.map((entry) => [entry.matrix, entry.row, entry.col, entry.state.kind]), [
    [0x1f, 0, 31, "off"],
  ]);
  assert.deepEqual(buildWootingRapidTriggerMap(null), { byMatrix: new Map(), unmapped: [] });
});

test("profile rapid trigger reads the base fields and inverts strict range", () => {
  const base = wootingRapidTriggerBase({
    profileFields: [
      { field: 3, value: 1 },
      { field: 4, value: 17203 },
      { field: 7, value: 1 },
    ],
  });
  assert.equal(base.enabled, true);
  assert.ok(base.sensitivityMm !== null && Math.abs(base.sensitivityMm - 0.2) < 0.001);
  assert.equal(base.strict, true);
  assert.equal(base.continuous, false);

  const loose = wootingRapidTriggerBase({ profileFields: [{ field: 7, value: 0 }] });
  assert.equal(loose.strict, false);
  assert.equal(loose.continuous, true);
  assert.equal(loose.enabled, null);
  assert.equal(loose.sensitivityMm, null);

  assert.deepEqual(wootingRapidTriggerBase(null), {
    enabled: null,
    sensitivityMm: null,
    strict: null,
    continuous: null,
  });
});

test("an absent continuous mode is treated as off, which means strict range", () => {
  assert.equal(wootingRapidTriggerStrict(null), true);
  assert.equal(wootingRapidTriggerStrict(false), true);
  assert.equal(wootingRapidTriggerStrict(true), false);
});
