import assert from "node:assert/strict";
import test from "node:test";

import {
  VGN_REPORT_ID,
  vgnBuildReadPayload,
  vgnBuildSimplePayload,
  vgnBuildWriteScalarPayload,
  vgnDecodeDpi,
  vgnDecodeProfile,
  vgnDecodePollingRate,
  vgnEncodeDpi,
  vgnEncodePollingRate,
  vgnParseBattery,
  vgnParseReadResponse,
  vgnReportChecksumIsValid,
} from "./protocol.ts";

test("read commands match captured VGN checksums", () => {
  // Arrange
  const requests = [
    vgnBuildSimplePayload(0x03),
    vgnBuildSimplePayload(0x04),
    vgnBuildReadPayload(0x00a0, 10),
  ];

  // Act / Assert
  assert.deepEqual([...requests[0]!], [0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x4a]);
  assert.deepEqual([...requests[1]!], [0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49]);
  assert.deepEqual([...requests[2]!], [0x08, 0, 0, 0xa0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x9b]);
});

test("captured receiver responses pass checksum validation", () => {
  // Arrange
  const response = new Uint8Array([0x04, 0, 0, 0, 2, 0x64, 0, 0x10, 0x3a, 0, 0, 0, 0, 0, 0, 0x99]);

  // Act
  const valid = vgnReportChecksumIsValid(response);

  // Assert
  assert.equal(valid, true);
  response[5] ^= 1;
  assert.equal(vgnReportChecksumIsValid(response), false);
  assert.equal(VGN_REPORT_ID, 0x08);
});

test("captured battery response decodes percent, charging, and voltage", () => {
  // Arrange
  const response = new Uint8Array([0x04, 0, 0, 0, 2, 0x5f, 1, 0x10, 0x8b, 0, 0, 0, 0, 0, 0, 0x4c]);

  // Act
  const battery = vgnParseBattery(response);

  // Assert
  assert.deepEqual(battery, { percent: 95, charging: true, voltageMv: 4235 });
});

test("flash reads reject corrupt or mismatched responses", () => {
  // Arrange
  const response = new Uint8Array([0x08, 0, 0, 0x0a, 4, 1, 0x54, 0x1f, 0x1f, 0, 0, 0, 0, 0, 0, 0x06]);
  response[15] = (0x55 - VGN_REPORT_ID - response.slice(0, 15).reduce((sum, byte) => sum + byte, 0)) & 0xff;

  // Act / Assert
  assert.deepEqual([...vgnParseReadResponse(response, 0x000a, 4)!], [1, 0x54, 0x1f, 0x1f]);
  assert.equal(vgnParseReadResponse(response, 0x000b, 4), null);
  response[15] ^= 1;
  assert.equal(vgnParseReadResponse(response, 0x000a, 4), null);
});

test("DPI and polling rate codecs round-trip supported UI values", () => {
  // Arrange
  const dpis = [50, 1600, 26000];
  const rates = [125, 250, 500, 1000, 2000, 4000, 8000];

  // Act / Assert
  for (const dpi of dpis) assert.equal(vgnDecodeDpi(vgnEncodeDpi(dpi)), dpi);
  for (const rate of rates) assert.equal(vgnDecodePollingRate(vgnEncodePollingRate(rate)), rate);
});

test("scalar writes include the value parity byte", () => {
  // Arrange / Act
  const payload = vgnBuildWriteScalarPayload(0x00ab, 1);

  // Assert
  assert.deepEqual([...payload.slice(0, 7)], [0x07, 0, 0, 0xab, 2, 1, 0x54]);
  assert.equal(vgnReportChecksumIsValid(payload), true);
});

test("captured flash snapshot decodes into the existing UI settings", () => {
  // Arrange
  const profile = new Uint8Array(0xbe);
  profile.set([1, 0x54, 1, 0x54, 0, 0x55], 0x00);
  profile.set([1, 0x54, 0x1f, 0x1f, 0, 0x17, 0x1f, 0x1f, 0, 0x17], 0x0a);
  profile.set([1, 0xff, 0, 0xff, 8, 8, 0x46, 0, 0x55, 4], 0xa0);
  profile.set([0x51, 0, 0x55, 6, 0x4f, 0, 0x55, 0, 0x55, 0], 0xaa);
  profile.set([0x55, 1, 0x54, 6, 0x4f, 0, 0x55, 10, 0x4b, 0], 0xb4);

  // Act
  const settings = vgnDecodeProfile(profile);

  // Assert
  assert.deepEqual(settings, {
    dpi: 1600,
    dpiStageCount: 1,
    activeDpiStage: 0,
    pollingRateHz: 1000,
    liftOffDistance: "Medium",
    debounceMs: 4,
    sleepTimeout: 60,
    motionSync: false,
    angleSnapping: false,
    rippleControl: false,
    performanceMode: true,
  });
});
