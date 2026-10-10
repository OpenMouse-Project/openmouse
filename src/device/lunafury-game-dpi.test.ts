import assert from "node:assert/strict";
import test from "node:test";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { draftProfileSnapshot, mergeSnapshots, pickSnapshot, sanitizeSnapshot, snapshotDiff } from "./game-profile-snapshot.ts";
import { lunaFuryGameDpiPlan, stageLunaFuryGameDpi } from "./lunafury-game-dpi.ts";

function status(): MouseStatus {
  return { brand: "LunaFury", name: "LUNA33", batteryPercent: 90, batteryState: "Discharging", firmware: [],
    dpi: 800, dpiY: 1600, activeDpiStage: 1, dpiStages: [400, 800, 1600], dpiStagesY: [800, 1600, 3200],
    pollingRateHz: 1000, lunafury: { separateDpiAxes: true },
    ui: { dpiStageEditor: { maxStages: 6, countEditable: true, minDpi: 50, maxDpi: 30000, stepDpi: 50 } } };
}

test("a LunaFury selection diff and touched draft save only the stage, not derived DPI", () => {
  const before = status();
  const after = { ...before, activeDpiStage: 2, dpi: 1600, dpiY: 3200 };
  assert.deepEqual(snapshotDiff(before, after), { activeDpiStage: 2 });
  assert.deepEqual(draftProfileSnapshot(before, after, ["dpi", "dpiY", "activeDpiStage"]), { activeDpiStage: 2 });
  assert.deepEqual(pickSnapshot(before, snapshotDiff(before, after)), { activeDpiStage: 1 });
  assert.deepEqual(lunaFuryGameDpiPlan(before, { dpi: 1600, dpiY: 3200, activeDpiStage: 2 }), { stages: [], activeStage: 2 });
});

test("legacy DPI scalars edit and back up the target stage when selecting another stage", () => {
  const before = status();
  const target = { dpi: 2000, dpiY: 4000, activeDpiStage: 2 };
  assert.deepEqual(lunaFuryGameDpiPlan(before, target), { stages: [{ stage: 2, x: 2000, y: 4000 }], activeStage: 2 });
  assert.deepEqual(pickSnapshot(before, target), { dpiStages: [400, 800, 1600], dpiStagesY: [800, 1600, 3200], activeDpiStage: 1 });
  const after = { ...before, dpi: 2000, dpiY: 4000, activeDpiStage: 2, dpiStages: [400, 800, 2000], dpiStagesY: [800, 1600, 4000] };
  assert.deepEqual(lunaFuryGameDpiPlan(after, pickSnapshot(before, target)), { stages: [{ stage: 2, x: 1600, y: 3200 }], activeStage: 1 });
});

test("Y-only legacy edits restore their table without copying X over unrelated Y", () => {
  const before = status();
  assert.deepEqual(lunaFuryGameDpiPlan(before, { dpiY: 2400 }), { stages: [{ stage: 1, x: 800, y: 2400 }] });
  assert.deepEqual(pickSnapshot(before, { dpiY: 2400 }), { dpiStages: before.dpiStages, dpiStagesY: before.dpiStagesY });
  assert.deepEqual(lunaFuryGameDpiPlan(before, { dpiStagesY: [1200, 1600, 3200] }), { stages: [{ stage: 0, x: 400, y: 1200 }] });
});

test("table edits keep their explicit stage target and omit redundant displayed DPI", () => {
  const before = status();
  const after = { ...before, dpiStages: [400, 800, 2000], dpiStagesY: [800, 1600, 4000], activeDpiStage: 2, dpi: 2000, dpiY: 4000 };
  const saved = snapshotDiff(before, after);
  assert.deepEqual(saved, { dpiStages: after.dpiStages, dpiStagesY: after.dpiStagesY, activeDpiStage: 2 });
  assert.deepEqual(lunaFuryGameDpiPlan(before, saved), { stages: [{ stage: 2, x: 2000, y: 4000 }], activeStage: 2 });
  const switched = mergeSnapshots(pickSnapshot(before, saved), { dpi: 2400, dpiY: 4800, activeDpiStage: 0 });
  assert.deepEqual(lunaFuryGameDpiPlan(after, switched), {
    stages: [{ stage: 0, x: 2400, y: 4800 }, { stage: 2, x: 1600, y: 3200 }], activeStage: 0,
  });
});

test("stage-count restore includes both axes and the old active stage", () => {
  const before = status();
  const saved = { dpiStages: [400] };
  assert.deepEqual(pickSnapshot(before, saved), { dpiStages: before.dpiStages, dpiStagesY: before.dpiStagesY, activeDpiStage: 1 });
  const calls: unknown[] = [];
  assert.equal(stageLunaFuryGameDpi(before, { dpiStages: [400, 800, 1600, 2000], activeDpiStage: 3 }, {
    count: (count) => calls.push(["count", count]), axes: (...args) => calls.push(["axes", ...args]), active: (stage) => calls.push(["active", stage]),
  }), true);
  assert.deepEqual(calls, [["count", 4], ["axes", 3, 2000, 2000], ["active", 3]]);
});

test("linked scalar edits update X/Y together without changing peers; other brands keep their policy", () => {
  const before = { ...status(), lunafury: { separateDpiAxes: false } };
  assert.deepEqual(lunaFuryGameDpiPlan(before, { dpi: 1200 }), { stages: [{ stage: 1, x: 1200, y: 1200 }] });
  const other = { ...before, brand: "Logitech" };
  assert.equal(lunaFuryGameDpiPlan(other, { dpi: 1600 }), null);
  assert.deepEqual(snapshotDiff(other, { ...other, dpi: 1600, activeDpiStage: 2 }), { dpi: 1600, activeDpiStage: 2 });
});

test("combined axis-mode and X-table changes restore dormant Y values under axis lock", () => {
  const before = { ...status(), lunafury: { separateDpiAxes: false } };
  const target = { dpiStages: [400, 1200, 1600], lunafury: { separateDpiAxes: true } };
  assert.deepEqual(lunaFuryGameDpiPlan(before, target), { stages: [{ stage: 1, x: 1200, y: 1600 }] });
  const prior = pickSnapshot(before, target);
  assert.deepEqual(prior, { dpiStages: before.dpiStages, dpiStagesY: before.dpiStagesY, lunafury: { separateDpiAxes: false } });
  const after = { ...before, dpiStages: target.dpiStages, lunafury: target.lunafury };
  assert.deepEqual(lunaFuryGameDpiPlan(after, prior), { stages: [{ stage: 1, x: 800, y: 1600 }] });
});

test("LunaFury merges normalize base scalars but keep override scalars above restored tables", () => {
  const before = status();
  const base = { dpi: 800, dpiY: 1600, activeDpiStage: 1 };
  const target = { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] };
  const saved = structuredClone(base);
  assert.deepEqual(lunaFuryGameDpiPlan(before, mergeSnapshots(base, target, before)), {
    stages: [{ stage: 1, x: 1200, y: 2400 }], activeStage: 1,
  });
  assert.deepEqual(lunaFuryGameDpiPlan(before, mergeSnapshots(target, { dpi: 2000, dpiY: 4000, activeDpiStage: 0 }, before)), {
    stages: [{ stage: 0, x: 2000, y: 4000 }, { stage: 1, x: 1200, y: 2400 }], activeStage: 0,
  });
  assert.deepEqual(base, saved);
  assert.deepEqual(mergeSnapshots(base, target, { ...before, brand: "Logitech" }), { ...base, ...target });
});

test("LunaFury restoration metadata stays out of sanitized imports and saved drafts", () => {
  const before = status();
  before.lunafury!.dpiStorage = { profile: 1, count: 3,
    stages: [400, 800, 1600, 3200, 6400, 30000].map((x, index) => ({ x, y: [800, 1600, 3200, 6400, 6400, 30000][index] })) };
  const target = { dpiStages: [400, 800, 1600, 2000] };
  const picked = pickSnapshot(before, target);
  assert.deepEqual(picked.lunaFuryDpiStorage, before.lunafury!.dpiStorage);
  assert.notEqual(picked.lunaFuryDpiStorage, before.lunafury!.dpiStorage);
  assert.equal(sanitizeSnapshot(picked).lunaFuryDpiStorage, undefined);
  assert.deepEqual(sanitizeSnapshot({ lunafury: { dpiStorage: before.lunafury!.dpiStorage } }), {});
  const after = structuredClone(before);
  after.lunafury!.dpiStorage!.stages[3].x = 2000;
  assert.deepEqual(draftProfileSnapshot(before, after, []), {});
});
