import assert from "node:assert/strict";
import test from "node:test";

import { compareSemver, manualInstallFor, needsManualBridgeUpdate } from "./manual-update.ts";

test("prerelease numbers compare numerically, not as text", () => {
  assert.equal(compareSemver("1.0.0-beta.9", "1.0.0-beta.20"), -1);
  assert.equal(compareSemver("1.0.0-beta.19", "1.0.0-beta.20"), -1);
  assert.equal(compareSemver("1.0.0-beta.20", "1.0.0-beta.20"), 0);
  assert.equal(compareSemver("1.0.0-beta.21", "1.0.0-beta.20"), 1);
});

test("a release outranks its prereleases and core versions dominate", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0-beta.20"), 1);
  assert.equal(compareSemver("1.0.0-rc.1", "1.0.0-beta.20"), 1);
  assert.equal(compareSemver("0.9.9", "1.0.0-beta.1"), -1);
  assert.equal(compareSemver("v1.0.0+build5", "1.0.0"), 0);
});

test("the prompt shows below beta.20 and hides from beta.20 up", () => {
  assert.equal(needsManualBridgeUpdate("1.0.0-beta.19"), true);
  assert.equal(needsManualBridgeUpdate("1.0.0-beta.2"), true);
  assert.equal(needsManualBridgeUpdate("0.9.0"), true);
  assert.equal(needsManualBridgeUpdate("1.0.0-beta.20"), false);
  assert.equal(needsManualBridgeUpdate("1.0.0-beta.21"), false);
  assert.equal(needsManualBridgeUpdate("1.0.0"), false);
});

test("unknown versions stay quiet", () => {
  assert.equal(needsManualBridgeUpdate(null), false);
  assert.equal(needsManualBridgeUpdate(""), false);
  assert.equal(needsManualBridgeUpdate("dev"), false);
});

test("downloads are chosen by platform", () => {
  assert.deepEqual(manualInstallFor("macos"), {
    platform: "macos",
    url: "https://github.com/OpenMouse-Project/OpenMouse-Bridge/releases/latest/download/OpenMouse-Bridge-macos-universal.dmg",
  });
  assert.deepEqual(manualInstallFor("windows"), {
    platform: "windows",
    url: "https://github.com/OpenMouse-Project/OpenMouse-Bridge/releases/latest/download/openmouse-bridge-windows-x64.zip",
  });
  assert.equal(manualInstallFor("linux")?.platform, "linux");
  assert.equal(manualInstallFor("plan9"), null);
});
