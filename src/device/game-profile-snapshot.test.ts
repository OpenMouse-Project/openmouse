import assert from "node:assert/strict";
import test from "node:test";

import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { changedFields, pickSnapshot, sanitizeSnapshot, snapshotDiff, snapshotKey } from "./game-profile-snapshot.ts";

function status(overrides: Partial<MouseStatus> = {}): MouseStatus {
  return {
    brand: "Logitech",
    name: "PRO X SUPERLIGHT 2c",
    batteryPercent: 41,
    batteryState: "Discharging",
    dpi: 800,
    pollingRateHz: 1000,
    liftOffDistance: "High",
    gamingSurfaceMode: "Off",
    lightforceSwitchMode: "Optical",
    firmware: [],
    ...overrides,
  };
}

test("the diff keeps only game-profile fields that changed", () => {
  const before = status();
  const after = status({ dpi: 1600, lightforceSwitchMode: "Hybrid", batteryPercent: 40 });
  assert.deepEqual(snapshotDiff(before, after), { dpi: 1600, lightforceSwitchMode: "Hybrid" });
});

test("nested values are compared by content", () => {
  const before = status({ dpiStages: [400, 800] });
  assert.deepEqual(snapshotDiff(before, status({ dpiStages: [400, 800] })), {});
  assert.deepEqual(snapshotDiff(before, status({ dpiStages: [400, 1600] })), { dpiStages: [400, 1600] });
});

test("picking the prior values covers exactly the fields the profile sets", () => {
  const live = status({ dpi: 800, gamingSurfaceMode: "Auto" });
  assert.deepEqual(pickSnapshot(live, { dpi: 1600, gamingSurfaceMode: "On" }), { dpi: 800, gamingSurfaceMode: "Auto" });
});

test("changedFields reports fields outside the game-profile list too", () => {
  assert.deepEqual(changedFields(status(), status({ friendlyName: "Mine" })), ["friendlyName"]);
});

test("stored snapshots lose fields this build cannot apply", () => {
  assert.deepEqual(sanitizeSnapshot({ dpi: 1600, friendlyName: "x", unknown: 1 }), { dpi: 1600 });
  assert.deepEqual(sanitizeSnapshot(null), {});
  assert.deepEqual(sanitizeSnapshot([1]), {});
});

test("the comparison key ignores field order", () => {
  assert.equal(snapshotKey({ dpi: 800, pollingRateHz: 1000 }), snapshotKey({ pollingRateHz: 1000, dpi: 800 }));
  assert.notEqual(snapshotKey({ dpi: 800 }), snapshotKey({ dpi: 1600 }));
});
