import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_INDEX_DIRECT,
  DEVICE_INDEX_RECEIVER,
  decodeBatteryLevelState,
  decodeReportRateBitmap,
  decodeUnifiedBatteryState,
  hidpp10ErrorMessage,
  hidppErrorForRequest,
  hidppErrorMessage,
  isDirectConnection,
  OnboardOnlyError,
  withSoftwareId,
} from "./protocol.ts";
import { isWiredHidppConnection, supportsLiveLiftOffControl } from "./hidpp.ts";

test("HID++ requests use a nonzero software ID", () => {
  assert.equal(withSoftwareId(0x00), 0x05);
  assert.equal(withSoftwareId(0x10), 0x15);
  assert.equal(withSoftwareId(0x20), 0x25);
});

test("HID++ software ID replaces an existing low nibble", () => {
  assert.equal(withSoftwareId(0x1e), 0x15);
});

test("runtime probing alone classifies direct and receiver connections", () => {
  assert.equal(isDirectConnection(DEVICE_INDEX_DIRECT), true);
  assert.equal(isDirectConnection(DEVICE_INDEX_RECEIVER), false);
  assert.equal(isDirectConnection(null), false);
});

test("extended DPI does not imply lift-off or gaming-surface controls", () => {
  assert.equal(supportsLiveLiftOffControl(false, null), false, "0 means no LOD control");
  assert.equal(supportsLiveLiftOffControl(true, "Medium"), false, "legacy DPI has no LOD field");
  assert.equal(supportsLiveLiftOffControl(false, "Low"), true);
});

test("the active transport comes from HID++ identity instead of a product exception", () => {
  const transports = { USB: "C0A8", Wireless: "40BD" };
  assert.equal(isWiredHidppConnection(0xc0a8, transports, false), true);
  assert.equal(isWiredHidppConnection(0x40bd, transports, false), false);
  assert.equal(isWiredHidppConnection(0xc54d, transports, false), false, "receiver PID is not the mouse's USB transport");
  assert.equal(isWiredHidppConnection(0xc07e, {}, true), true, "old direct devices use the probed-index fallback");
});

test("the legacy report-rate bitmap decodes the G402's advertised rates", () => {
  // 0x8b = bits 0, 1, 3 and 7 => 1, 2, 4 and 8 ms.
  assert.deepEqual(decodeReportRateBitmap(0x8b), [125, 250, 500, 1000]);
});

test("report-rate bitmap bits map to (bit + 1) ms, not 1 << (interval - 1)", () => {
  assert.deepEqual(decodeReportRateBitmap(0x01), [1000]);
  assert.deepEqual(decodeReportRateBitmap(0x02), [500]);
  assert.deepEqual(decodeReportRateBitmap(0x08), [250]);
  assert.deepEqual(decodeReportRateBitmap(0x80), [125]);
  assert.deepEqual(decodeReportRateBitmap(0x00), []);
});

test("HID++ error responses are reported with their documented reason", () => {
  // The code returned when 0x8060's setter is asked to change the rate live.
  assert.match(hidppErrorMessage(0x02), /invalid argument/);
  assert.match(hidppErrorMessage(0x09), /unsupported/);
});

test("HID++ 1.0 error 0x0a is request unavailable", () => {
  assert.match(hidpp10ErrorMessage(0x0a), /HID\+\+ 1\.0: request unavailable/);
  assert.match(hidppErrorMessage(0x0a), /HID\+\+ 2\.0 error 0x0a/);
});

test("error frames are decoded by protocol and matched to their request", () => {
  const hidpp10 = new Uint8Array([0xff, 0x8f, 0x0d, withSoftwareId(0x10), 0x0a]);
  const hidpp20 = new Uint8Array([0x01, 0xff, 0x0d, withSoftwareId(0x10), 0x09]);
  assert.match(hidppErrorForRequest(hidpp10, 0x0d, 0x10) ?? "", /HID\+\+ 1\.0: request unavailable/);
  assert.match(hidppErrorForRequest(hidpp20, 0x0d, 0x10) ?? "", /unsupported/);
  assert.equal(hidppErrorForRequest(hidpp10, 0x0e, 0x10), null, "another request's error must be ignored");
});

test("an unrecognised HID++ error still reports its raw code", () => {
  assert.match(hidppErrorMessage(0x7f), /0x7f/);
});

test("the two battery features use different charging enums", () => {
  // 0x1004 UNIFIED_BATTERY.
  assert.equal(decodeUnifiedBatteryState(0x00), "Discharging");
  assert.equal(decodeUnifiedBatteryState(0x01), "Charging");
  assert.equal(decodeUnifiedBatteryState(0x02), "Charging slowly");
  assert.equal(decodeUnifiedBatteryState(0x03), "Full");
  // A charging fault is not any kind of charging.
  assert.equal(decodeUnifiedBatteryState(0x04), "Unknown");

  // 0x1000 BATTERY_LEVEL_STATUS numbers the same states differently.
  assert.equal(decodeBatteryLevelState(0x00), "Discharging");
  assert.equal(decodeBatteryLevelState(0x01), "Charging");
  assert.equal(decodeBatteryLevelState(0x02), "Almost full");
  assert.equal(decodeBatteryLevelState(0x03), "Full");
  assert.equal(decodeBatteryLevelState(0x04), "Charging slowly");
  // 5 invalid battery, 6 thermal error, 7 other charging error.
  for (const code of [0x05, 0x06, 0x07]) {
    assert.equal(decodeBatteryLevelState(code), "Unknown", `status ${code}`);
  }

  // The point of keeping them apart: 2 and 4 mean opposite things.
  assert.notEqual(decodeUnifiedBatteryState(0x02), decodeBatteryLevelState(0x02));
  assert.notEqual(decodeUnifiedBatteryState(0x04), decodeBatteryLevelState(0x04));
});

test("an onboard-only mouse is told how to get itself supported", () => {
  const known = new OnboardOnlyError(6);
  assert.match(known.message, /profile format 6/);
  assert.match(known.message, /Copy verification data/);
  // Never claim a format number we did not read.
  const unknown = new OnboardOnlyError(null);
  assert.doesNotMatch(unknown.message, /format (\d|null)/);
  assert.match(unknown.message, /Copy verification data/);
});

test("the G309's mode status is power-only and exposes no surface or LightForce controls", () => {
  // Model id captured from hardware: 0x8090 V2 with only the power-mode half.
  assert.equal(isPowerOnlyModeStatus("B03C40B10000"), true);
  // Every other model keeps the status1 fields, and unknown/absent ids must
  // not be silently downgraded.
  assert.equal(isPowerOnlyModeStatus("B03C40B10001"), false);
  assert.equal(isPowerOnlyModeStatus(""), false);
  assert.equal(isPowerOnlyModeStatus(null), false);
  assert.equal(isPowerOnlyModeStatus(undefined), false);
});

test("a sensor without lift-off control advertises no lift-off levels", () => {
  // 0x2201 legacy DPI carries no lod byte at all.
  assert.equal(hasLiftOffControl(true, null), false);
  // 0x2202 byte 0 is the "no lift-off control" value, as on the G309.
  assert.equal(hasLiftOffControl(false, 0), false);
  assert.equal(hasLiftOffControl(false, null), false);
  // The levels 1-4 (Low/Medium/High/Extra high) are driveable.
  assert.equal(hasLiftOffControl(false, 1), true);
  assert.equal(hasLiftOffControl(false, 2), true);
});
