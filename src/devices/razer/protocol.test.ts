import assert from "node:assert/strict";
import test from "node:test";

import {
  RAZER_PACKET_LENGTH,
  RAZER_READ,
  RAZER_STATUS,
  RAZER_TRANSACTION_ID,
  RAZER_WRITE,
  RazerProtocolError,
  decodeBatteryPercent,
  decodeCharging,
  decodeDpi,
  decodeDpiStages,
  decodeExtendedPollingRate,
  decodeFirmwareVersion,
  decodeLegacyPollingRate,
  decodeRazerResponse,
  decodeSerial,
  encodeRazerRequest,
  razerChecksum,
  razerSetDpiCommand,
} from "./protocol.ts";

/**
 * Fixtures are Viper V3 Pro (firmware 1.12) captures. Only the firmware reply
 * was logged with its trailing checksum intact, so it is the one fixture that
 * pins the checksum to hardware; the rest re-derive it.
 */
function reply(bytes: string, checksum?: number): Uint8Array {
  const packet = new Uint8Array(RAZER_PACKET_LENGTH);
  packet.set(bytes.trim().split(/\s+/).map((byte) => Number.parseInt(byte, 16)));
  packet[88] = checksum ?? razerChecksum(packet);
  return packet;
}

test("the checksum matches a reply captured from the mouse", () => {
  const captured = reply("02 1f 00 00 00 02 00 81 01 0c", 0x8e);

  assert.equal(razerChecksum(captured), 0x8e);
});

test("requests carry the transaction id, command and checksum", () => {
  const packet = encodeRazerRequest(RAZER_READ.firmware);

  assert.equal(packet.length, RAZER_PACKET_LENGTH);
  assert.equal(packet[1], RAZER_TRANSACTION_ID);
  assert.equal(packet[5], 0x02);
  assert.equal(packet[6], 0x00);
  assert.equal(packet[7], 0x81);
  assert.equal(packet[88], 0x83);
  assert.equal(packet[88], razerChecksum(packet));
});

test("request arguments are placed after the header", () => {
  const packet = encodeRazerRequest(RAZER_READ.dpiStages);

  assert.equal(packet[5], 0x26);
  assert.equal(packet[8], 0x00);
});

test("replies decode to their arguments", () => {
  const args = decodeRazerResponse(reply("02 1f 00 00 00 02 00 81 01 0c"), RAZER_READ.firmware);

  assert.equal(args.length, 2);
  assert.equal(decodeFirmwareVersion(args), "1.12");
});

test("an unsupported command is rejected with its status", () => {
  // Wireless answers the legacy polling command this way.
  const unsupported = reply("05 1f 00 00 00 01 00 85");

  assert.throws(
    () => decodeRazerResponse(unsupported, RAZER_READ.pollingRate),
    (error: RazerProtocolError) => error.status === RAZER_STATUS.unsupported,
  );
});

test("a reply from a different command is rejected", () => {
  const mismatched = reply("02 1f 00 00 00 02 07 80 00 fa");

  assert.throws(() => decodeRazerResponse(mismatched, RAZER_READ.firmware), RazerProtocolError);
});

test("a corrupted reply is rejected", () => {
  const corrupted = reply("02 1f 00 00 00 02 00 81 01 0c", 0x00);

  assert.throws(() => decodeRazerResponse(corrupted, RAZER_READ.firmware), RazerProtocolError);
});

test("battery scales the reported level to a percentage", () => {
  const wired = decodeRazerResponse(reply("02 1f 00 00 00 02 07 80 00 fa"), RAZER_READ.battery);
  const wireless = decodeRazerResponse(reply("02 1f 00 00 00 02 07 80 00 fd"), RAZER_READ.battery);

  assert.equal(decodeBatteryPercent(wired), 98);
  assert.equal(decodeBatteryPercent(wireless), 99);
});

test("charging is reported only while cabled", () => {
  const cabled = decodeRazerResponse(reply("02 1f 00 00 00 02 07 84 00 01"), RAZER_READ.charging);
  const onDongle = decodeRazerResponse(reply("02 1f 00 00 00 02 07 84 00 00"), RAZER_READ.charging);

  assert.equal(decodeCharging(cabled), true);
  assert.equal(decodeCharging(onDongle), false);
});

test("DPI decodes as big-endian pairs", () => {
  const args = decodeRazerResponse(reply("02 1f 00 00 00 07 04 85 00 06 40 06 40 00 00"), RAZER_READ.dpi);

  assert.deepEqual(decodeDpi(args), { x: 1600, y: 1600 });
});

test("DPI stages decode as seven-byte records", () => {
  const args = decodeRazerResponse(
    reply(
      "02 1f 00 00 00 26 04 86 00 03 05 01 01 90 01 90 00 00 02 03 20 03 20 00 00"
      + " 03 06 40 06 40 00 00 04 0c 80 0c 80 00 00 05 19 00 19 00 00 00",
    ),
    RAZER_READ.dpiStages,
  );
  const { active, stages } = decodeDpiStages(args);

  assert.equal(args.length, 38);
  assert.equal(active, 3);
  assert.deepEqual(stages.map((stage) => stage.x), [400, 800, 1600, 3200, 6400]);
  assert.deepEqual(stages.map((stage) => stage.y), [400, 800, 1600, 3200, 6400]);
});

test("the active stage agrees with the separately reported DPI", () => {
  const dpi = decodeDpi(decodeRazerResponse(
    reply("02 1f 00 00 00 07 04 85 00 06 40 06 40 00 00"),
    RAZER_READ.dpi,
  ));
  const { active, stages } = decodeDpiStages(decodeRazerResponse(
    reply(
      "02 1f 00 00 00 26 04 86 00 03 05 01 01 90 01 90 00 00 02 03 20 03 20 00 00"
      + " 03 06 40 06 40 00 00 04 0c 80 0c 80 00 00 05 19 00 19 00 00 00",
    ),
    RAZER_READ.dpiStages,
  ));

  assert.deepEqual(stages[active - 1], dpi);
});

test("legacy polling decodes as a divisor of 1000", () => {
  const args = decodeRazerResponse(reply("02 1f 00 00 00 01 00 85 01"), RAZER_READ.pollingRate);

  assert.equal(decodeLegacyPollingRate(args), 1000);
});

test("a DPI write carries both axes big-endian after the storage byte", () => {
  const packet = encodeRazerRequest(razerSetDpiCommand(1600, 800));

  assert.equal(packet[5], 0x07);
  assert.equal(packet[6], 0x04);
  assert.equal(packet[7], 0x05);
  assert.deepEqual([...packet.slice(8, 15)], [0x01, 0x06, 0x40, 0x03, 0x20, 0x00, 0x00]);
  assert.equal(packet[88], razerChecksum(packet));
});

test("a DPI write clears the high bit of the matching read", () => {
  assert.equal(RAZER_WRITE.dpi.commandClass, RAZER_READ.dpi.commandClass);
  assert.equal(RAZER_WRITE.dpi.commandId, RAZER_READ.dpi.commandId & 0x7f);
});

test("a DPI write reads back through the same storage", () => {
  const written = encodeRazerRequest(razerSetDpiCommand(1600, 1600));
  const read = encodeRazerRequest(RAZER_READ.dpi);

  assert.equal(written[8], read[8]);
});

test("extended polling decodes as a divisor of 8000", () => {
  const args = decodeRazerResponse(reply("02 1f 00 00 00 02 00 c0 00 04"), RAZER_READ.pollingRateExtended);

  assert.equal(decodeExtendedPollingRate(args), 2000);
});

test("extended polling ignores the echoed request argument", () => {
  const asZero = decodeRazerResponse(reply("02 1f 00 00 00 02 00 c0 00 04"), RAZER_READ.pollingRateExtended);
  const asOne = decodeRazerResponse(reply("02 1f 00 00 00 02 00 c0 01 04"), RAZER_READ.pollingRateExtended);

  assert.equal(decodeExtendedPollingRate(asZero), decodeExtendedPollingRate(asOne));
});

test("serial text stops at the terminator", () => {
  const args = decodeRazerResponse(
    reply("02 1f 00 00 00 16 00 82 50 4d 30 30 30 30 48 30 30 30 30 30 30 30 30 00"),
    RAZER_READ.serial,
  );

  assert.equal(decodeSerial(args), "PM0000H00000000");
});
