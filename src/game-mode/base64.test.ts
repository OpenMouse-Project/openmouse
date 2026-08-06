import assert from "node:assert/strict";
import test from "node:test";

import { base64ToBytes, bytesToBase64 } from "./base64.ts";

test("byte payloads round-trip through base64 exactly", () => {
  const original = new Uint8Array([0x00, 0x1f, 0x80, 0xff, 0x02, 0x40, 0x00, 0x02]);
  const encoded = bytesToBase64(original);
  assert.deepEqual([...base64ToBytes(encoded)], [...original]);
});

test("an empty payload round-trips to an empty array", () => {
  assert.deepEqual([...base64ToBytes(bytesToBase64(new Uint8Array()))], []);
});
