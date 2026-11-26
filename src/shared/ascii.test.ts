import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ASCII_ROWS,
  asciiColumns,
  asciiGlowRows,
  asciiRowAlpha,
  asciiRowTiming,
  asciiSeedFrom,
  asciiSessionSeed,
  asciiSweepOffset,
  asciiSweepRuns,
  nextAsciiField,
} from "./ascii.ts";

type Golden = {
  rows: number;
  cases: Array<{ cols: number; seed: [number, number]; lines: string[] }>;
  seeds: Array<{ n: number; seed: [number, number] }>;
  columns: Array<{ width: number; cols: number }>;
  alpha: Array<{ position: number; alpha: number }>;
  sweep: Array<{ delta: number; position: number; offset: number }>;
};

const golden = JSON.parse(readFileSync(new URL("./ascii-golden.json", import.meta.url), "utf8")) as Golden;
const f32 = Math.fround;

test("the field matches the native Rust output line for line", () => {
  assert.equal(golden.rows, ASCII_ROWS);
  for (const sample of golden.cases) {
    const seed: [number, number] = [f32(sample.seed[0]), f32(sample.seed[1])];
    assert.deepEqual(asciiGlowRows(sample.cols, ASCII_ROWS, seed), sample.lines, `cols ${sample.cols} seed ${seed}`);
  }
});

test("seeds, columns, fade and sweep match the native recipe", () => {
  for (const { n, seed } of golden.seeds) {
    assert.deepEqual(asciiSeedFrom(n), [f32(seed[0]), f32(seed[1])], `seed ${n}`);
  }
  for (const { width, cols } of golden.columns) assert.equal(asciiColumns(width), cols, `width ${width}`);
  for (const { position, alpha } of golden.alpha) assert.equal(asciiRowAlpha(f32(position)), f32(alpha));
  for (const { delta, position, offset } of golden.sweep) {
    assert.equal(asciiSweepOffset(f32(delta), f32(position)), f32(offset), `delta ${delta} position ${position}`);
  }
});

test("the seed is chosen once per page session", () => {
  const first = asciiSessionSeed();
  assert.deepEqual(asciiSessionSeed(), first);
  assert.ok(Number.isFinite(first[0]) && Number.isFinite(first[1]));
});

test("rows regenerate only when the column count changes", () => {
  const seed: [number, number] = [f32(0.31), f32(0.77)];
  const a = nextAsciiField(null, 1440, seed);
  assert.equal(a.cols, 91);
  assert.equal(a.rows.length, ASCII_ROWS);
  assert.equal(nextAsciiField(a, 1441, seed), a, "same column count keeps the same field");
  const b = nextAsciiField(a, 1920, seed);
  assert.notEqual(b, a);
  assert.equal(b.cols, 104);
  assert.deepEqual(b.rows, asciiGlowRows(104, ASCII_ROWS, seed));
});

test("each row sweeps in once, top rows first, inside 520 ms", () => {
  const top = asciiRowTiming(0);
  const bottom = asciiRowTiming(ASCII_ROWS - 1);
  assert.ok(top.delayMs < bottom.delayMs);
  assert.ok(Math.abs(top.durationMs - 0.45 * 520) < 1e-9);
  assert.ok(bottom.delayMs + bottom.durationMs <= 520 + 1e-9);
  assert.ok(Math.abs(top.alpha - asciiRowAlpha(f32(0.5 / ASCII_ROWS))) < 1e-9);
});

test("reduced motion and the animations preference stop the sweep", () => {
  assert.equal(asciiSweepRuns({ reducedMotion: false, prefersReducedMotion: false }), true);
  assert.equal(asciiSweepRuns({ reducedMotion: true, prefersReducedMotion: false }), false);
  assert.equal(asciiSweepRuns({ reducedMotion: false, prefersReducedMotion: true }), false);
});

test("OS reduced motion can override the sweep without a component rerender", () => {
  const css = readFileSync(new URL("../styles/shell.css", import.meta.url), "utf8");
  const selector = css.match(/([^\n{}]+)\{\s*animation:\s*om-ascii-sweep/)?.[1];
  assert.ok(selector, "sweep rule");
  const specificity = (selector.replace(/:where\([^)]*\)/g, "").match(/\.[\w-]+/g) ?? []).length;
  assert.ok(specificity <= 1, "the later media rule must win the cascade");
});

test("the rendered sweep uses the native cubic curve", () => {
  const css = readFileSync(new URL("../styles/shell.css", import.meta.url), "utf8");
  const curve = css.match(/animation:\s*om-ascii-sweep\s+234ms\s+cubic-bezier\(([^)]+)\)/);
  assert.ok(curve, "one-shot row sweep");
  const [x1, y1, x2, y2] = curve[1]!.split(",").map(Number);
  for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const rest = 1 - t;
    const x = 3 * rest * rest * t * x1! + 3 * rest * t * t * x2! + t * t * t;
    const y = 3 * rest * rest * t * y1! + 3 * rest * t * t * y2! + t * t * t;
    assert.ok(Math.abs(x - t) < 1e-11, `native linear time at ${t}: ${x}`);
    assert.ok(Math.abs(y - (1 - rest ** 3)) < 1e-11, `native ease-out at ${t}: ${y}`);
  }
});
