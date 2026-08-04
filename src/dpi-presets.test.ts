import assert from "node:assert/strict";
import test from "node:test";

import { closestDpiOption, dpiPresetValues } from "./dpi-presets.ts";

/** A mouse advertising a fine grid that contains every round number. */
const FINE_GRID = Array.from({ length: 600 }, (_, step) => 50 + step * 50);
/** The G402's real grid, captured from hardware: 252 to 4032 in steps of 84. */
const G402_GRID = Array.from({ length: 46 }, (_, step) => 252 + step * 84);

test("a mouse that lists the round numbers keeps them exactly", () => {
  assert.deepEqual(dpiPresetValues(FINE_GRID), [400, 800, 1600, 3200, 6400, 8000]);
});

test("presets beyond a mouse's range are dropped, not snapped to its maximum", () => {
  // Maximum 4000, so 6400 and 8000 have no believable stand-in.
  const upTo4000 = Array.from({ length: 80 }, (_, step) => 50 + step * 50);
  assert.deepEqual(dpiPresetValues(upTo4000), [400, 800, 1600, 3200]);
});

test("a sparse advertised list still yields only values the mouse holds", () => {
  const sparse = [400, 800, 1600, 3200];
  assert.deepEqual(dpiPresetValues(sparse), sparse);
});

test("the G402's 84-step grid produces a usable preset row", () => {
  const presets = dpiPresetValues(G402_GRID);
  // Without snapping this row collapsed to a single button.
  assert.equal(presets.length, 4);
  assert.deepEqual(presets, [420, 840, 1596, 3192]);
  // Every offered value must be one the mouse actually advertises.
  for (const preset of presets) assert.equal(G402_GRID.includes(preset), true);
});

test("a coarse list with no near matches offers nothing rather than guessing", () => {
  // 1000 is 25% away from 800 and 2000 is 25% away from 1600, so neither is a
  // believable stand-in. The row then shows only the mouse's current DPI.
  assert.deepEqual(dpiPresetValues([1000, 2000]), []);
});

test("snapped presets never repeat a value", () => {
  for (const grid of [G402_GRID, FINE_GRID, [1500, 1510, 1520]]) {
    const presets = dpiPresetValues(grid);
    assert.equal(new Set(presets).size, presets.length);
  }
});

test("a mouse with no advertised DPI values offers no presets", () => {
  assert.deepEqual(dpiPresetValues([]), []);
  assert.equal(closestDpiOption([], 800), null);
});

test("the closest step is reported for a value the mouse cannot reach", () => {
  // Vendor software shows 2400; the mouse can only hold 2436.
  assert.equal(closestDpiOption(G402_GRID, 2400), 2436);
  assert.equal(closestDpiOption(G402_GRID, 100), 252);
  assert.equal(closestDpiOption(G402_GRID, 99999), 4032);
});
