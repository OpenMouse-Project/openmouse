import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auroraStatusIndex,
  auroraValueIndex,
  batteryPercentFromMillivolts,
  createLamzuPacket,
  decodeLamzuAuroraPollingRate,
  decodeLamzuDpi,
  decodeLamzuLod,
  decodeLamzuPollingRate,
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

test("LOD maps 1 mm / 2 mm onto Medium / High", () => {
  assert.equal(encodeLamzuLod("Medium"), 1);
  assert.equal(encodeLamzuLod("High"), 2);
  assert.equal(decodeLamzuLod(1), "Medium");
  assert.equal(decodeLamzuLod(2), "High");
  assert.equal(decodeLamzuLod(3), null);
});

test("battery millivolts decode from command 0x04 responses", () => {
  const response = new Uint8Array(16);
  response[0] = LAMZU_COMMAND.batteryVoltage;
  response[1] = 0;
  response[7] = 0x0f;
  response[8] = 0xa0; // 4000 mV
  assert.equal(parseBatteryMillivolts(response), 4000);
  assert.equal(batteryPercentFromMillivolts(4000), 83);
  assert.equal(batteryPercentFromMillivolts(3050), 0);
  assert.equal(batteryPercentFromMillivolts(4200), 100);

  response[1] = 1;
  assert.equal(parseBatteryMillivolts(response), null);
});

test("Aurora battery responses decode charging flag + percent", () => {
  const hidIndex0 = new Uint8Array(16);
  hidIndex0[1] = 0xa1;
  hidIndex0[4] = 2;
  hidIndex0[6] = 131;
  hidIndex0[7] = 1;
  hidIndex0[8] = 87;
  assert.deepEqual(parseAuroraBattery(hidIndex0), { charging: true, percent: 87 });

  const hidIndex1 = new Uint8Array(16);
  hidIndex1[0] = 0xa1;
  hidIndex1[3] = 2;
  hidIndex1[5] = 131;
  hidIndex1[6] = 0;
  hidIndex1[7] = 42;
  assert.deepEqual(parseAuroraBattery(hidIndex1), { charging: false, percent: 42 });
  assert.equal(parseAuroraBattery(new Uint8Array(16)), null);
});
