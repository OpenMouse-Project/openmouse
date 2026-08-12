import assert from "node:assert/strict";
import test from "node:test";
import { PREVIEW_KEYS, parsePreviewMode, previewsEnabled } from "./preview-modes.ts";

test("previews are enabled locally and on insiders builds only", () => {
  assert.equal(previewsEnabled("stable", true), true);
  assert.equal(previewsEnabled("insiders", false), true);
  assert.equal(previewsEnabled("stable", false), false);
});

test("preview mode accepts every explicitly supported route", () => {
  for (const key of PREVIEW_KEYS) assert.equal(parsePreviewMode(key), key);
});

test("arbitrary URL values cannot disable HID startup", () => {
  assert.equal(parsePreviewMode(null), null);
  assert.equal(parsePreviewMode(""), null);
  assert.equal(parsePreviewMode("unknown-driver"), null);
  assert.equal(parsePreviewMode("SUPERSTRIKE"), null);
});
