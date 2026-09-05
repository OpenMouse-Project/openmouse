import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingChanges,
  hasPendingChanges,
  pendingChangeBatches,
  pendingChanges,
  stagePendingChange,
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
