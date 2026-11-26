import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILT_IN_HITS_PRESETS,
  PRO_HITS_PRESETS,
  decodeHitsCode,
  deleteHitsPreset,
  encodeHitsCode,
  loadHitsPresets,
  presetFits,
  presetMatches,
  saveHitsPreset,
  type HitsPreset,
} from "./hits-presets.ts";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

// The PRO X 3's factory tuning, as captured: actuation 5, rapid trigger 2 (on), haptics 3.
const FACTORY = { actuation: 5, rapidTrigger: 2, rapidTriggerEnabled: true, haptics: 3 };
const LIMITS = { maxActuation: 10, maxRapidTrigger: 5, maxHaptics: 5 };
const preset = (name: string, left = FACTORY, right = FACTORY): HitsPreset => ({ name, left, right });

test("a code round-trips both buttons, and the two can differ", () => {
  const original = { left: FACTORY, right: { actuation: 1, rapidTrigger: 5, rapidTriggerEnabled: false, haptics: 0 } };
  const code = encodeHitsCode(original);
  assert.match(code, /^HITS1-[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeHitsCode(code), original);
  assert.deepEqual(decodeHitsCode(`  ${code}\n`), original, "pasted whitespace is ignored");
});

test("a mistyped, truncated or foreign code is rejected", () => {
  const code = encodeHitsCode({ left: FACTORY, right: FACTORY });
  const flipped = code.slice(0, -3) + (code.at(-3) === "A" ? "B" : "A") + code.slice(-2);
  assert.equal(decodeHitsCode(flipped), null, "the checksum catches a changed character");
  assert.equal(decodeHitsCode(code.slice(0, -2)), null);
  assert.equal(decodeHitsCode("HITS2-" + code.slice(6)), null, "another version is not guessed at");
  assert.equal(decodeHitsCode("not a code"), null);
  assert.equal(decodeHitsCode(""), null);
});

test("a code with a value no HITS mouse could hold is rejected even with a valid checksum", () => {
  // Actuation 0 is below the minimum; build the bytes and checksum by hand.
  const bytes = [1, 0, 2, 3, 1, 5, 2, 3, 1];
  bytes.push(bytes.reduce((sum, value) => (sum + value) & 0xff, 0x5a));
  const code = "HITS1-" + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  assert.equal(decodeHitsCode(code), null);
});

test("a preset fits only inside the mouse's own limits", () => {
  assert.equal(presetFits(preset("x"), LIMITS), true);
  assert.equal(presetFits(preset("x", { ...FACTORY, actuation: 11 }), LIMITS), false);
  assert.equal(presetFits(preset("x", FACTORY, { ...FACTORY, rapidTrigger: 6 }), LIMITS), false);
  assert.equal(presetFits(preset("x", { ...FACTORY, haptics: 0 }), LIMITS), true, "0 haptics is off, which is allowed");
  assert.equal(presetFits(preset("x", { ...FACTORY, actuation: 0 }), LIMITS), false);
  assert.equal(presetFits(preset("x", { ...FACTORY, actuation: 2.5 }), LIMITS), false);
});

test("presets save, replace by name, delete and survive reloading", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadHitsPresets(storage), []);
  saveHitsPreset(storage, preset("Competitive", { ...FACTORY, actuation: 2 }, { ...FACTORY, actuation: 2 }));
  saveHitsPreset(storage, preset("Default"));
  assert.deepEqual(loadHitsPresets(storage).map((entry) => entry.name), ["Competitive", "Default"]);
  saveHitsPreset(storage, preset("Competitive", { ...FACTORY, actuation: 3 }, { ...FACTORY, actuation: 3 }));
  const reloaded = loadHitsPresets(storage);
  assert.equal(reloaded.length, 2, "the same name replaces, it does not duplicate");
  assert.equal(reloaded.find((entry) => entry.name === "Competitive")?.left.actuation, 3);
  assert.deepEqual(deleteHitsPreset(storage, "Default").map((entry) => entry.name), ["Competitive"]);
});

test("a blank name is not saved, and a long one is shortened", () => {
  const storage = new MemoryStorage();
  assert.equal(saveHitsPreset(storage, preset("   ")), null);
  const saved = saveHitsPreset(storage, preset("x".repeat(100)));
  assert.equal(saved?.[0].name.length, 40);
});

test("damaged or out-of-range stored presets are dropped, not trusted", () => {
  const storage = new MemoryStorage();
  storage.setItem("openmouse-hits-presets-v1", JSON.stringify([
    preset("Good"),
    { name: "Broken", left: FACTORY },
    { name: "TooBig", left: { ...FACTORY, actuation: 999 }, right: FACTORY },
    "not an object",
  ]));
  assert.deepEqual(loadHitsPresets(storage).map((entry) => entry.name), ["Good"]);
  storage.setItem("openmouse-hits-presets-v1", "{ not json");
  assert.deepEqual(loadHitsPresets(storage), []);
});

test("the built-in presets are valid for the narrowest mouse and survive a share code", () => {
  const narrow = { maxActuation: 10, maxRapidTrigger: 5, maxHaptics: 5 };
  assert.deepEqual(BUILT_IN_HITS_PRESETS.map((preset) => preset.name), ["Default", "Competitive", "Balanced", "Casual"]);
  for (const preset of [...BUILT_IN_HITS_PRESETS, ...PRO_HITS_PRESETS]) {
    assert.equal(presetFits(preset, narrow), true, preset.name);
    assert.deepEqual(decodeHitsCode(encodeHitsCode(preset)), { left: preset.left, right: preset.right });
  }
});

test("a preset matches what is on the mouse, ignoring a rapid trigger step that is off", () => {
  const side = (rapidTriggerEnabled: boolean, rapidTrigger: number) => ({ actuation: 5, rapidTrigger, rapidTriggerEnabled, haptics: 3 });
  const preset = { left: side(false, 2), right: side(false, 2) };
  assert.equal(presetMatches(preset, { left: side(false, 1), right: side(false, 4) }), true);
  assert.equal(presetMatches({ left: side(true, 2), right: side(true, 2) }, { left: side(true, 1), right: side(true, 2) }), false);
  assert.equal(presetMatches(preset, { left: { ...side(false, 2), actuation: 6 }, right: side(false, 2) }), false);
});
