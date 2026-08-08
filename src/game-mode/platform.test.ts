import assert from "node:assert/strict";
import test from "node:test";

import { isWindows } from "./platform.ts";

test("userAgentData decides when the browser provides it", () => {
  assert.equal(isWindows({ userAgentData: { platform: "Windows" } }), true);
  assert.equal(isWindows({ userAgentData: { platform: "macOS" } }), false);
  assert.equal(isWindows({ userAgentData: { platform: "Linux" } }), false);
});

test("a hint beats a legacy userAgent that still says Windows", () => {
  // Chromium freezes the Windows token into the UA string on some platforms,
  // so trusting userAgent first would show the page on a Mac.
  assert.equal(
    isWindows({ userAgentData: { platform: "macOS" }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }),
    false,
  );
});

test("falls back to platform, then userAgent, for browsers without hints", () => {
  assert.equal(isWindows({ platform: "Win32" }), true);
  assert.equal(isWindows({ platform: "MacIntel" }), false);
  assert.equal(isWindows({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), true);
  assert.equal(isWindows({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), false);
});

test("an empty navigator is not Windows, so the page stays hidden", () => {
  assert.equal(isWindows({}), false);
});
