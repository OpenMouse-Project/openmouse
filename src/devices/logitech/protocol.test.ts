import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeLiftOffDistance,
  encodeLiftOffDistance,
  logitechDeviceProfile,
} from "./protocol.ts";

test("Superlight 2 transports use the correct HID++ addressing", () => {
  assert.equal(logitechDeviceProfile(0x046d, 0xc09b)?.deviceIndex, 0xff);
  assert.equal(logitechDeviceProfile(0x046d, 0xc09b)?.reportRateConnectionType, 0);
  assert.equal(logitechDeviceProfile(0x046d, 0xc54d)?.deviceIndex, 0x01);
  assert.equal(logitechDeviceProfile(0x046d, 0xc54d)?.reportRateConnectionType, 1);
});

test("extended DPI lift-off values follow HID++ 0x2202", () => {
  assert.deepEqual(["Low", "Medium", "High"].map((value) => encodeLiftOffDistance(value as "Low" | "Medium" | "High")), [1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3, 4].map(decodeLiftOffDistance), [null, "Low", "Medium", "High", null]);
});
