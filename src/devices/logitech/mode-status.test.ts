import assert from "node:assert/strict";
import test from "node:test";

import {
  MODE_STATUS,
  buildModeStatusWrite,
  decodeModeStatus,
  encodeModeStatus,
  type GamingSurfaceMode,
  type LightforceSwitchMode,
} from "./mode-status.ts";

const { gamingSurface, lightforce } = MODE_STATUS;

const CAPTURES: ReadonlyArray<[number, GamingSurfaceMode, LightforceSwitchMode]> = [
  [0x03, "On", "Hybrid"],
  [0x05, "Off", "Hybrid"],
  [0x01, "Auto", "Hybrid"],
  [0x00, "Auto", "Optical"],
];

test("decodes the mode-status bytes captured from hardware", () => {
  for (const [statusByte, surface, switches] of CAPTURES) {
    assert.equal(decodeModeStatus(statusByte, gamingSurface), surface);
    assert.equal(decodeModeStatus(statusByte, lightforce), switches);
  }
});

test("decodes an unknown field value as null rather than guessing", () => {
  // Bits 1-2 set to 0b11, which no captured value uses.
  assert.equal(decodeModeStatus(0b0000_0110, gamingSurface), null);
});

test("every mode survives an encode/decode round trip", () => {
  for (const mode of Object.keys(gamingSurface.values) as GamingSurfaceMode[]) {
    assert.equal(decodeModeStatus(encodeModeStatus(0x00, gamingSurface, mode), gamingSurface), mode);
  }
  for (const mode of Object.keys(lightforce.values) as LightforceSwitchMode[]) {
    assert.equal(decodeModeStatus(encodeModeStatus(0x00, lightforce, mode), lightforce), mode);
  }
});

test("writing one field leaves the other field alone", () => {
  // 0x01 is surface Auto with hybrid switches: changing the surface must not turn the switches optical, and vice versa.
  assert.equal(encodeModeStatus(0x01, gamingSurface, "Off"), 0x05);
  assert.equal(decodeModeStatus(0x05, lightforce), "Hybrid");

  assert.equal(encodeModeStatus(0x05, lightforce, "Optical"), 0x04);
  assert.equal(decodeModeStatus(0x04, gamingSurface), "Off");
});

test("writing carries the unknown upper bits through unchanged", () => {
  // Bits 3-7 were 0 on every device seen so far, so a firmware that uses them must not have them cleared by a surface or switch write.
  const withUpperBits = 0b1111_1001;
  assert.equal(encodeModeStatus(withUpperBits, gamingSurface, "Off") & 0b1111_1000, 0b1111_1000);
  assert.equal(encodeModeStatus(withUpperBits, lightforce, "Optical") & 0b1111_1000, 0b1111_1000);
});

test("setModeStatus payload uses one-byte fields and a change mask", () => {
  // The hardware rejects two-byte fields and a bare value/mask pair with
  // INVALID_ARGUMENT, so the shape here is load-bearing:
  // [modeStatus0, modeStatus1, changeMask0, changeMask1].
  assert.deepEqual(buildModeStatusWrite(0x01, gamingSurface, "Off"), [0x00, 0x05, 0x00, 0b0000_0110]);
  assert.deepEqual(buildModeStatusWrite(0x01, lightforce, "Optical"), [0x00, 0x00, 0x00, 0b0000_0001]);
});

test("the change mask never covers another field's bits", () => {
  assert.equal(gamingSurface.mask & lightforce.mask, 0);
});
