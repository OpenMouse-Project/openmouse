import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_INDEX_DIRECT,
  DEVICE_INDEX_RECEIVER,
  decodeReportRateBitmap,
  hidppDeviceIndex,
  hidppErrorMessage,
  isDirectConnectProduct,
  legacyDpiFallback,
  withSoftwareId,
} from "./protocol.ts";

const G402 = 0xc07e;
const LIGHTSPEED_RECEIVER = 0xc54d;
const SUPERSTRIKE_USB = 0xc0a8;

test("HID++ requests use a nonzero software ID", () => {
  assert.equal(withSoftwareId(0x00), 0x05);
  assert.equal(withSoftwareId(0x10), 0x15);
  assert.equal(withSoftwareId(0x20), 0x25);
});

test("HID++ software ID replaces an existing low nibble", () => {
  assert.equal(withSoftwareId(0x1e), 0x15);
});

test("the G402 is addressed as the mouse itself, not a receiver slot", () => {
  assert.equal(isDirectConnectProduct(G402), true);
  assert.equal(hidppDeviceIndex(G402), DEVICE_INDEX_DIRECT);
  assert.equal(hidppDeviceIndex(G402), 0xff);
});

test("receiver-attached and USB Superstrike devices keep index 0x01", () => {
  for (const productId of [LIGHTSPEED_RECEIVER, 0xc539, 0xc547, SUPERSTRIKE_USB]) {
    assert.equal(isDirectConnectProduct(productId), false);
    assert.equal(hidppDeviceIndex(productId), DEVICE_INDEX_RECEIVER);
  }
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

test("an unrecognised HID++ error still reports its raw code", () => {
  assert.match(hidppErrorMessage(0x7f), /0x7f/);
});

test("the legacy DPI fallback matches the grid G402 hardware advertises", () => {
  // Captured from hardware: getSensorDpiList replied 00 FC | E0 54 | 0F C0,
  // meaning minimum 252, range step 84, maximum 4032.
  const options = legacyDpiFallback();
  assert.equal(options[0], 252);
  assert.equal(options.at(-1), 4032);
  assert.equal(options.every((dpi, index) => index === 0 || dpi - options[index - 1] === 84), true);
  // The value the mouse reports while vendor software displays "2400".
  assert.equal(options.includes(2436), true);
});
