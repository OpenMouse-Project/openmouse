import assert from "node:assert/strict";
import test from "node:test";

import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { changedFields, draftProfileSnapshot, editableProfileFields, matchingProfileFields, mergeSnapshots, pickSnapshot, sanitizeSnapshot, snapshotDiff, snapshotKey } from "./game-profile-snapshot.ts";

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

test("LunaFury edits save and restore only the individual controls changed", () => {
  const before = status({ brand: "LunaFury", lunafury: {
    lightningMode: 0, leftDebounceMs: 0, rightDebounceMs: 3, middleDebounceMs: 8,
    wheelGuard: { enabled: false, windowMs: 0 },
  } });
  const after = structuredClone(before);
  after.lunafury!.middleDebounceMs = 1;
  after.lunafury!.wheelGuard = { enabled: true, windowMs: 100 };
  const saved = snapshotDiff(before, after);
  assert.deepEqual(saved, { lunafury: { middleDebounceMs: 1, wheelGuard: { enabled: true, windowMs: 100 } } });
  assert.deepEqual(pickSnapshot(before, saved), { lunafury: { middleDebounceMs: 8, wheelGuard: { enabled: false, windowMs: 0 } } });
  after.lunafury!.wheelGuard!.windowMs = 200;
  assert.equal(saved.lunafury!.wheelGuard!.windowMs, 100, "snapshots must not alias the device or preview");
});

test("LunaFury drafts retain explicitly touched baseline values without capturing peers", () => {
  const before = status({ lunafury: { lightningMode: 0, leftDebounceMs: 0, middleDebounceMs: 8 } });
  const preview = structuredClone(before);
  preview.lunafury!.leftDebounceMs = 1;
  assert.deepEqual(editableProfileFields(before, preview), ["lunafury.leftDebounceMs"]);
  assert.deepEqual(matchingProfileFields(before, { lunafury: { lightningMode: 0, middleDebounceMs: 10 } }), ["lunafury.lightningMode"]);
  assert.deepEqual(draftProfileSnapshot(before, preview, ["lunafury.lightningMode", "lunafury.unknown"]), {
    lunafury: { leftDebounceMs: 1, lightningMode: 0 },
  });
  preview.lunafury!.leftDebounceMs = 0;
  assert.deepEqual(draftProfileSnapshot(before, preview, ["lunafury.leftDebounceMs"]), { lunafury: { leftDebounceMs: 0 } });
  assert.equal(editableProfileFields(before, { ...preview, friendlyName: "not restorable" }), null);
});

test("unsupported LunaFury fields are not captured for restoration", () => {
  const live = status({ lunafury: { middleDebounceMs: 5 } });
  assert.deepEqual(pickSnapshot(live, { lunafury: { lightningMode: 1, middleDebounceMs: 20 } }), {
    lunafury: { middleDebounceMs: 5 },
  });
  assert.deepEqual(pickSnapshot(status(), { lunafury: { lightningMode: 1 } }), {});
});

test("imported LunaFury snapshots are validated and canonically compared", () => {
  assert.deepEqual(sanitizeSnapshot({ dpi: 1600, lunafury: {
    lightningMode: 4, leftDebounceMs: 0, rightDebounceMs: -1, middleDebounceMs: 0,
    wheelGuard: { enabled: true, windowMs: 21 }, unknown: 1,
  } }), { dpi: 1600, lunafury: { leftDebounceMs: 0 } });
  assert.deepEqual(sanitizeSnapshot({ lunafury: {} }), {});
  assert.equal(snapshotKey({ lunafury: { leftDebounceMs: 0, lightningMode: 1 } }),
    snapshotKey({ lunafury: { lightningMode: 1, leftDebounceMs: 0 } }));
  assert.notEqual(snapshotKey({ lunafury: { lightningMode: 0 } }), snapshotKey({ lunafury: { lightningMode: 1 } }));
});

test("switching Games profiles restores previous controls and retains every original value", () => {
  const original = status({ lunafury: { lightningMode: 0, leftDebounceMs: 3, middleDebounceMs: 8 } });
  const first = { lunafury: { lightningMode: 1 as const, leftDebounceMs: 0 } };
  const firstPrior = pickSnapshot(original, first);
  const afterFirst = status({ lunafury: { ...original.lunafury, ...first.lunafury } });
  const second = { lunafury: { middleDebounceMs: 20, leftDebounceMs: 10 } };
  const allPrior = mergeSnapshots(pickSnapshot(afterFirst, second), firstPrior);
  assert.deepEqual(allPrior, { lunafury: { lightningMode: 0, leftDebounceMs: 3, middleDebounceMs: 8 } });
  assert.deepEqual(mergeSnapshots(firstPrior, second), {
    lunafury: { lightningMode: 0, leftDebounceMs: 10, middleDebounceMs: 20 },
  }, "settings omitted by the next game go back to their originals");
  assert.deepEqual(firstPrior, { lunafury: { lightningMode: 0, leftDebounceMs: 3 } });
  assert.deepEqual(mergeSnapshots({ dpi: 800 }, { pollingRateHz: 2000, dpi: 1600 }), { dpi: 1600, pollingRateHz: 2000 });
});
