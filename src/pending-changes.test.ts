import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingChanges,
  hasPendingChanges,
  pendingChanges,
  stagePendingChange,
  withPendingChanges,
} from "./pending-changes.ts";
import type { MouseStatus } from "./devices/mouse-types";

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

test("pending changes preview without mutating the device status", () => {
  clearPendingChanges();
  const deviceStatus = status();
  stagePendingChange({ key: "dpi", label: "DPI 1600", command: "", progress: "", preview: (value) => { value.dpi = 1600; }, apply: async () => {} });

  assert.equal(withPendingChanges(deviceStatus).dpi, 1600);
  assert.equal(deviceStatus.dpi, 800);
  clearPendingChanges();
  assert.equal(hasPendingChanges(), false);
});
