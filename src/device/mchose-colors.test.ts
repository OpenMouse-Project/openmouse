import assert from "node:assert/strict";
import test from "node:test";
import { mchoseGradientColor, mchoseGradientKeys } from "./mchose-colors.ts";

const stops = [{ at: 1, color: "#0000ff" }, { at: 0, color: "#ff0000" }];

test("a gradient blends between its nearest stops and holds past the ends", () => {
  assert.deepEqual(mchoseGradientColor(stops, 0), { r: 255, g: 0, b: 0 });
  assert.deepEqual(mchoseGradientColor(stops, 0.5), { r: 128, g: 0, b: 128 });
  assert.deepEqual(mchoseGradientColor(stops, 1), { r: 0, g: 0, b: 255 });
  assert.deepEqual(mchoseGradientColor([{ at: 0.3, color: "#00ff00" }, { at: 0.6, color: "#ffffff" }], 0.1), { r: 0, g: 255, b: 0 });
  assert.deepEqual(mchoseGradientColor([{ at: 0.3, color: "#00ff00" }, { at: 0.6, color: "#ffffff" }], 0.9), { r: 255, g: 255, b: 255 });
});

test("keys get colours along the chosen direction", () => {
  const keys = [{ index: 1, row: 0, x: 0, width: 1 }, { index: 2, row: 0, x: 4, width: 1 }, { index: 3, row: 2, x: 0, width: 1 }];
  const across = mchoseGradientKeys(keys, stops, 0);
  assert.deepEqual(across.map((key) => key.color.r), [255, 0, 255], "left to right: the right key is blue, both left keys red");
  const down = mchoseGradientKeys(keys, stops, 90);
  assert.deepEqual(down.map((key) => key.color.b), [0, 0, 255], "top to bottom: only the lower row is blue");
});
