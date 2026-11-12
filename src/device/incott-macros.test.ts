import assert from "node:assert/strict";
import test from "node:test";

import { INCOTT_MACRO_MAX_STEPS, INCOTT_MACRO_MOUSE_KEYS, incottMacroKeyLabel } from "@openmouse/protocol/incott";

import {
  INCOTT_MACRO_KEY_CHOICES,
  appendRecordedStep,
  emptyMacro,
  incottMacroAssignment,
  incottMacroKeyForCode,
  incottMacroKeyForMouseButton,
  macroDurationMs,
  parseStore,
  stepsForDevice,
  type MacroStore,
} from "./incott-macros.ts";

test("macro duration is the sum of its delays", () => {
  assert.equal(macroDurationMs([]), 0);
  assert.equal(macroDurationMs([
    { key: 0xf0, press: true, delayMs: 40 },
    { key: 0xf0, press: false, delayMs: 1200 },
  ]), 1240);
});

test("a fixed delay replaces the recorded timing without destroying it", () => {
  // The mode is stored beside the steps, not written into them, so switching
  // to a fixed gap and back returns the recorded timing intact.
  const macro = {
    ...emptyMacro("click"),
    delay: { mode: "fixed" as const, fixedMs: 25 },
    steps: [
      { key: 0xf0, press: true, delayMs: 84 },
      { key: 0xf0, press: false, delayMs: 252 },
    ],
  };
  assert.deepEqual(stepsForDevice(macro).map((step) => step.delayMs), [25, 25]);
  assert.deepEqual(macro.steps.map((step) => step.delayMs), [84, 252], "the recording is untouched");
  assert.deepEqual(
    stepsForDevice({ ...macro, delay: { mode: "recorded", fixedMs: 25 } }).map((step) => step.delayMs),
    [84, 252],
  );
});

test("no delay sends zeros, keeping the keys and their order", () => {
  const macro = {
    ...emptyMacro("burst"),
    delay: { mode: "none" as const, fixedMs: 60 },
    steps: [
      { key: 0xf0, press: true, delayMs: 84 },
      { key: 0xf0, press: false, delayMs: 1 },
    ],
  };
  const sent = stepsForDevice(macro);
  assert.deepEqual(sent.map((step) => step.delayMs), [0, 0]);
  assert.deepEqual(
    sent.map((step) => [step.key, step.press]),
    macro.steps.map((step) => [step.key, step.press]),
  );
});

test("a new macro starts empty, playing once, with its recorded timing", () => {
  const macro = emptyMacro("Macro 1");
  assert.deepEqual(macro.steps, []);
  assert.equal(macro.loop, "cycle");
  assert.equal(macro.cycles, 1);
  assert.equal(macro.delay.mode, "recorded");
});

test("a recorded gap closes the previous step, not the new one", () => {
  let steps = appendRecordedStep([], 0x04, true, 9999);
  assert.deepEqual(steps, [{ key: 0x04, press: true, delayMs: 0 }], "the first event has nothing before it to close");
  steps = appendRecordedStep(steps, 0x04, false, 85);
  assert.deepEqual(steps, [
    { key: 0x04, press: true, delayMs: 85 },
    { key: 0x04, press: false, delayMs: 0 },
  ]);
});

test("recording stops growing at the buffer's step limit and clamps long gaps", () => {
  let steps = appendRecordedStep([], 0x04, true, 0);
  for (let index = 1; index < INCOTT_MACRO_MAX_STEPS + 5; index += 1) {
    steps = appendRecordedStep(steps, 0x04, index % 2 === 0, 70000);
  }
  assert.ok(steps.length <= INCOTT_MACRO_MAX_STEPS);
  assert.equal(steps[0]!.delayMs, 0xffff, "an LE16 field cannot hold more");
});

test("at the step limit a held key still gets its release", () => {
  let steps = appendRecordedStep([], 0x04, true, 0);
  // Fill with taps of another key until the next press would not leave room.
  for (let index = 0; index < INCOTT_MACRO_MAX_STEPS; index += 1) {
    steps = appendRecordedStep(steps, 0x05, true, 1);
    steps = appendRecordedStep(steps, 0x05, false, 1);
  }
  assert.ok(steps.length < INCOTT_MACRO_MAX_STEPS, "room is held back for the key still down");
  steps = appendRecordedStep(steps, 0x04, false, 1);
  assert.equal(steps.at(-1)!.key, 0x04);
  assert.equal(steps.at(-1)!.press, false);
  assert.ok(steps.length <= INCOTT_MACRO_MAX_STEPS);
});

test("the store survives garbage and drops assignments to missing macros", () => {
  assert.deepEqual(parseStore(null), { macros: [], assignments: {} });
  assert.deepEqual(parseStore("{not json"), { macros: [], assignments: {} });
  assert.deepEqual(parseStore("42"), { macros: [], assignments: {} });

  const store = parseStore(JSON.stringify({
    macros: [
      { id: "a", name: "Tap", loop: "bogus", cycles: -3, steps: [{ key: 4, press: true, delayMs: 90000 }] },
      { id: "b", name: "Empty", steps: [] },
    ],
    assignments: { Forward: "a", Back: "b", Nonsense: "a" },
  }));
  assert.equal(store.macros.length, 1, "a macro with no steps is not kept");
  assert.equal(store.macros[0]!.loop, "cycle");
  assert.equal(store.macros[0]!.cycles, 1);
  assert.equal(store.macros[0]!.steps[0]!.delayMs, 0xffff);
  assert.deepEqual(store.assignments, { Forward: "a" });
});

test("an assignment only counts while the mouse reports the button running a macro", () => {
  const store: MacroStore = { macros: [{ ...emptyMacro("Tap"), id: "a" }], assignments: { Forward: "a" } };
  assert.equal(incottMacroAssignment(store, "Forward", undefined), "a", "no mapping read: the store is all there is");
  assert.equal(incottMacroAssignment(store, "Forward", { Forward: "Macro" }), "a");
  assert.equal(
    incottMacroAssignment(store, "Forward", { Forward: "Forward" }),
    null,
    "remapped elsewhere: the button no longer runs it",
  );
  assert.equal(incottMacroAssignment(store, "Back", { Back: "Macro" }), "elsewhere");
  assert.equal(
    incottMacroAssignment(store, "Back", { Back: "Macro (buffer 2)" }),
    null,
    "a binding to another button's buffer never fires, so it is not shown as a macro",
  );
});

test("the recorder maps browser input onto keys the editor can name", () => {
  assert.equal(incottMacroKeyForCode("KeyA"), 0x04);
  assert.equal(incottMacroKeyForCode("Digit0"), 0x27);
  assert.equal(incottMacroKeyForCode("ShiftLeft"), 0xe1);
  assert.equal(incottMacroKeyForCode("NumpadAdd"), null);
  assert.equal(incottMacroKeyForMouseButton(0), INCOTT_MACRO_MOUSE_KEYS.left);
  assert.equal(incottMacroKeyForMouseButton(2), INCOTT_MACRO_MOUSE_KEYS.right);
  assert.equal(incottMacroKeyForMouseButton(3), null);
  for (const key of [...INCOTT_MACRO_KEY_CHOICES.mouse, ...INCOTT_MACRO_KEY_CHOICES.keyboard]) {
    assert.notEqual(incottMacroKeyLabel(key), null, `key 0x${key.toString(16)} has a name`);
  }
});
