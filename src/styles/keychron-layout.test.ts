import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./areas/keychron.css", import.meta.url), "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} rule`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
};

// A layout engine is not available in unit tests, so these guard the properties
// that keep the response curve card inside its grid cell: every grid track and
// item may shrink, nothing sets a fixed minimum wider than a laptop-width card,
// and wide content wraps instead of spilling into the next card.
test("keychron cards can shrink inside the panel grid", () => {
  assert.match(rule(".keyboard-panel > .keyboard-workspace-card"), /min-width:\s*0/);
});

test("the response curve wraps to one column instead of overflowing", () => {
  assert.match(rule(".keychron-curve-body"), /repeat\(auto-fit,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/);
  assert.match(rule(".keychron-curve-body > *"), /min-width:\s*0/);
});

test("the curve table is fixed layout with shrinkable inputs and wrapping text", () => {
  assert.match(rule(".keychron-curve-table"), /table-layout:\s*fixed/);
  assert.match(rule(".keychron-curve-table input"), /min-width:\s*0/);
  assert.match(rule(".keychron-curve-raw"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(".keychron-curve-readout"), /overflow-wrap:\s*anywhere/);
});

test("action buttons sit in a wrapping row", () => {
  const actions = rule(".keychron-actions");
  assert.match(actions, /display:\s*flex/);
  assert.match(actions, /flex-wrap:\s*wrap/);
});

test("the only wide fixed minimum is the key map, which scrolls inside its own container", () => {
  for (const match of css.matchAll(/([^{}\n]+)\{[^}]*min-width:\s*(\d+)px/g)) {
    assert.ok(Number(match[2]) <= 100 || match[1]!.includes(".keychron-board"), match[0]);
  }
});
