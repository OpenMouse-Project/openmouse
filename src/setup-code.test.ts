import assert from "node:assert/strict";
import test from "node:test";

import { bindingFromAssignment, decodeSetupCode, describeSetup, encodeSetupCode, type SetupCode } from "./setup-code.ts";

const full: SetupCode = {
  hits: {
    left: { actuation: 2, rapidTrigger: 1, rapidTriggerEnabled: true, haptics: 0 },
    right: { actuation: 4, rapidTrigger: 1, rapidTriggerEnabled: false, haptics: 2 },
  },
  bunnyHopMs: 100,
  buttons: [
    null,
    null,
    { kind: "action", action: "Middle click" },
    { kind: "keyboard", modifiers: 0x01, key: 0x06 },
    { kind: "consumer", usage: 233 },
  ],
  dpiStages: [400, 800, 1600, 3200],
};

test("a full setup survives encoding and decoding", () => {
  assert.deepEqual(decodeSetupCode(encodeSetupCode(full)), full);
});

test("any single part can stand alone", () => {
  for (const part of [{ hits: full.hits }, { bunnyHopMs: 0 }, { buttons: full.buttons }, { dpiStages: [800] }] as SetupCode[]) {
    assert.deepEqual(decodeSetupCode(encodeSetupCode(part)), part);
  }
});

test("a mistyped, truncated or foreign code is refused", () => {
  const code = encodeSetupCode(full);
  const flipped = code.slice(0, -4) + (code.slice(-4, -3) === "A" ? "B" : "A") + code.slice(-3);
  assert.equal(decodeSetupCode(flipped), null);
  assert.equal(decodeSetupCode(code.slice(0, -6)), null);
  assert.equal(decodeSetupCode("HITS1-abc"), null);
  assert.equal(decodeSetupCode(""), null);
  assert.equal(decodeSetupCode("SETUP1-"), null);
});

test("out-of-range values are refused even with a valid checksum", () => {
  assert.equal(decodeSetupCode(encodeSetupCode({ bunnyHopMs: 5 })), null);
  assert.equal(decodeSetupCode(encodeSetupCode({ dpiStages: [10] })), null);
  assert.equal(decodeSetupCode(encodeSetupCode({ dpiStages: [800, 800, 800, 800, 800, 800] })), null);
});

test("a stored assignment becomes a shareable binding, and a macro or unknown record does not", () => {
  assert.deepEqual(bindingFromAssignment("Forward", [0x80, 0x01, 0x00, 0x10]), { kind: "action", action: "Forward" });
  assert.deepEqual(bindingFromAssignment("Custom", [0x80, 0x02, 0x01, 0x06]), { kind: "keyboard", modifiers: 1, key: 6 });
  assert.deepEqual(bindingFromAssignment("Custom", [0x80, 0x03, 0x00, 233]), { kind: "consumer", usage: 233 });
  assert.equal(bindingFromAssignment("Custom", [0x12, 0x34, 0x56, 0x78]), null);
  assert.equal(bindingFromAssignment("Macro 1", [0, 0, 0, 0]), null);
});

test("a code is summarised one line per part", () => {
  assert.deepEqual(describeSetup(full), ["HITS tuning for both buttons", "Bunny Hop 100 ms", "3 button assignments", "DPI stages 400, 800, 1600, 3200"]);
});
