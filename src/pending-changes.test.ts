import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingChanges,
  hasPendingChanges,
  pendingChangeBatches,
  pendingChanges,
  restorePendingChanges,
  stagePendingChange,
  stashPendingChanges,
  withPendingChanges,
} from "./pending-changes.ts";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

function status(): MouseStatus {
  return {
    brand: "Logitech",
    name: "Test mouse",
    batteryPercent: 100,
    batteryState: "Full",
    dpi: 800,
    supportsSeparateDpiAxes: false,
    pollingRateHz: 1000,
    supportedPollingRates: [1000],
    liftOffDistance: "Medium",
    firmware: [],
  };
}

test("staged changes replace earlier values for the same setting", () => {
  clearPendingChanges();
  stagePendingChange({ key: "dpi", label: "DPI 800", command: "", progress: "", preview: (value) => { value.dpi = 800; }, apply: async () => {} });
  stagePendingChange({ key: "dpi", label: "DPI 1600", command: "", progress: "", preview: (value) => { value.dpi = 1600; }, apply: async () => {} });

  assert.equal(pendingChanges().length, 1);
  assert.equal(pendingChanges()[0]?.label, "DPI 1600");
  clearPendingChanges();
});

test("a change with no preview still stages", () => {
  // Settings that live outside MouseStatus (Logitech onboard profile values)
  // omit preview and render themselves, so previewing must be a no-op rather
  // than a reason to skip the change.
  clearPendingChanges();
  const deviceStatus = status();
  stagePendingChange({ key: "bunny-hop", label: "Bunny hop 200 ms", command: "", progress: "", apply: async () => {} });

  assert.equal(hasPendingChanges(), true);
  assert.equal(pendingChanges()[0]?.label, "Bunny hop 200 ms");
  assert.deepEqual(withPendingChanges(deviceStatus), deviceStatus);
  clearPendingChanges();
});

test("changes sharing a group collapse into one write", () => {
  clearPendingChanges();
  const written: string[] = [];
  const stage = (key: string, group?: string) => stagePendingChange({
    key, group, label: key, command: "", progress: "",
    apply: async () => { written.push(key); },
  });

  stage("gaming-surface", "mode-status");
  stage("dpi");
  stage("lightforce", "mode-status");

  const batches = pendingChangeBatches();
  assert.equal(batches.length, 2, "the two mode-status changes share a batch");
  // The group keeps the position of its first member, so the flash order
  // follows the order settings were touched.
  assert.deepEqual(batches[0]?.map((change) => change.key), ["gaming-surface", "lightforce"]);
  assert.deepEqual(batches[1]?.map((change) => change.key), ["dpi"]);

  // A batch is written by its last member, which carries the combined value.
  assert.equal(batches[0]?.at(-1)?.key, "lightforce");
  clearPendingChanges();
});

test("restaging a grouped change does not split its group", () => {
  clearPendingChanges();
  const stage = (key: string, group: string) => stagePendingChange({
    key, group, label: key, command: "", progress: "", apply: async () => {},
  });

  stage("gaming-surface", "mode-status");
  stage("lightforce", "mode-status");
  // Re-selecting a value re-inserts the key, which must not leave the group
  // behind as a second batch and write the byte twice.
  stage("gaming-surface", "mode-status");

  const batches = pendingChangeBatches();
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.length, 2);
  clearPendingChanges();
});

test("priority orders count increases first and reductions last", () => {
  clearPendingChanges();
  const stage = (key: string, priority?: number) => stagePendingChange({
    key, priority, label: key, command: "", progress: "", apply: async () => {},
  });

  stage("dpi-stage-count", -1);
  stage("dpi-stage-color-3");
  stage("dpi-stage-count", -1);

  assert.deepEqual(pendingChangeBatches().map(([change]) => change?.key), [
    "dpi-stage-count",
    "dpi-stage-color-3",
  ]);

  clearPendingChanges();
  stage("dpi-stage-count", 1);
  stage("dpi-stage-0");
  stage("dpi-stage-count", 1);
  assert.deepEqual(pendingChangeBatches().map(([change]) => change?.key), [
    "dpi-stage-0",
    "dpi-stage-count",
  ]);
  clearPendingChanges();
});

test("pending changes preview without mutating the device status", () => {
  clearPendingChanges();
  const deviceStatus = status();
  stagePendingChange({ key: "dpi", label: "DPI 1600", command: "", progress: "", preview: (value) => { value.dpi = 1600; }, apply: async () => {} });

  assert.equal(withPendingChanges(deviceStatus).dpi, 1600);
  assert.equal(deviceStatus.dpi, 800);
  clearPendingChanges();
  assert.equal(hasPendingChanges(), false);
});

test("state-dependent priorities re-evaluate the same staging after hardware count changes", () => {
  clearPendingChanges();
  try {
    stagePendingChange({ key: "count", label: "", command: "", progress: "",
      resolvePriority: current => 4 > current.dpiStages!.length ? -1 : 4 < current.dpiStages!.length ? 1 : 0,
      apply: async () => {} });
    stagePendingChange({ key: "slot", label: "", command: "", progress: "", apply: async () => {} });
    const current = { ...status(), dpiStages: [400, 800, 1600, 3200, 6400, 8000] };
    const staged = pendingChanges();
    assert.deepEqual(pendingChangeBatches(current).map(([change]) => change?.key), ["slot", "count"]);
    current.dpiStages = current.dpiStages.slice(0, 3);
    assert.deepEqual(pendingChangeBatches(current).map(([change]) => change?.key), ["count", "slot"]);
    current.dpiStages.push(3200);
    assert.deepEqual(pendingChangeBatches(current).map(([change]) => change?.key), ["count", "slot"]);
    assert.deepEqual(pendingChanges(), staged, "resolving must not replace or reorder the stored user edits");
  } finally {
    clearPendingChanges();
  }
});

test("dynamic ordering requires status even for a single batch", () => {
  clearPendingChanges();
  try {
    stagePendingChange({ key: "count", label: "", command: "", progress: "",
      resolvePriority: () => -1, apply: async () => {} });
    assert.throws(() => pendingChangeBatches(), /Confirmed device status is required/);
  } finally {
    clearPendingChanges();
  }
});

test("dynamic ordering preserves grouped last-writer semantics and stable equal priorities", () => {
  clearPendingChanges();
  try {
    const stage = (key: string, group?: string) => stagePendingChange({
      key, group, label: "", command: "", progress: "", apply: async () => {} });
    stagePendingChange({ key: "mode-first", group: "mode", label: "", command: "", progress: "",
      resolvePriority: () => 0, apply: async () => {} });
    stage("unrelated");
    stage("mode-last", "mode");
    stagePendingChange({ key: "count", label: "", command: "", progress: "",
      resolvePriority: () => -1, apply: async () => {} });
    const batches = pendingChangeBatches(status());
    assert.deepEqual(batches.map(batch => batch.map(change => change.key)),
      [["count"], ["mode-first", "mode-last"], ["unrelated"]]);
    assert.equal(batches[1].at(-1)?.key, "mode-last");
  } finally {
    clearPendingChanges();
  }
});

test("stashed changes come back in their original order after another set was staged", () => {
  clearPendingChanges();
  const change = (key: string) => ({ key, label: key, command: "", progress: "", apply: async () => {} });
  stagePendingChange(change("a"));
  stagePendingChange(change("b"));

  const stashed = stashPendingChanges();
  assert.equal(hasPendingChanges(), false);
  stagePendingChange(change("draft"));

  restorePendingChanges(stashed);
  assert.deepEqual(pendingChanges().map((entry) => entry.key), ["a", "b"]);
  clearPendingChanges();
});
