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
const G403_HERO = 0xc08f;
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

test("wired G402 and G403 HERO are addressed as the mouse itself, not a receiver slot", () => {
  for (const productId of [G402, G403_HERO]) {
    assert.equal(isDirectConnectProduct(productId), true);
    assert.equal(hidppDeviceIndex(productId), DEVICE_INDEX_DIRECT);
    assert.equal(hidppDeviceIndex(productId), 0xff);
  }
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
  const options = legacyDpiFallback(G402);
  assert.equal(options[0], 252);
  assert.equal(options.at(-1), 4032);
  assert.equal(options.every((dpi, index) => index === 0 || dpi - options[index - 1] === 84), true);
  // The value the mouse reports while vendor software displays "2400".
  assert.equal(options.includes(2436), true);
});

test("the legacy DPI fallback covers the G403 HERO's 100-25,600 range", () => {
  const options = legacyDpiFallback(G403_HERO);
  assert.equal(options[0], 100);
  assert.equal(options.at(-1), 25600);
  assert.equal(options.every((dpi, index) => index === 0 || dpi - options[index - 1] === 50), true);
  // The DPI values the preset buttons offer must all be on the grid.
  for (const dpi of [400, 800, 1600, 3200, 6400, 8000]) {
    assert.equal(options.includes(dpi), true);
  }
});

test("the legacy DPI fallback stays empty for receiver-attached mice", () => {
  // Those answer getSensorDpiList properly, and inventing a grid for them would
  // offer DPI values their sensor may not have.
  for (const productId of [LIGHTSPEED_RECEIVER, SUPERSTRIKE_USB]) {
    assert.deepEqual(legacyDpiFallback(productId), []);
  }
});
