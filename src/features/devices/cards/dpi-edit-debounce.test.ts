import assert from "node:assert/strict";
import { test } from "node:test";

import { createDpiEditDebouncer, type EditTimers } from "./dpi-edit-debounce.ts";

function fakeTimers(): EditTimers & { advance(ms: number): void; active(): number } {
  let now = 0;
  let nextId = 1;
  const queue = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      queue.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(handle) {
      queue.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, entry] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at > now || !queue.has(id)) continue;
        queue.delete(id);
        entry.callback();
      }
    },
    active: () => queue.size,
  };
}

test("a scheduled commit runs once after its delay", () => {
  const timers = fakeTimers();
  const edits = createDpiEditDebouncer(timers);
  const runs: string[] = [];
  edits.schedule(() => runs.push("a"), 450);
  assert.equal(edits.pending(), true);
  timers.advance(449);
  assert.deepEqual(runs, []);
  timers.advance(1);
  assert.deepEqual(runs, ["a"]);
  assert.equal(edits.pending(), false);
  timers.advance(1000);
  assert.deepEqual(runs, ["a"]);
});

test("a newer schedule replaces the pending commit", () => {
  const timers = fakeTimers();
  const edits = createDpiEditDebouncer(timers);
  const runs: string[] = [];
  edits.schedule(() => runs.push("old"), 450);
  timers.advance(200);
  edits.schedule(() => runs.push("new"), 450);
  assert.equal(timers.active(), 1);
  timers.advance(1000);
  assert.deepEqual(runs, ["new"]);
});

test("cancel drops the pending commit and reports whether one was pending", () => {
  const timers = fakeTimers();
  const edits = createDpiEditDebouncer(timers);
  const runs: string[] = [];
  assert.equal(edits.cancel(), false);
  edits.schedule(() => runs.push("a"), 450);
  assert.equal(edits.cancel(), true);
  assert.equal(edits.pending(), false);
  assert.equal(edits.cancel(), false);
  timers.advance(1000);
  assert.deepEqual(runs, []);
});

test("a preset picked after a slider edit is not overwritten by the slider's stale rows", () => {
  const timers = fakeTimers();
  const edits = createDpiEditDebouncer(timers);
  const applied: number[] = [];

  // Slider on the active row moves to 1600; the commit captures those rows.
  const snapshotRows = [{ enabled: true, value: "1600" }, { enabled: false, value: "3200" }];
  edits.schedule(() => {
    const active = snapshotRows.find((row) => row.enabled);
    if (active) applied.push(Number(active.value));
  }, 450);

  // The user picks the 3200 preset before the debounce fires, as the single
  // DPI view does: drop the pending commit, then apply the pick right away.
  timers.advance(100);
  edits.cancel();
  applied.push(3200);

  timers.advance(1000);
  assert.deepEqual(applied, [3200]);
});
