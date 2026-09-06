import assert from "node:assert/strict";
import test from "node:test";
import { isVxeR1SePlusReceiver, receiverPairingSucceeded } from "./atk.ts";

test("R1 SE+ pairing controls require the exact verified receiver", () => {
  assert.equal(isVxeR1SePlusReceiver({ vendorId: 0x3554, productId: 0xf58e }), true);
  assert.equal(isVxeR1SePlusReceiver({ vendorId: 0x373b, productId: 0x1085 }), false);
  assert.equal(isVxeR1SePlusReceiver(null), false);
});

test("pairing requires terminal status and online telemetry", () => {
  const receiver = { status: 1, rfId: "CBCAD9", pairingSecondsRemaining: 0 };
  assert.equal(receiverPairingSucceeded({ ...receiver, online: true, pairingStatus: 2 }, true), true);
  assert.equal(receiverPairingSucceeded({ ...receiver, online: true, pairingStatus: 2 }, false), false);
  assert.equal(receiverPairingSucceeded({ ...receiver, online: false, pairingStatus: 2 }, true), false);
  assert.equal(receiverPairingSucceeded({ ...receiver, online: true, pairingStatus: 1 }, true), false);
});
