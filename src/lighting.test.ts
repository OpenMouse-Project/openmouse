import assert from "node:assert/strict";
import test from "node:test";

import { supportsLighting } from "./devices/mouse-types.ts";
import { hsvToHex, scaleBrightness, wheelColorAt } from "./ui/dom.ts";

test("brightness scaling keeps two hex digits per channel", () => {
  assert.equal(scaleBrightness("#ff8000", 100), "#ff8000");
  assert.equal(scaleBrightness("#ffffff", 0), "#000000");
  // 255 * 0.02 rounds to 5, which must not collapse to a single digit.
  assert.equal(scaleBrightness("#ffffff", 2), "#050505");
  assert.equal(scaleBrightness("#ff0000", 50), "#800000");
});

test("brightness scaling clamps out-of-range percentages", () => {
  assert.equal(scaleBrightness("#3366ff", 250), "#3366ff");
  assert.equal(scaleBrightness("#3366ff", -40), "#000000");
});

test("hsv conversion hits the primaries and a white centre", () => {
  assert.equal(hsvToHex(0, 1, 1), "#ff0000");
  assert.equal(hsvToHex(120, 1, 1), "#00ff00");
  assert.equal(hsvToHex(240, 1, 1), "#0000ff");
  assert.equal(hsvToHex(0, 0, 1), "#ffffff");
});

test("wheel angles match the conic-gradient the CSS paints", () => {
  // The gradient's six stops sit every 60 degrees clockwise from 12 o'clock.
  const rimAt = (degrees: number): string => wheelColorAt(
    50 * Math.sin(degrees * Math.PI / 180),
    -50 * Math.cos(degrees * Math.PI / 180),
    50,
  ).hex;
  assert.equal(rimAt(0), "#ff0000");
  assert.equal(rimAt(60), "#ff00ff");
  assert.equal(rimAt(120), "#0000ff");
  assert.equal(rimAt(180), "#00ffff");
  assert.equal(rimAt(240), "#00ff00");
  assert.equal(rimAt(300), "#ffff00");
  // Between two stops, and the centre is white regardless of angle.
  assert.equal(rimAt(90), "#8000ff");
  assert.equal(wheelColorAt(0, 0, 50).hex, "#ffffff");
});

test("wheel picks outside the rim clamp onto it", () => {
  const picked = wheelColorAt(0, -500, 50);
  assert.equal(Math.round(picked.y), -50);
  assert.equal(picked.x, 0);
  assert.equal(picked.hex, "#ff0000");
});

test("lighting support is detected from the method, not the brand", () => {
  assert.equal(supportsLighting({ setLighting: async () => "#ffffff" }), true);
  assert.equal(supportsLighting({ setDpi: async () => 800 }), false);
  assert.equal(supportsLighting(null), false);
  assert.equal(supportsLighting(undefined), false);
});
