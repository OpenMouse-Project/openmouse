import assert from "node:assert/strict";
import test from "node:test";
import { buildRazerV4Report, decodeRazerV4DpiState, razerV4Crc } from "@openmouse/protocol/razer-v4";
import { RazerViperV4ProHidClient } from "./viper-v4-pro-hid.ts";

test("Viper V4 Pro Razer reports use the captured 90-byte framing and XOR CRC", () => {
  const report = buildRazerV4Report(0x00, 0x40, 2, new Uint8Array([1, 0x08]));
  assert.equal(report.length, 90);
  assert.deepEqual([...report.slice(0, 8)], [0, 0x1f, 0, 0, 0, 2, 0, 0x40]);
  assert.deepEqual([...report.slice(8, 10)], [1, 0x08]);
  assert.equal(report[88], razerV4Crc(report));
});

test("Viper V4 Pro DPI stage responses preserve independent X/Y axes", () => {
  const args = new Uint8Array([1, 2, 2, 1, 0x06, 0x40, 0x06, 0x40, 0, 0, 2, 0x30, 0x39, 0xc3, 0x50, 0, 0]);
  assert.deepEqual(decodeRazerV4DpiState(args), {
    activeStage: 1,
    stages: [{ x: 1600, y: 1600 }, { x: 12345, y: 50000 }],
  });
});

test("Viper V4 Pro accepts only Synapse-style feature-report control interfaces", () => {
  const control = {
    vendorId: 0x1532,
    productId: 0x00e6,
    collections: [{ usagePage: 0x01, featureReports: [{ reportId: 0 }], children: [] }],
  } as unknown as HIDDevice;
  const plainMouse = {
    ...control,
    collections: [{ usagePage: 0x01, featureReports: [], children: [] }],
  } as HIDDevice;
  assert.equal(RazerViperV4ProHidClient.isSupported(control), true);
  assert.equal(RazerViperV4ProHidClient.isSupported(plainMouse), false);
});
