import assert from "node:assert/strict";
import test from "node:test";

import {
  M2NEX_PROFILE_STORAGE_KEY,
  NOIR_S1_PROFILE_COUNT,
  NOIR_S1_PROFILE_STORAGE_KEY,
  defaultM2NexProfiles,
  loadM2NexProfiles,
  parseM2NexProfileImport,
  saveM2NexProfiles,
  type M2NexProfileSeed,
} from "./m2nex-profiles.ts";

function seed(): M2NexProfileSeed {
  return {
    dpi: 800,
    dpiStages: [800, 1600, 3200],
    activeDpiStage: 1,
    pollingRateHz: 1000,
    buttonMappings: { Left: "Left click", Right: "Right click" },
    macros: [{ steps: [] }],
  };
}

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: () => undefined,
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

test("M2-NEX defaults mirror the vendor app's three profile slots", () => {
  const profiles = defaultM2NexProfiles(seed());

  assert.deepEqual(profiles.map((profile) => profile.name), ["Profile 1", "Profile 2", "Profile 3"]);
  assert.deepEqual(profiles[1]?.dpiStages, [800, 1600, 3200]);
  assert.equal(profiles[1]?.activeDpiStage, 1);
  assert.deepEqual(profiles[1]?.buttonMappings, seed().buttonMappings);
  assert.deepEqual(profiles[1]?.macros, seed().macros);
});

test("M2-NEX profiles round-trip through browser storage without sharing mutable data", () => {
  const store = storage();
  const profiles = defaultM2NexProfiles(seed());
  profiles[0]!.name = "FPS";
  profiles[0]!.buttonMappings.Right = "Macro 1";
  profiles[0]!.macros = [{ steps: [{ type: 2, action: 1, code: 4, delayMs: 0 }] }];

  saveM2NexProfiles(store, profiles);
  const loaded = loadM2NexProfiles(store, seed());
  assert.equal(loaded[0]?.name, "FPS");
  assert.equal(loaded[0]?.buttonMappings.Right, "Macro 1");
  assert.deepEqual(loaded[0]?.macros, profiles[0]?.macros);

  loaded[0]!.dpiStages[0] = 400;
  loaded[0]!.buttonMappings.Right = "Forward";
  assert.equal(profiles[0]?.dpiStages[0], 800);
  assert.equal(profiles[0]?.buttonMappings.Right, "Macro 1");
  assert.ok(store.getItem(M2NEX_PROFILE_STORAGE_KEY));
});

test("invalid stored profiles fall back to current mouse settings", () => {
  const store = storage();
  store.setItem(M2NEX_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, profiles: [] }));

  const loaded = loadM2NexProfiles(store, seed());
  assert.deepEqual(loaded.map((profile) => profile.name), ["Profile 1", "Profile 2", "Profile 3"]);
  assert.deepEqual(loaded[0]?.dpiStages, [800, 1600, 3200]);
});

test("S1 keeps six local slots and accepts the vendor profile envelope", () => {
  const profiles = defaultM2NexProfiles(seed(), NOIR_S1_PROFILE_COUNT);
  const imported = parseM2NexProfileImport({ deviceModel: "NOIR S1", profileData: profiles }, NOIR_S1_PROFILE_COUNT);
  assert.equal(profiles.length, 6);
  assert.equal(imported?.length, NOIR_S1_PROFILE_COUNT);
  assert.equal(imported?.[5]?.name, "Profile 6");
});

test("S1 profiles use a separate six-slot browser-storage entry", () => {
  const store = storage();
  const profiles = defaultM2NexProfiles(seed(), NOIR_S1_PROFILE_COUNT);
  profiles[5]!.name = "Productivity";

  saveM2NexProfiles(store, profiles, { storageKey: NOIR_S1_PROFILE_STORAGE_KEY });
  const loaded = loadM2NexProfiles(store, seed(), {
    count: NOIR_S1_PROFILE_COUNT,
    storageKey: NOIR_S1_PROFILE_STORAGE_KEY,
  });

  assert.equal(loaded.length, 6);
  assert.equal(loaded[5]?.name, "Productivity");
  assert.equal(store.getItem(M2NEX_PROFILE_STORAGE_KEY), null);
});
