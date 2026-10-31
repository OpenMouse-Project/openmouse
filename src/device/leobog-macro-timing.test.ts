import assert from "node:assert/strict";
import test from "node:test";

import {
  leobogGm3DecodeMacroRecord,
  type LeobogGm3MacroStep,
} from "@openmouse/protocol/leobog";
import {
  LEOBOG_MACRO_DOM_BUTTON,
  LEOBOG_MACRO_MOUSE_CHOICES,
  LEOBOG_MACRO_RECORDING_MAX_MS,
  leobogMacroAppendRecordedStep,
  leobogMacroEventFromInput,
  leobogMacroEventTime,
  leobogMacroInputValue,
  leobogMacroIsMouse,
  leobogMacroIsRelease,
} from "./leobog-macro-timing.ts";

/**
 * The `03 00` payload the vendor sent after recording `left click`, a pause,
 * then `C` into a macro named OMM. Captured over USB on 2026-10-27; it is the
 * sample that revealed the `0x20` mouse flag.
 */
const CAPTURED_OMM = new Uint8Array([
  0x04, 0x00, 0x17, 0x00, 0x06, 0x4f, 0x00, 0x4d, 0x00, 0x4d,
  0x00, 0x20, 0x00, 0x8c, 0x01, 0xa0, 0x02, 0xb0, 0x01, 0x00,
  0x00, 0x7d, 0x06, 0x80, 0x00, 0x00, 0x06,
]);

const key = (type: "keyDown" | "keyUp", hidUsage: number) => ({ type, hidUsage });

/** Feed one event at a time the way the recorder's key handler does. */
function record(
  events: ReadonlyArray<{ event: LeobogGm3MacroStep["event"]; elapsedMs: number }>,
  maxSteps = 60,
): LeobogGm3MacroStep[] {
  return events.reduce<LeobogGm3MacroStep[]>(
    (steps, entry) => leobogMacroAppendRecordedStep(steps, entry.event, entry.elapsedMs, maxSteps),
    [],
  );
}

test("stamps each hold on the step it belongs to", () => {
  const steps = record([
    { event: key("keyDown", 0x06), elapsedMs: 0 },
    { event: key("keyUp", 0x06), elapsedMs: 234 },
    { event: key("keyDown", 0x07), elapsedMs: 469 },
    { event: key("keyUp", 0x07), elapsedMs: 125 },
  ]);

  assert.deepEqual(steps, [
    { delayMs: 234, event: { type: "keyDown", hidUsage: 0x06 } },
    { delayMs: 469, event: { type: "keyUp", hidUsage: 0x06 } },
    { delayMs: 125, event: { type: "keyDown", hidUsage: 0x07 } },
    { delayMs: 0, event: { type: "keyUp", hidUsage: 0x07 } },
  ]);
  // This is the captured OM2 macro, so the recorder now reproduces the vendor.
});

test("a stall cannot record a multi-second hold", () => {
  const steps = record([
    { event: key("keyDown", 0x06), elapsedMs: 0 },
    { event: key("keyUp", 0x06), elapsedMs: 30_000 },
  ]);

  assert.equal(steps[0]?.delayMs, LEOBOG_MACRO_RECORDING_MAX_MS);
});

test("odd timings clamp instead of producing nonsense", () => {
  const negative = leobogMacroAppendRecordedStep(
    [{ delayMs: 0, event: key("keyDown", 0x04) }],
    key("keyUp", 0x04),
    -50,
    60,
  );
  assert.equal(negative[0]?.delayMs, 0);

  const notANumber = leobogMacroAppendRecordedStep(
    [{ delayMs: 0, event: key("keyDown", 0x04) }],
    key("keyUp", 0x04),
    Number.NaN,
    60,
  );
  assert.equal(notANumber[0]?.delayMs, 0);
});

test("the first event of a recording starts immediately", () => {
  const steps = record([{ event: key("keyDown", 0x04), elapsedMs: 9_999 }]);
  assert.deepEqual(steps, [{ delayMs: 0, event: { type: "keyDown", hidUsage: 0x04 } }]);
});

test("a full slot stops growing", () => {
  const steps = record(
    Array.from({ length: 5 }, () => ({ event: key("keyDown", 0x04), elapsedMs: 10 })),
    3,
  );
  assert.equal(steps.length, 3);
});

test("a decoded mouse step survives the editor's input dropdown", () => {
  const decoded = leobogGm3DecodeMacroRecord(CAPTURED_OMM);
  assert.ok(decoded, "the captured OMM record must decode");
  assert.deepEqual(decoded.steps.map(leobogMacroInputValue), [
    "mouse:1",
    "mouse:1",
    "key:6",
    "key:6",
  ]);

  // Switching the dropdown back to the value it shows must rebuild the step.
  for (const step of decoded.steps) {
    const value = leobogMacroInputValue(step);
    assert.deepEqual(
      leobogMacroEventFromInput(value, leobogMacroIsRelease(step)),
      step.event,
      value,
    );
  }
});

test("every mouse step the vendor sends is offered as a dropdown option", () => {
  const decoded = leobogGm3DecodeMacroRecord(CAPTURED_OMM);
  assert.ok(decoded);
  const offered = new Set(LEOBOG_MACRO_MOUSE_CHOICES.map((choice) => `mouse:${choice.button}`));
  const mouseSteps = decoded.steps.filter(leobogMacroIsMouse);
  assert.deepEqual(mouseSteps.map((step) => step.event.type), ["mouseDown", "mouseUp"]);
  for (const step of mouseSteps) {
    assert.ok(offered.has(leobogMacroInputValue(step)), leobogMacroInputValue(step));
  }
});

test("the DOM button map covers every offered mouse button", () => {
  // Left, middle, right, back, forward — HID numbers against browser buttons.
  assert.deepEqual(LEOBOG_MACRO_DOM_BUTTON, { 0: 1, 1: 3, 2: 2, 3: 4, 4: 5 });
});

test("a stalled handler runs no time into the recorded hold", () => {
  // The browser stamps an event when it receives the input, so the release of
  // a 240 ms tap stays 240 ms even if its handler runs 900 ms late.
  const pressed = { timeStamp: 1_000 };
  const released = { timeStamp: 1_240 };
  assert.equal(
    leobogMacroEventTime(released) - leobogMacroEventTime(pressed),
    240,
  );

  const steps = record([
    { event: key("keyDown", 0x06), elapsedMs: 0 },
    {
      event: key("keyUp", 0x06),
      elapsedMs: leobogMacroEventTime(released) - leobogMacroEventTime(pressed),
    },
  ]);
  assert.equal(steps[0]?.delayMs, 240);
  assert.ok(steps[0]!.delayMs < LEOBOG_MACRO_RECORDING_MAX_MS);
});

test("an event timestamp on a Unix base is not used as a hold time", () => {
  const at = leobogMacroEventTime({ timeStamp: 1_735_000_000_000 });
  assert.ok(Number.isFinite(at));
  assert.ok(at > 0);
  assert.ok(at < 1e10, "a wall-clock base would blow the hold away");
});
