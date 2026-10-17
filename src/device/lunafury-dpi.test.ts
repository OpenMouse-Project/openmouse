import assert from "node:assert/strict";
import test from "node:test";
import { lunaFuryDpiInput } from "./lunafury-dpi.ts";

test("vendor DPI inputs round down to 50 and stay within the sensor range", () => {
  for (const [raw, expected] of [["", 50], ["0", 50], ["-100", 50], ["849", 800],
    ["850", 850], ["30001", 30000], ["Infinity", 50], ["bad", 50]] as const) {
    assert.equal(lunaFuryDpiInput(raw), expected);
  }
});
