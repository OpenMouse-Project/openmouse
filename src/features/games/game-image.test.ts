import assert from "node:assert/strict";
import test from "node:test";

import { fitWithin } from "./game-image.ts";

test("a big picture is scaled down so its longer side fits", () => {
  assert.deepEqual(fitWithin(1600, 900, 800), { width: 800, height: 450 });
  assert.deepEqual(fitWithin(600, 2400, 800), { width: 200, height: 800 });
});

test("a small picture is never scaled up", () => {
  assert.deepEqual(fitWithin(300, 200, 800), { width: 300, height: 200 });
});

test("a very thin picture keeps at least one pixel on each side", () => {
  assert.deepEqual(fitWithin(5000, 1, 800), { width: 800, height: 1 });
});
