import assert from "node:assert/strict";
import test from "node:test";

import {
  RAZER_LANDING_MAX,
  RAZER_LANDING_MIN,
  RAZER_LIFT_OFF_MAX,
  RAZER_LIFT_OFF_MIN,
  RAZER_PACKET_LENGTH,
  RAZER_READ,
  RAZER_STATUS,
  RAZER_TRANSACTION_ID,
  RAZER_TRANSACTION_ID_3F,
  RAZER_WRITE,
  RazerProtocolError,
  decodeBatteryPercent,
  decodeCharging,
  decodeDpi,
  decodeDpiStages,
  decodeExtendedPollingRate,
  decodeFirmwareVersion,
  decodeLegacyPollingRate,
  decodeLiftOff,
  decodeLowPowerThreshold,
  decodeRazerResponse,
  decodeSerial,
  decodeSleepTimeout,
  encodeRazerRequest,
  razerChecksum,
  razerReadDpiCommand,
  razerSetDpiCommand,
  razerSetExtendedPollingCommand,
  razerSetLegacyPollingCommand,
  razerMaxLanding,
  razerSetLiftOffCommand,
  razerSetTrackingDistanceCommand,
  razerEnableAsymmetricLiftOffCommand,
  razerSetLowPowerThresholdCommand,
  razerSetSleepTimeoutCommand,
} from "@openmouse/protocol/razer";

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

test("a request can carry the older transaction id the Essential family uses", () => {
  const packet = encodeRazerRequest(RAZER_READ.firmware, RAZER_TRANSACTION_ID_3F);

  assert.equal(packet[1], 0x3f);
  assert.equal(packet[5], 0x02);
  assert.equal(packet[7], 0x81);
  assert.equal(packet[88], razerChecksum(packet));
});

test("the transaction id sits outside the checksummed range", () => {
  // OpenRazer checksums bytes 2..87, so the same command checksums identically
  // on either transaction id. A mismatch here would mean the range is wrong.
  const modern = encodeRazerRequest(RAZER_READ.dpi, RAZER_TRANSACTION_ID);
  const legacy = encodeRazerRequest(RAZER_READ.dpi, RAZER_TRANSACTION_ID_3F);

  assert.notEqual(modern[1], legacy[1]);
  assert.equal(modern[88], legacy[88]);
});

test("legacy polling divisors match the documented Essential rate codes", () => {
  // 0x01 = 1000 Hz, 0x02 = 500 Hz, 0x08 = 125 Hz.
  for (const [hz, code] of [[1000, 0x01], [500, 0x02], [125, 0x08]] as const) {
    assert.equal(encodeRazerRequest(razerSetLegacyPollingCommand(hz))[8], code);
  }
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

/*
 * The one-minute reply is a receiver capture logged with its checksum intact,
 * so it pins sleep decoding to hardware the way the firmware fixture does. The
 * longer timeouts re-derive their checksum, and their values are the ones that
 * round-tripped on the mouse: 30, 300 and 900 seconds.
 */
test("sleep decodes as big-endian seconds", () => {
  const captured = decodeRazerResponse(reply("02 1f 00 00 00 02 07 83 00 3c", 0xba), RAZER_READ.sleepTimeout);
  const fiveMinutes = decodeRazerResponse(reply("02 1f 00 00 00 02 07 83 01 2c"), RAZER_READ.sleepTimeout);
  const fifteenMinutes = decodeRazerResponse(reply("02 1f 00 00 00 02 07 83 03 84"), RAZER_READ.sleepTimeout);

  assert.equal(decodeSleepTimeout(captured), 60);
  assert.equal(decodeSleepTimeout(fiveMinutes), 300);
  assert.equal(decodeSleepTimeout(fifteenMinutes), 900);
});

test("a second byte alone cannot express the longer timeouts", () => {
  // Battery and charging pad one meaningful byte in this class, so the pair
  // shape is worth pinning: 900 does not fit in a byte and 0x0384 is not 0x84.
  const fifteenMinutes = decodeRazerResponse(reply("02 1f 00 00 00 02 07 83 03 84"), RAZER_READ.sleepTimeout);

  assert.equal(decodeSleepTimeout(fifteenMinutes), 900);
  assert.notEqual(decodeSleepTimeout(fifteenMinutes), fifteenMinutes[1]);
});

test("a sleep write carries the seconds big-endian", () => {
  const packet = encodeRazerRequest(razerSetSleepTimeoutCommand(300));

  assert.equal(packet[5], 0x02);
  assert.equal(packet[6], 0x07);
  assert.equal(packet[7], 0x03);
  assert.deepEqual([...packet.slice(8, 10)], [0x01, 0x2c]);
  assert.equal(packet[88], razerChecksum(packet));
});

test("a sleep write clears the high bit of the matching read", () => {
  assert.equal(RAZER_WRITE.sleepTimeout.commandClass, RAZER_READ.sleepTimeout.commandClass);
  assert.equal(RAZER_WRITE.sleepTimeout.commandId, RAZER_READ.sleepTimeout.commandId & 0x7f);
});

test("sleep writes round-trip through their decoder", () => {
  // Every minute Synapse offers, plus 30 s: the panel does not offer it, but the
  // mouse took it, so the encoding is not what rules it out.
  for (const seconds of [30, 60, 120, 300, 540, 600, 780, 900]) {
    const request = encodeRazerRequest(razerSetSleepTimeoutCommand(seconds));
    assert.equal(decodeSleepTimeout(request.slice(8)), seconds);
  }
});

test("the low power threshold decodes on the battery scale, not as a percent", () => {
  // A receiver capture with its checksum intact: the mouse held 0x4d, which is
  // 77 out of 255, while Synapse displayed 30%.
  const args = decodeRazerResponse(reply("02 1f 00 00 00 02 07 81 4d 00", 0xc9), RAZER_READ.lowPowerThreshold);

  assert.equal(decodeLowPowerThreshold(args), 30);
  assert.notEqual(decodeLowPowerThreshold(args), args[0]);
});

test("the low power scale rounds the same way in both directions", () => {
  // A second capture, at 85%: the mouse held 0xd9, and encoding 85 lands on the
  // same 217 only because 216.75 rounds up. A truncating conversion would read
  // this back as 84 and fail the write's own check.
  const args = decodeRazerResponse(reply("02 1f 00 00 00 02 07 81 d9 00", 0x5d), RAZER_READ.lowPowerThreshold);
  const request = encodeRazerRequest(razerSetLowPowerThresholdCommand(85));

  assert.equal(decodeLowPowerThreshold(args), 85);
  assert.equal(request[8], 0xd9);
});

test("the low power threshold answers in the byte its class pads", () => {
  // Battery, charging and sleep all pad a leading zero and answer second. This
  // one is reversed, so decoding it like its neighbours reads a constant zero.
  const lowPower = decodeRazerResponse(reply("02 1f 00 00 00 02 07 81 4d 00", 0xc9), RAZER_READ.lowPowerThreshold);
  const battery = decodeRazerResponse(reply("02 1f 00 00 00 02 07 80 00 eb"), RAZER_READ.battery);

  assert.equal(lowPower[1], 0);
  assert.equal(battery[0], 0);
  assert.equal(decodeLowPowerThreshold(lowPower), 30);
  assert.equal(decodeBatteryPercent(battery), 92);
});

test("a low power write mirrors the payload its read returns", () => {
  const packet = encodeRazerRequest(razerSetLowPowerThresholdCommand(30));

  assert.equal(packet[5], 0x02);
  assert.equal(packet[6], 0x07);
  assert.equal(packet[7], 0x01);
  assert.deepEqual([...packet.slice(8, 10)], [0x4d, 0x00]);
  assert.equal(packet[88], razerChecksum(packet));
});

test("a low power write clears the high bit of the matching read", () => {
  assert.equal(RAZER_WRITE.lowPowerThreshold.commandClass, RAZER_READ.lowPowerThreshold.commandClass);
  assert.equal(RAZER_WRITE.lowPowerThreshold.commandId, RAZER_READ.lowPowerThreshold.commandId & 0x7f);
});

test("every writable low power percentage survives the 0-255 round trip", () => {
  // Every whole percent, not just the offered fifths: the panel adds the mouse's
  // own value when it sits off the step, and the client accepts the whole range.
  // Steps are 2.55 apart, so the inverse never rounds more than 0.2 away — a
  // value that did not come back unchanged would fail its own read-back and
  // reject a setting the panel had just offered.
  for (let percent = 5; percent <= 100; percent += 1) {
    const request = encodeRazerRequest(razerSetLowPowerThresholdCommand(percent));
    assert.equal(decodeLowPowerThreshold(request.slice(8)), percent);
  }
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

test("the V2 generation writes and reads DPI through the no-store byte", () => {
  // OpenRazer's driver groups the DeathAdder V2 family with the no-store DPI
  // path, so both commands must carry 0x00 rather than the storage byte 0x01.
  const write = encodeRazerRequest(razerSetDpiCommand(1600, 800, 0x00));
  const read = encodeRazerRequest(razerReadDpiCommand(0x00));

  assert.deepEqual([...write.slice(8, 15)], [0x00, 0x06, 0x40, 0x03, 0x20, 0x00, 0x00]);
  assert.equal(read[8], 0x00);
});

test("polling writes encode the divisor each transport expects", () => {
  const legacy = encodeRazerRequest(razerSetLegacyPollingCommand(500));
  const extended = encodeRazerRequest(razerSetExtendedPollingCommand(500));

  assert.deepEqual([legacy[6], legacy[7], legacy[8]], [0x00, 0x05, 2]);
  assert.deepEqual([extended[6], extended[7], extended[8], extended[9]], [0x00, 0x40, 0x00, 16]);
});

test("polling writes round-trip through their matching decoder", () => {
  for (const hz of [125, 500, 1000]) {
    const request = encodeRazerRequest(razerSetLegacyPollingCommand(hz));
    assert.equal(decodeLegacyPollingRate(request.slice(8)), hz);
  }
  for (const hz of [125, 500, 1000, 2000, 4000, 8000]) {
    const request = encodeRazerRequest(razerSetExtendedPollingCommand(hz));
    assert.equal(decodeExtendedPollingRate(request.slice(8)), hz);
  }
});

test("a rate the encoding cannot express is rejected", () => {
  assert.throws(() => razerSetLegacyPollingCommand(2000), RazerProtocolError);
  assert.throws(() => razerSetExtendedPollingCommand(3000), RazerProtocolError);
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

/*
 * Lift-off fixtures are receiver captures (PID 0x00c1, firmware 1.12) taken
 * while reading each Synapse setting back. Checksums are re-derived; the byte
 * values are what the mouse returned.
 */
test("the asymmetric pair decodes one below the numbers Synapse shows", () => {
  const low = decodeRazerResponse(reply("02 1f 00 00 00 05 0b 85 00 00 00 04 03"), RAZER_READ.liftOff);
  const middle = decodeRazerResponse(reply("02 1f 00 00 00 05 0b 85 00 00 00 0f 0a"), RAZER_READ.liftOff);
  const high = decodeRazerResponse(reply("02 1f 00 00 00 05 0b 85 00 00 00 19 18"), RAZER_READ.liftOff);

  assert.deepEqual(decodeLiftOff(low), { tracking: "Low", liftOff: 5, landing: 4 });
  assert.deepEqual(decodeLiftOff(middle), { tracking: "Low", liftOff: 16, landing: 11 });
  assert.deepEqual(decodeLiftOff(high), { tracking: "Low", liftOff: 26, landing: 25 });
});

test("the symmetric level decodes from its own byte, leaving the pair alone", () => {
  // The same 26/25 pair at each of the three tracking stops. Moving the
  // symmetric slider never touched bytes 3 and 4, which is what makes these two
  // controls separate stored settings rather than two views of one.
  const stops = ["00 00 00 19 18", "00 00 01 19 18", "00 00 02 19 18"];
  const decoded = stops.map((args) => decodeLiftOff(
    decodeRazerResponse(reply(`02 1f 00 00 00 05 0b 85 ${args}`), RAZER_READ.liftOff),
  ));

  assert.deepEqual(decoded.map((value) => value.tracking), ["Low", "Medium", "High"]);
  assert.deepEqual(decoded.map((value) => value.liftOff), [26, 26, 26]);
  assert.deepEqual(decoded.map((value) => value.landing), [25, 25, 25]);
});

test("lift-off ignores the echoed request argument", () => {
  // Byte[0] came back holding whatever the request carried. Arguments 0x00
  // through 0x07 all returned the same levels, so it selects nothing.
  const asZero = decodeRazerResponse(reply("02 1f 00 00 00 05 0b 85 00 00 00 0f 0a"), RAZER_READ.liftOff);
  const asThree = decodeRazerResponse(reply("02 1f 00 00 00 05 0b 85 03 00 00 0f 0a"), RAZER_READ.liftOff);

  assert.deepEqual(decodeLiftOff(asZero), decodeLiftOff(asThree));
});

test("a tracking level the slider does not offer decodes as null", () => {
  // Three stops are all Synapse exposes, so a fourth value is a reading this
  // driver does not understand. Reporting null hides the control instead of
  // showing a level the mouse is not holding.
  const unexpected = decodeRazerResponse(reply("02 1f 00 00 00 05 0b 85 00 00 07 19 18"), RAZER_READ.liftOff);

  assert.equal(decodeLiftOff(unexpected).tracking, null);
});

test("every level the sliders offer stays inside the documented bounds", () => {
  // The encoding is zero-based, so the extremes are what prove the bounds are
  // the sliders' and not an artefact of the offset.
  const lowest = decodeLiftOff(new Uint8Array([0, 0, 0, RAZER_LIFT_OFF_MIN - 1, RAZER_LANDING_MIN - 1]));
  const highest = decodeLiftOff(new Uint8Array([0, 0, 2, RAZER_LIFT_OFF_MAX - 1, RAZER_LANDING_MAX - 1]));

  assert.deepEqual(lowest, { tracking: "Low", liftOff: 2, landing: 1 });
  assert.deepEqual(highest, { tracking: "High", liftOff: 26, landing: 25 });
  assert.ok(lowest.landing < lowest.liftOff);
  assert.ok(highest.landing < highest.liftOff);
});

test("a lift-off write matches the packet the vendor software sends", () => {
  // Transcribed from a capture of Synapse's own traffic: dataSize 0x0a, then
  // `00 04` before the pair. Not inferred from the read — the read's layout is
  // different, and assuming otherwise produced three rejected writes.
  const packet = encodeRazerRequest(razerSetLiftOffCommand(16, 11));

  assert.equal(packet[5], 0x0a);
  assert.equal(packet[6], 0x0b);
  assert.equal(packet[7], 0x05);
  assert.deepEqual([...packet.slice(8, 18)], [0x00, 0x04, 0x0f, 0x0a, 0, 0, 0, 0, 0, 0]);
  assert.equal(packet[88], razerChecksum(packet));
});

test("a lift-off write clears the high bit of the matching read", () => {
  assert.equal(RAZER_WRITE.liftOff.commandClass, RAZER_READ.liftOff.commandClass);
  assert.equal(RAZER_WRITE.liftOff.commandId, RAZER_READ.liftOff.commandId & 0x7f);
});

test("lift-off writes round-trip through the decoder at both extremes", () => {
  // The write payload is offset from the read's, so a round trip is the check
  // that actually catches a mistranscribed layout.
  for (const [liftOff, landing] of [[2, 1], [16, 11], [26, 25]] as const) {
    const request = encodeRazerRequest(razerSetLiftOffCommand(liftOff, landing));
    // Read byte[n] carries write arg[n-1] — the read has a leading echo byte the
    // write does not. Arguments start at packet[8], so the pair is [10] and [11].
    const decoded = decodeLiftOff(new Uint8Array([0, 0, 0, request[10], request[11]]));
    assert.equal(decoded.liftOff, liftOff);
    assert.equal(decoded.landing, landing);
  }
});

test("an inverted pair is refused before it reaches the mouse", () => {
  // The firmware stored lift-off 2 with landing 26 without complaint, which the
  // vendor software cannot even express. The read-back check cannot catch this,
  // because the mouse reports back exactly the invalid pair it was given.
  assert.throws(() => razerSetLiftOffCommand(5, 5), RazerProtocolError);
  assert.throws(() => razerSetLiftOffCommand(2, 26), RazerProtocolError);
  assert.doesNotThrow(() => razerSetLiftOffCommand(5, 4));
});

test("lift-off values outside the vendor sliders are refused", () => {
  assert.throws(() => razerSetLiftOffCommand(1, 0), RazerProtocolError);
  assert.throws(() => razerSetLiftOffCommand(27, 25), RazerProtocolError);
  assert.throws(() => razerSetLiftOffCommand(16, 0), RazerProtocolError);
  assert.throws(() => razerSetLiftOffCommand(16.5, 11), RazerProtocolError);
});

test("landing is always at least one step below lift-off", () => {
  // The rule the controls enforce: lift-off 10 permits landing 9, never 10.
  assert.equal(razerMaxLanding(10), 9);
  // Every lift-off the sliders offer, checked against the command that would
  // carry it — the ceiling has to be a pair the mouse will actually accept.
  for (let liftOff = RAZER_LIFT_OFF_MIN; liftOff <= RAZER_LIFT_OFF_MAX; liftOff += 1) {
    const ceiling = razerMaxLanding(liftOff);
    assert.ok(ceiling < liftOff, `landing ${ceiling} is not below lift-off ${liftOff}`);
    assert.ok(ceiling >= RAZER_LANDING_MIN && ceiling <= RAZER_LANDING_MAX);
    assert.doesNotThrow(() => razerSetLiftOffCommand(liftOff, ceiling));
    assert.throws(() => razerSetLiftOffCommand(liftOff, ceiling + 1), RazerProtocolError);
  }
});

test("the tracking-distance write encodes the level the read reports", () => {
  // `0x0b`/`0x0b` carries `00 04` then a setting id and its value. Setting 01 is
  // the tracking level, and it uses the same 0/1/2 codes as read byte[2] — this
  // was confirmed on hardware by a Low to High transition, not an identity write.
  for (const [distance, level] of [["Low", 0], ["Medium", 1], ["High", 2]] as const) {
    const packet = encodeRazerRequest(razerSetTrackingDistanceCommand(distance));

    assert.deepEqual([packet[5], packet[6], packet[7]], [0x04, 0x0b, 0x0b]);
    assert.deepEqual([...packet.slice(8, 12)], [0x00, 0x04, 0x01, level]);
    assert.equal(decodeLiftOff(new Uint8Array([0, 0, packet[11], 1, 0])).tracking, distance);
    assert.equal(packet[88], razerChecksum(packet));
  }
});

test("the asymmetric unlock is the same command with setting 04", () => {
  // Sent before every pair write. Without it the mouse answers 0x03 and still
  // moves what the read reports, so its absence is invisible to a read-back.
  const packet = encodeRazerRequest(razerEnableAsymmetricLiftOffCommand());

  assert.deepEqual([packet[5], packet[6], packet[7]], [0x04, 0x0b, 0x0b]);
  assert.deepEqual([...packet.slice(8, 12)], [0x00, 0x04, 0x04, 0x01]);
  assert.equal(packet[88], razerChecksum(packet));
});

test("serial text stops at the terminator", () => {
  const args = decodeRazerResponse(
    reply("02 1f 00 00 00 16 00 82 50 4d 30 30 30 30 48 30 30 30 30 30 30 30 30 00"),
    RAZER_READ.serial,
  );

  assert.equal(decodeSerial(args), "PM0000H00000000");
});
