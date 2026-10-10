import assert from "node:assert/strict";
import test from "node:test";

import type { CardAvailability } from "./cards/availability.ts";
import { availableWorkspaceTab, availableWorkspaceTabs } from "./workspace-tabs.ts";

function availability(enabled: Partial<CardAvailability>): CardAvailability {
  return new Proxy(enabled, { get: (target, property) => Reflect.get(target, property) ?? false }) as CardAvailability;
}

test("LunaFury response and wheel guard retain the Buttons tab without global debounce", () => {
  for (const field of ["lunafuryButtons", "lunafuryWheelGuard"] as const) {
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
