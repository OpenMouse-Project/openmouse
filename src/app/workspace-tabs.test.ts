import assert from "node:assert/strict";
import test from "node:test";

import type { CardAvailability } from "./cards/availability.ts";
import { availableWorkspaceTab, availableWorkspaceTabs } from "./workspace-tabs.ts";

function availability(enabled: Partial<CardAvailability>): CardAvailability {
  return new Proxy(enabled, { get: (target, property) => Reflect.get(target, property) ?? false }) as CardAvailability;
}

test("a connected mouse exposes only tabs backed by available controls", () => {
  assert.deepEqual(availableWorkspaceTabs(true, availability({})), ["overview", "performance", "advanced"]);
  assert.deepEqual(availableWorkspaceTabs(true, availability({ debounce: true })), [
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
  assert.equal(availableWorkspaceTabs(false, availability({})).length, 6);
});
