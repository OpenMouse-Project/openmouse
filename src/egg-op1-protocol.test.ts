import assert from "node:assert/strict";
import test from "node:test";

import {
  EGG_DEVICE_PROFILES,
  eggClampCpi,
  eggDpiOptions,
  eggFormatFirmwareVersion,
  eggIsValidCpi,
  eggLodOptions,
  eggNormalizeFeatureReport,
} from "./egg-op1-protocol.ts";

const op1 = EGG_DEVICE_PROFILES.get(0x1964)!;
const purple = EGG_DEVICE_PROFILES.get(0x1976)!;
const op1v2 = EGG_DEVICE_PROFILES.get(0x1978)!;

test("all five Endgame Gear 8K devices have explicit capability profiles", () => {
  assert.deepEqual([...EGG_DEVICE_PROFILES.keys()], [0x1964, 0x1966, 0x1976, 0x1978, 0x1980]);
  assert.equal(op1.motionSyncAt8k, false);
  assert.equal(EGG_DEVICE_PROFILES.get(0x1966)!.motionSyncAt8k, false);
  assert.equal(purple.motionSyncAt8k, true);
  assert.equal(op1v2.motionSyncAt8k, true);
});

test("CPI ranges and quantization follow each sensor generation", () => {
  assert.equal(eggClampCpi(op1, 30_000), 26_000);
  assert.equal(eggClampCpi(op1, 31_000), 26_000);
  assert.equal(eggClampCpi(purple, 30_000), 30_000);
  assert.equal(eggClampCpi(op1v2, 31_000), 30_000);
  assert.equal(eggClampCpi(op1v2, 1_605), 1_610);
  assert.equal(eggClampCpi(op1v2, 10_024), 10_000);
  assert.equal(eggClampCpi(op1v2, 10_025), 10_050);
  assert.equal(eggIsValidCpi(op1v2, 1_610), true);
  assert.equal(eggIsValidCpi(op1v2, 1_605), false);
  assert.deepEqual(eggDpiOptions(op1v2).slice(0, 3), [10, 20, 30]);
  assert.deepEqual(eggDpiOptions(op1v2).slice(-3), [29_900, 29_950, 30_000]);
});

test("LOD options switch by device and glass mode", () => {
  assert.deepEqual(eggLodOptions(op1, false), ["0.7 mm", "1 mm", "2 mm"]);
  assert.equal(eggLodOptions(op1v2, false).length, 11);
  assert.deepEqual(eggLodOptions(op1v2, true), ["1.0 mm", "2.0 mm"]);
  assert.deepEqual(eggLodOptions(purple, true), ["1.0 mm", "2.0 mm"]);
});

test("firmware version bytes are decoded as BCD", () => {
  const acknowledgement = new Uint8Array(20);
  acknowledgement[1] = 0x01;
  assert.equal(eggFormatFirmwareVersion(acknowledgement), null);

  const v107 = new Uint8Array(20);
  v107[17] = 0x07;
  v107[18] = 0x01;
  assert.equal(eggFormatFirmwareVersion(v107), "V1.07");

  const v137 = new Uint8Array(20);
  v137[17] = 0x37;
  v137[18] = 0x01;
  assert.equal(eggFormatFirmwareVersion(v137), "V1.37");
});

test("firmware response normalization preserves an included report ID", () => {
  const raw = new Uint8Array(65);
  raw[0] = 0xa1;
  raw[17] = 0x07;
  raw[18] = 0x01;
  const normalized = eggNormalizeFeatureReport(raw, 0xa1, 64, 63);
  assert.equal(normalized.length, 65);
  assert.equal(eggFormatFirmwareVersion(normalized), "V1.07");
});
