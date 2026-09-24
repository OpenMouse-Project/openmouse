import assert from "node:assert/strict";
import test from "node:test";

import {
  crosscheckSupportedDevices,
} from "./supported-devices-crosscheck.ts";
import type { HardwareDeviceInfo } from "./hardware-test-report.ts";

function device(overrides: Partial<HardwareDeviceInfo> = {}): HardwareDeviceInfo {
  return {
    present: true,
    brand: null,
    name: null,
    vendorId: null,
    productId: null,
    productName: null,
    transport: "webhid",
    connectionType: "Wireless 2.4 GHz",
    pollingRateHz: null,
    supportedPollingRates: null,
    dpi: null,
    dpiStages: null,
    activeDpiStage: null,
    batteryPercent: null,
    batteryState: null,
    firmware: null,
    liftOffDistance: null,
    driverFamily: null,
    deviceMode: null,
    ...overrides,
  };
}

test("crosscheckSupportedDevices is skipped without a connected device", () => {
  const result = crosscheckSupportedDevices(device({ present: false }), "pass");
  assert.equal(result.listed, false);
  assert.equal(result.matchedBy, null);
  assert.match(result.detail, /no device connected/);
});

test("pid match on a supported row reports no update needed", () => {
  const result = crosscheckSupportedDevices(
    device({ brand: "Logitech", name: "G502 HERO", vendorId: 0x046d, productId: 0xc08b }),
    "pass",
  );
  assert.equal(result.listed, true);
  assert.equal(result.matchedBy, "pid");
  assert.equal(result.status, "supported");
  assert.match(result.detail, /already listed as Supported/);
  assert.doesNotMatch(result.detail, /moving it to Supported/);
});

test("pid matches prefer the row whose brand matches the device", () => {
  // Both Incott rows share the 0x522c product id; the brand match wins even
  // though the other row sorts first in the table.
  const result = crosscheckSupportedDevices(
    device({ brand: "Incott", name: "G23 V2", productId: 0x522c }),
    "pass",
  );
  assert.equal(result.listed, true);
  assert.equal(result.matchedBy, "pid");
  assert.equal(result.status, "supported");
  assert.equal(result.pageModel, "G23 V2 (SE / Pro)");
});

test("brand+model name match on a likely row with a passing run qualifies for Supported", () => {
  const result = crosscheckSupportedDevices(
    device({ brand: "ATK", name: "F1 Ultimate" }),
    "pass",
  );
  assert.equal(result.listed, true);
  assert.equal(result.matchedBy, "name");
  assert.equal(result.status, "likely");
  assert.equal(result.label, "Test Needed");
  assert.equal(result.pageModel, "F1 Ultimate");
  assert.match(result.detail, /listed as Test Needed/);
  assert.match(result.detail, /supports moving it to Supported/);
});

test("name match finds the exact model over a longer partial sibling", () => {
  const result = crosscheckSupportedDevices(
    device({ brand: "ATK", name: "F1 Ultimate 2.0" }),
    "pass",
  );
  assert.equal(result.pageModel, "F1 Ultimate 2.0");
  assert.equal(result.status, "likely");
});

test("a non-passing run on a non-supported row keeps the status as-is", () => {
  for (const verdict of ["fail", "incomplete"] as const) {
    const result = crosscheckSupportedDevices(device({ brand: "ATK", name: "F1 Ultimate" }), verdict);
    assert.equal(result.listed, true);
    assert.match(result.detail, /listed as Test Needed/);
    assert.match(result.detail, /keep the status as-is/);
    assert.doesNotMatch(result.detail, /moving it to Supported/);
  }
});

test("an unknown device is reported as not listed", () => {
  const result = crosscheckSupportedDevices(
    device({ brand: "Mystery", name: "Quantum 9000", productId: 0xdead }),
    "pass",
  );
  assert.equal(result.listed, false);
  assert.equal(result.matchedBy, null);
  assert.equal(result.status, null);
  assert.match(result.detail, /not listed on the supported-devices page/);
});

test("statuses other than supported and likely phrase the page row", () => {
  // Quick Win row (no PID pinned): a passing run still supports an eventual
  // move to Supported.
  const quickwin = crosscheckSupportedDevices(device({ brand: "Lamzu", name: "Thorn" }), "pass");
  assert.equal(quickwin.status, "quickwin");
  assert.equal(quickwin.label, "Quick Win");
  assert.match(quickwin.detail, /supports moving it to Supported/);

  // Bridge row matched by name: a non-passing run still keeps the status.
  const bridge = crosscheckSupportedDevices(device({ brand: "Attack Shark", name: "X3" }), "fail");
  assert.equal(bridge.status, "bridge");
  assert.equal(bridge.label, "Needs Bridge");
  assert.match(bridge.detail, /listed as Needs Bridge/);
  assert.match(bridge.detail, /keep the status as-is/);
});

test("detail stays within a single embed field", () => {
  const result = crosscheckSupportedDevices(device({ brand: "ATK", name: "F1 Ultimate" }), "pass");
  assert.ok(result.detail.length <= 300);
});