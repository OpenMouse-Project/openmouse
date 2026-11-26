import assert from "node:assert/strict";
import test from "node:test";
import { keychronKeycodeContext, keychronKeycodeIsChoosable, keychronKeycodeLegend } from "@openmouse/keyboard-protocol/keychron";
import { entryMatches, pickerCatalog, pickerGroups } from "./keychron-picker.ts";

const context = keychronKeycodeContext(0x040c, 12);
const catalog = pickerCatalog(context, 3);

test("the catalog groups keys, limits layer keys to the board and includes its custom keys", () => {
  assert.deepEqual(catalog.map((category) => category.id), [
    "letters", "numbers", "punctuation", "editing", "navigation", "function", "modifiers", "keypad", "system", "media", "layers", "special", "keychron",
  ]);
  const layerLabels = catalog.find((category) => category.id === "layers")!.entries.map((entry) => entry.label);
  assert.ok(layerLabels.includes("MO2"));
  assert.ok(!layerLabels.includes("MO3"));
  assert.ok(catalog.find((category) => category.id === "keychron")!.entries.length > 0);
});

test("search matches the label or the title, any case, every word", () => {
  const entry = { code: 0x2a, label: "Bksp", title: "Backspace" };
  assert.ok(entryMatches(entry, "bksp"));
  assert.ok(entryMatches(entry, "BACK"));
  assert.ok(entryMatches(entry, "back sp"));
  assert.ok(!entryMatches(entry, "enter"));
  assert.ok(entryMatches(entry, "   "));
});

test("without a search the chosen category shows; with one every category is searched", () => {
  assert.deepEqual(pickerGroups(catalog, "numbers", "").map((group) => group.id), ["numbers"]);
  assert.deepEqual(pickerGroups(catalog, "nonsense", "").map((group) => group.id), ["letters"]);
  const hits = pickerGroups(catalog, "numbers", "escape");
  assert.ok(hits.length > 0);
  assert.ok(hits.every((group) => group.entries.every((entry) => entryMatches(entry, "escape"))));
  assert.deepEqual(pickerGroups(catalog, "letters", "zzzzzz"), []);
});

test("an unrecognised keycode is shown as hex and is never offered", () => {
  const unknown = keychronKeycodeLegend(0xbeef, context);
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.label, "0xBEEF");
  assert.equal(keychronKeycodeIsChoosable(0xbeef, context), false);
  assert.ok(!catalog.some((category) => category.entries.some((entry) => entry.code === 0xbeef)));
  assert.ok(catalog.every((category) => category.entries.every((entry) => keychronKeycodeIsChoosable(entry.code, context))));
});

test("every key the legacy catalog offers is valid on legacy firmware", () => {
  const legacy = keychronKeycodeContext(0x040c, 10);
  for (const category of pickerCatalog(legacy, 3)) {
    for (const entry of category.entries) assert.ok(keychronKeycodeIsChoosable(entry.code, legacy), `${category.id} ${entry.label}`);
  }
});
