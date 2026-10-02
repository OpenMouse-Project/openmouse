import assert from "node:assert/strict";
import test from "node:test";

import {
  isNoirE1Status,
  isNoirKsnakeStatus,
  isNoirM2NexStatus,
  isNoirS1Status,
  NOIR_DPI_STAGE_COLORS,
  noirBrandLabel,
} from "./noir.ts";

test("NOIR S1 is recognized with either current K-snake or Noir Gear branding", () => {
  assert.equal(isNoirS1Status({ brand: "K-snake", name: "NOIR S1" }), true);
  assert.equal(isNoirS1Status({ brand: "Noir Gear", name: "NOIR S1" }), true);
  assert.equal(isNoirS1Status({ brand: "K-snake", name: "K-snake X11" }), false);
  assert.equal(isNoirS1Status({ brand: "Noir Gear", name: "M2-NEX" }), false);
  assert.equal(isNoirKsnakeStatus({ brand: "Noir Gear", name: "M2-NEX" }), true);
  assert.equal(noirBrandLabel({ brand: "K-snake", name: "NOIR S1" }), "Noir Gear");
});

test("NOIR E1 is recognized under the vendor or chipset brand without matching M2-NEX", () => {
  assert.equal(isNoirE1Status({ brand: "K-snake", name: "NOIR E1" }), true);
  assert.equal(isNoirE1Status({ brand: "Noir Gear", name: "noir e1" }), true);
  assert.equal(isNoirE1Status({ brand: "Other", name: "NOIR E1" }), false);
  assert.equal(isNoirM2NexStatus({ brand: "Noir Gear", name: "NOIR E1" }), false);
  assert.equal(isNoirKsnakeStatus({ brand: "K-snake", name: "NOIR E1" }), true);
  assert.equal(noirBrandLabel({ brand: "K-snake", name: "NOIR E1" }), "Noir Gear");
});

test("NOIR DPI indicator palette matches the device stage order", () => {
  assert.deepEqual(NOIR_DPI_STAGE_COLORS, [
    "#ff5a5a", "#4ade80", "#60a5fa", "#facc15", "#22d3ee", "#e879f9",
  ]);
});
