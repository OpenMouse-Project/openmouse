import assert from "node:assert/strict";
import test from "node:test";

import {
  WE_OFF,
  WE_REPORT_ID,
  weBuildReadEepromPayload,
  weBuildWriteEepromPayload,
  wePackDpiStage,
  wePackScalarPair,
  weParseReadEepromResponse,
  weParseWriteEepromResponse,
  wePatchActiveDpi,
  weReportChecksum,
  weUnpackDpiStage,
  weUnpackScalarPair,
} from "@openmouse/protocol/endgame-gear-we";

test("commands produce a valid report checksum", () => {
  for (const payload of [weBuildReadEepromPayload(0x1234, 8), weBuildWriteEepromPayload(0x12, [1, 2, 3, 4])]) {
    assert.equal(payload.length, 16);
    assert.equal(payload[15], weReportChecksum(WE_REPORT_ID, [...payload.subarray(0, 15)]));
    assert.equal(([WE_REPORT_ID, ...payload].reduce((sum, byte) => sum + byte, 0) & 0xff), 0x55);
  }
});

test("scalar pairs reject corrupt checksums", () => {
  const [value, checksum] = wePackScalarPair(7);
  assert.equal(weUnpackScalarPair(value, checksum), 7);
  assert.equal(weUnpackScalarPair(value, checksum ^ 1), null);
});

test("read and write responses require successful status", () => {
  const read = new Uint8Array([0x08, 0, 0, 0x34, 2, 0xaa, 0xbb]);
  assert.deepEqual([...weParseReadEepromResponse(read, 0x1234, 2)!], [0xaa, 0xbb]);
  read[1] = 1;
  assert.equal(weParseReadEepromResponse(read, 0x1234, 2), null);
  assert.equal(weParseWriteEepromResponse(new Uint8Array([0x07, 0])), true);
  assert.equal(weParseWriteEepromResponse(new Uint8Array([0x07, 1])), false);
});

test("DPI changes only the active stage and preserves flags", () => {
  const profile = new Uint8Array(WE_OFF.dpiStages + WE_OFF.maxDpiStages * WE_OFF.dpiStageBytes);
  for (let index = 0; index < WE_OFF.maxDpiStages; index += 1) {
    profile.set(wePackDpiStage(400 + index * 50, 400 + index * 50, index), WE_OFF.dpiStages + index * 4);
  }
  const before = new Uint8Array(profile);
  wePatchActiveDpi(profile, 1600, 3);
  for (let index = 0; index < WE_OFF.maxDpiStages; index += 1) {
    const offset = WE_OFF.dpiStages + index * 4;
    if (index !== 3) assert.deepEqual(profile.slice(offset, offset + 4), before.slice(offset, offset + 4));
  }
  assert.deepEqual(weUnpackDpiStage(profile.slice(WE_OFF.dpiStages + 12, WE_OFF.dpiStages + 16)), { x: 1600, y: 1600, flags: 3 });
});

test("DPI patch refuses corrupt source stages", () => {
  const profile = new Uint8Array(WE_OFF.dpiStages + 4);
  assert.throws(() => wePatchActiveDpi(profile, 800, 0), /checksum is invalid/);
});
