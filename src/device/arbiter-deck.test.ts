import assert from "node:assert/strict";
import test from "node:test";
import { ARBITER_PRODUCTS, arbiterLayout } from "@openmouse/keyboard-protocol/arbiter";
import { deckRows } from "./arbiter-deck.ts";
import { ARBITER_KEY_CHOICES, arbiterEffectLabel, arbiterHexToRgb, arbiterKeyCategory, arbiterKeyLabel, arbiterRgbToHex } from "./arbiter-labels.ts";

test("every wire entry of every Arbiter model is drawn once, inside its table", () => {
  for (const product of ARBITER_PRODUCTS) {
    for (const table of ["travel", "bindings"] as const) {
      const wires = deckRows(product, table).flat().map((key) => key.wire);
      assert.equal(new Set(wires).size, wires.length, `${product.name} ${table} repeats a key`);
      const size = table === "travel" ? product.travelKeys : product.bindingKeys;
      const keys = arbiterLayout(product).matrix.filter((key) => key.name !== "None").length;
      assert.equal(wires.length, keys, `${product.name} ${table}`);
      assert.ok(wires.every((wire) => wire >= 0 && wire < size));
    }
  }
});

test("key labels cover every factory code the layouts carry except the reserved FN codes", () => {
  const reserved = new Set([224, 148, 202, 204, 205, 206, 207, 243]);
  for (const product of ARBITER_PRODUCTS) {
    for (const layer of arbiterLayout(product).layers) {
      for (const code of layer) {
        if (code === 0 || reserved.has(code)) continue;
        assert.notEqual(arbiterKeyLabel(code), null, `${product.name} has no label for code ${code}`);
      }
    }
  }
  assert.equal(arbiterKeyLabel(249), "SuperTap");
  assert.equal(arbiterKeyLabel(245), "Fn");
  assert.equal(arbiterKeyLabel(204), null);
});

test("the picker lists only codes that have a label, each in one category", () => {
  const seen = new Set<number>();
  for (const codes of Object.values(ARBITER_KEY_CHOICES)) {
    for (const code of codes) {
      assert.notEqual(arbiterKeyLabel(code), null, `code ${code}`);
      assert.ok(!seen.has(code), `code ${code} is in two categories`);
      seen.add(code);
    }
  }
  assert.equal(arbiterKeyCategory(65), "letters");
  assert.equal(arbiterKeyCategory(204), null);
});

test("effect names and colours round-trip", () => {
  assert.equal(arbiterEffectLabel(0), "Spectral Cycle");
  assert.equal(arbiterRgbToHex(arbiterHexToRgb("#1a2b3c")), "#1a2b3c");
});
