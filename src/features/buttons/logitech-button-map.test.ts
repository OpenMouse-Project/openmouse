import assert from "node:assert/strict";
import test from "node:test";

import { buttonMapLayoutFor } from "./logitech-button-map.ts";

test("the Superstrike mice have a layout, whatever the spacing or case of the name", () => {
  assert.ok(buttonMapLayoutFor("PRO X3 SUPERSTRIKE"));
  assert.ok(buttonMapLayoutFor("PRO X 2 Superstrike"));
  assert.ok(buttonMapLayoutFor("PRO X2 SUPERSTRIKE"));
  assert.equal(buttonMapLayoutFor("Some other mouse"), null);
});

test("each layout offers the five buttons once, inside the artwork", () => {
  for (const name of ["PRO X3 SUPERSTRIKE", "PRO X2 SUPERSTRIKE"]) {
    const layout = buttonMapLayoutFor(name)!;
    assert.ok(layout.aspect > 0.5 && layout.aspect < 3);
    assert.deepEqual(layout.spots.map((spot) => spot.button).sort(), [0, 1, 2, 3, 4]);
    for (const spot of layout.spots) {
      assert.ok(spot.x > 0 && spot.x < 1 && spot.y > 0 && spot.y < 1, `${name} ${spot.label} is on the image`);
    }
  }
});

test("only the two primary clicks are locked, and the side buttons sit left of the wheel", () => {
  const layout = buttonMapLayoutFor("PRO X3 SUPERSTRIKE")!;
  assert.deepEqual(layout.spots.filter((spot) => spot.locked).map((spot) => spot.button).sort(), [0, 1]);
  const wheel = layout.spots.find((spot) => spot.button === 2)!;
  for (const side of layout.spots.filter((spot) => spot.button === 3 || spot.button === 4)) {
    assert.ok(side.x < wheel.x, `${side.label} is left of the wheel`);
  }
  const forward = layout.spots.find((spot) => spot.button === 4)!;
  const back = layout.spots.find((spot) => spot.button === 3)!;
  assert.ok(forward.y < back.y, "forward is in front of back");
});
