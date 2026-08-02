import assert from "node:assert/strict";
import test from "node:test";

import {
  atkDecodeLiftOff,
  atkPackDpiStage,
  atkUnpackDpiStage,
} from "./protocol.ts";

test("DPI stages survive a round trip across every step range", () => {
  for (const [x, y] of [[50, 50], [800, 800], [10000, 1600], [10050, 10050], [26000, 26000], [42000, 42000]]) {
    const stage = atkPackDpiStage(x!, y!);
    const sum = stage.reduce((total, byte) => total + byte, 0);

    assert.equal(sum & 0xff, 0x55, `stage checksum for ${x}/${y}`);
    assert.deepEqual(atkUnpackDpiStage(stage), { x, y });
  }
});

test("DPI stages with a corrupt checksum are rejected", () => {
  const stage = atkPackDpiStage(1600, 1600);
  stage[3] ^= 0xff;

  assert.equal(atkUnpackDpiStage(stage), null);
  assert.equal(atkUnpackDpiStage([1, 2, 3]), null);
});

test("Lift-off codes decode to millimetres", () => {
  assert.equal(atkDecodeLiftOff(1), 0.7);
  assert.equal(atkDecodeLiftOff(4), 1);
  assert.equal(atkDecodeLiftOff(11), 1.7);
  assert.equal(atkDecodeLiftOff(0), null);
});
