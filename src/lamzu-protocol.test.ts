import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auroraStatusIndex,
  auroraStageSlotIndex,
  auroraValueIndex,
  batteryPercentFromMillivolts,
  createLamzuPacket,
  decodeLamzuAuroraAngleTune,
  decodeLamzuAuroraLod,
  decodeLamzuAuroraPollingRate,
  decodeLamzuDpi,
  decodeLamzuLod,
  decodeLamzuPollingRate,
  encodeLamzuAuroraAngleTune,
  encodeLamzuAuroraLod,
  encodeLamzuAuroraPollingRate,
  encodeLamzuDpi,
  encodeLamzuLod,
  encodeLamzuPollingRate,
  finalizeLamzuPacket,
  LAMZU_COMMAND,
  LAMZU_PACKET_LENGTH,
  LAMZU_REPORT_ID,
  lamzuDataChecksum,
  lamzuPacketChecksum,
  parseAuroraBattery,
  parseBatteryMillivolts,
} from "./lamzu-protocol.ts";

test("packet checksum matches Compx / Lamzu report-8 formula", () => {
  const packet = createLamzuPacket(LAMZU_COMMAND.readFlash);
  packet[2] = 0x00;
  packet[3] = 0x0a;
  packet[4] = 2;
  finalizeLamzuPacket(packet);
  assert.equal(packet.length, LAMZU_PACKET_LENGTH);
  assert.equal(packet[15], lamzuPacketChecksum(packet));

  // Equivalent Pulsar form: (0x55 - sum(bytes[0..14]) - reportId) & 0xff
  let sum = 0;
  for (let index = 0; index < LAMZU_PACKET_LENGTH - 1; index += 1) sum += packet[index]!;
  assert.equal(packet[15], (0x55 - (sum & 0xff) - LAMZU_REPORT_ID) & 0xff);
});

test("packet checksum includes the live report ID (0x13 on some Maya dongles)", () => {
  const packet = createLamzuPacket(LAMZU_COMMAND.readVersionId);
  finalizeLamzuPacket(packet, 0x13);
  assert.equal(packet[15], lamzuPacketChecksum(packet, 0x13));
  assert.notEqual(packet[15], lamzuPacketChecksum(packet, LAMZU_REPORT_ID));
});

test("data checksum for a single flash byte matches 0x55 - value", () => {
  for (const value of [0, 1, 2, 15, 64, 128, 255]) {
    assert.equal(lamzuDataChecksum(new Uint8Array([value])), (0x55 - value) & 0xff);
  }
});

test("polling rates round-trip through the Compx wire map", () => {
  for (const hz of [125, 250, 500, 1000, 2000, 4000, 8000]) {
    const encoded = encodeLamzuPollingRate(hz);
    assert.notEqual(encoded, null);
    assert.equal(decodeLamzuPollingRate(encoded!), hz);
  }
  assert.equal(encodeLamzuPollingRate(3000), null);
  assert.equal(decodeLamzuPollingRate(3), null);
});

test("DPI encodes as (dpi / 50) - 1 for both axes", () => {
  assert.deepEqual([...encodeLamzuDpi(1600)!], [31, 31, 0]);
  assert.equal(decodeLamzuDpi(new Uint8Array([31, 31, 0])), 1600);
  assert.deepEqual([...encodeLamzuDpi(50)!], [0, 0, 0]);
  assert.deepEqual([...encodeLamzuDpi(12_800)!], [255, 255, 0]);
  assert.equal(encodeLamzuDpi(1601), null);
  assert.equal(encodeLamzuDpi(40), null);
  assert.equal(encodeLamzuDpi(12_850), null);
});

test("Aurora polling rates use the shifted high-rate encoding", () => {
  assert.equal(encodeLamzuAuroraPollingRate(1000), 1);
  assert.equal(encodeLamzuAuroraPollingRate(2000), 32);
  assert.equal(encodeLamzuAuroraPollingRate(4000), 64);
  assert.equal(encodeLamzuAuroraPollingRate(8000), 128);
  assert.equal(decodeLamzuAuroraPollingRate(32), 2000);
  assert.equal(decodeLamzuAuroraPollingRate(16), 1000); // Aurora aliases 16 → 1000
  assert.equal(decodeLamzuAuroraPollingRate(64), 4000);
});

test("Aurora response indexes follow hidIndex / protocol flags", () => {
  assert.equal(auroraStatusIndex(0), 1);
  assert.equal(auroraStatusIndex(1), 0);
  assert.equal(auroraValueIndex(0, true), 8);
  assert.equal(auroraValueIndex(1, true), 7);
  assert.equal(auroraValueIndex(0, false), 7);
});

test("Aurora DPI stage slots are 1-based like lamzu.net setActiveDPIValue", () => {
  assert.equal(auroraStageSlotIndex(1, 6), 0);
  assert.equal(auroraStageSlotIndex(2, 6), 1);
  assert.equal(auroraStageSlotIndex(6, 6), 5);
  assert.equal(auroraStageSlotIndex(0, 6), 0);
  assert.equal(auroraStageSlotIndex(9, 6), 5);
});

test("LOD maps 1 mm / 2 mm onto Medium / High", () => {
  assert.equal(encodeLamzuLod("Medium"), 1);
  assert.equal(encodeLamzuLod("High"), 2);
  assert.equal(decodeLamzuLod(1), "Medium");
  assert.equal(decodeLamzuLod(2), "High");
  assert.equal(decodeLamzuLod(3), null);
});

test("Aurora LOD encodes 0.7 mm / 1 mm / 2 mm like lamzu.net", () => {
  assert.equal(encodeLamzuAuroraLod("Low"), 135);
  assert.equal(encodeLamzuAuroraLod("Medium"), 1);
  assert.equal(encodeLamzuAuroraLod("High"), 2);
  assert.equal(decodeLamzuAuroraLod(135), "Low");
  assert.equal(decodeLamzuAuroraLod(1), "Medium");
  assert.equal(decodeLamzuAuroraLod(2), "High");
  assert.equal(decodeLamzuAuroraLod(0), null);
});

test("Aurora angle tune uses signed byte encoding", () => {
  assert.equal(encodeLamzuAuroraAngleTune(0), 0);
  assert.equal(encodeLamzuAuroraAngleTune(30), 30);
  assert.equal(encodeLamzuAuroraAngleTune(-1), 255);
  assert.equal(encodeLamzuAuroraAngleTune(-30), 226);
  assert.equal(decodeLamzuAuroraAngleTune(0), 0);
  assert.equal(decodeLamzuAuroraAngleTune(30), 30);
  assert.equal(decodeLamzuAuroraAngleTune(255), -1);
  assert.equal(decodeLamzuAuroraAngleTune(226), -30);
  assert.equal(encodeLamzuAuroraAngleTune(31), null);
});

test("battery millivolts decode from command 0x04 responses", () => {
  assert.equal(parseBatteryMillivolts(new Uint8Array([0x04, 0, 0, 0, 0, 0, 0, 0x0f, 0xa0])), 4000);
  assert.equal(parseBatteryMillivolts(new Uint8Array([0x04, 1, 0, 0, 0, 0, 0, 0x0f, 0xa0])), null);
  assert.equal(batteryPercentFromMillivolts(3050), 0);
  assert.equal(batteryPercentFromMillivolts(4200), 100);
});

test("Aurora battery responses decode charging flag + percent", () => {
  const withReportId = new Uint8Array(16);
  withReportId[1] = 0xa1;
  withReportId[4] = 2;
  withReportId[6] = 131;
  withReportId[7] = 1;
  withReportId[8] = 97;
  assert.deepEqual(parseAuroraBattery(withReportId), { charging: true, percent: 97 });

  const withoutPrefix = new Uint8Array(16);
  withoutPrefix[0] = 0xa1;
  withoutPrefix[3] = 2;
  withoutPrefix[5] = 131;
  withoutPrefix[6] = 0;
  withoutPrefix[7] = 42;
  assert.deepEqual(parseAuroraBattery(withoutPrefix), { charging: false, percent: 42 });
});
