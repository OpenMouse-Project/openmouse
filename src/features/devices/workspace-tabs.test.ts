import assert from "node:assert/strict";
import test from "node:test";

import type { CardAvailability } from "./cards/availability.ts";
import { availableKeyboardWorkspaceTabs, availableWorkspaceTab, availableWorkspaceTabs } from "./workspace-tabs.ts";

test("HB68 exposes only system mode; Wooting exposes key tuning and global settings", () => {
  assert.deepEqual(availableKeyboardWorkspaceTabs("kochi"), ["overview"]);
  assert.deepEqual(availableKeyboardWorkspaceTabs("arbiter"), ["overview", "performance", "buttons", "lighting"]);
  assert.equal(availableWorkspaceTab("performance", availableKeyboardWorkspaceTabs("kochi")), "overview");
  assert.deepEqual(availableKeyboardWorkspaceTabs("keychron"), ["overview", "performance", "buttons", "profiles", "advanced"]);
  assert.equal(availableWorkspaceTab("lighting", availableKeyboardWorkspaceTabs("keychron")), "overview");
  assert.equal(availableWorkspaceTab("advanced", availableKeyboardWorkspaceTabs("keychron")), "advanced");
  assert.deepEqual(availableKeyboardWorkspaceTabs("wooting"), ["overview", "performance", "lighting", "profiles", "advanced"]);
  assert.equal(availableWorkspaceTab("buttons", availableKeyboardWorkspaceTabs("wooting")), "overview");
  assert.equal(availableWorkspaceTab("performance", availableKeyboardWorkspaceTabs("wooting")), "performance");
  assert.ok(availableKeyboardWorkspaceTabs("wuque").includes("performance"));
  assert.ok(availableKeyboardWorkspaceTabs().includes("lighting"));
});

function availability(enabled: Partial<CardAvailability>): CardAvailability {
  return new Proxy(enabled, { get: (target, property) => Reflect.get(target, property) ?? false }) as CardAvailability;
}

test("LunaFury response and wheel guard retain the Buttons tab without global debounce", () => {
  for (const field of ["lunafuryButtons", "lunafuryWheelGuard", "lunafuryBottomButton"] as const) {
    assert.deepEqual(availableWorkspaceTabs(true, availability({ [field]: true })), [
      "overview", "performance", "buttons", "advanced",
    ]);
  }
});

test("a connected mouse exposes only tabs backed by available controls", () => {
  assert.deepEqual(availableWorkspaceTabs(true, availability({})), ["overview", "performance", "advanced"]);
  assert.deepEqual(availableWorkspaceTabs(true, availability({ debounce: true })), [
    "overview", "performance", "buttons", "advanced",
  ]);
});

test("Games omits device-only bottom-button controls without hiding editable button settings", () => {
  const deviceOnly = availability({ lunafuryBottomButton: true });
  assert.equal(availableWorkspaceTabs(true, deviceOnly).includes("buttons"), true);
  assert.equal(availableWorkspaceTabs(true, deviceOnly, { gameProfile: true }).includes("buttons"), false);
  for (const field of ["lunafuryButtons", "lunafuryWheelGuard", "buttonMapping"] as const) {
    assert.equal(availableWorkspaceTabs(true, availability({
      lunafuryBottomButton: true, [field]: true,
    }), { gameProfile: true }).includes("buttons"), true);
  }
});

test("magnetic buttons put their settings under the buttons tab", () => {
  assert.deepEqual(availableWorkspaceTabs(true, availability({ magnetic: true })), [
    "overview", "performance", "buttons", "advanced",
  ]);
});

test("every profile surface retains the profiles tab", () => {
  for (const surface of ["profiles", "keychronNapeLayers", "atkProfile", "onboardProfiles", "pulsarPro"] as const) {
    assert.equal(availableWorkspaceTabs(true, availability({ [surface]: true })).includes("profiles"), true, surface);
  }
});

test("an unavailable selected tab falls back to overview", () => {
  const tabs = availableWorkspaceTabs(true, availability({}));
  assert.equal(availableWorkspaceTab("profiles", tabs), "overview");
  assert.equal(availableWorkspaceTab("performance", tabs), "performance");
});

test("the disconnected state keeps every navigation tab", () => {
  assert.deepEqual(availableWorkspaceTabs(false, availability({})), [
    "overview", "performance", "buttons", "macro", "lighting", "profiles", "advanced",
  ]);
});

test("the macro tab follows the onboard macro capability", () => {
  const tabs = availableWorkspaceTabs(true, availability({ ksnakeMacros: true }));
  assert.deepEqual(tabs, ["overview", "performance", "macro", "advanced"]);
});

test("the macro tab also follows the WALLHACK macro capability", () => {
  const tabs = availableWorkspaceTabs(true, availability({ wallhackMacros: true }));
  assert.deepEqual(tabs, ["overview", "performance", "macro", "advanced"]);
});

test("M2-NEX can hide the lighting tab without changing other capabilities", () => {
  const tabs = availableWorkspaceTabs(true, availability({
    lighting: true,
    buttonMapping: true,
    ksnakeMacros: true,
  }), { hideLighting: true });
  assert.deepEqual(tabs, ["overview", "performance", "buttons", "macro", "advanced"]);
});

test("a K-snake scroll control is placed behind the Buttons tab", () => {
  const tabs = availableWorkspaceTabs(true, availability({ ksnakeScroll: true }));
  assert.deepEqual(tabs, ["overview", "performance", "buttons", "advanced"]);
});
