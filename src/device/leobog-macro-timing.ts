import {
  LEOBOG_GM3_MOUSE_BUTTON,
  type LeobogGm3MacroStep,
} from "@openmouse/protocol/leobog";

/**
 * Ceiling for one recorded hold/gap.
 *
 * The device keeps a key held for exactly the recorded time, and the host's
 * key-repeat then fires for as long as it is down. A page stall that stretches
 * one measurement into seconds would therefore turn a click into a key that
 * hammers until the macro ends, so a recording never stores more than this.
 */
export const LEOBOG_MACRO_RECORDING_MAX_MS = 2_000;

/**
 * Append a recorded event, stamping the step that just ended with how long it
 * lasted.
 *
 * The device reads a step's time as "wait this long after this step", so a
 * press carries its own hold time and the release after it carries the gap to
 * the next press. Stamping the *new* step instead shifts every measurement by
 * one place: the first press would run with a meaningless time and the last
 * release would carry a hold nobody asked for.
 *
 * Recording `C` for 234 ms, a 469 ms gap, then `D` for 125 ms therefore
 * produces exactly the record the vendor application uploads:
 * `234 press C · 469 release C · 125 press D · 0 release D`.
 */
export function leobogMacroAppendRecordedStep(
  steps: readonly LeobogGm3MacroStep[],
  event: LeobogGm3MacroStep["event"],
  elapsedMs: number,
  maxSteps: number,
): LeobogGm3MacroStep[] {
  if (steps.length >= maxSteps) return [...steps];
  const hold = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.min(LEOBOG_MACRO_RECORDING_MAX_MS, Math.round(elapsedMs)))
    : 0;
  const stamped = steps.length === 0
    ? [...steps]
    : steps.map((step, at) => (at === steps.length - 1 ? { ...step, delayMs: hold } : { ...step }));
  return [...stamped, { delayMs: 0, event: { ...event } }];
}

/**
 * When a recorder event actually happened, not when its handler got to run.
 *
 * A page stall delays the handler, so measuring from the handler call turns a
 * quick tap into a multi-second hold. The device keeps a step held for exactly
 * that time and the host's key-repeat fires for the whole hold, so one stall
 * turns a recorded click into a key that hammers until the macro ends. The
 * browser stamps an event with the time it received the input, which a stalled
 * main thread cannot move.
 */
export function leobogMacroEventTime(event: { timeStamp: number }): number {
  const { timeStamp } = event;
  // Browsers that report a Unix timestamp for events would push the gap far
  // past the recording ceiling; fall back to the handler time for those.
  if (!Number.isFinite(timeStamp) || timeStamp <= 0 || timeStamp > 1e10) {
    return performance.now();
  }
  return timeStamp;
}

/**
 * Mouse buttons the editor offers, in the HID order the macro table uses. The
 * labels match the `map.button*` entries, so `displayText` localizes them.
 */
export const LEOBOG_MACRO_MOUSE_CHOICES: ReadonlyArray<{ button: number; label: string }> = [
  { button: LEOBOG_GM3_MOUSE_BUTTON.left, label: "Left" },
  { button: LEOBOG_GM3_MOUSE_BUTTON.right, label: "Right" },
  { button: LEOBOG_GM3_MOUSE_BUTTON.middle, label: "Middle" },
  { button: LEOBOG_GM3_MOUSE_BUTTON.back, label: "Backward" },
  { button: LEOBOG_GM3_MOUSE_BUTTON.forward, label: "Forward" },
];

/** DOM `MouseEvent.button` values, in HID order. */
export const LEOBOG_MACRO_DOM_BUTTON: Readonly<Record<number, number>> = {
  0: LEOBOG_GM3_MOUSE_BUTTON.left,
  2: LEOBOG_GM3_MOUSE_BUTTON.right,
  1: LEOBOG_GM3_MOUSE_BUTTON.middle,
  3: LEOBOG_GM3_MOUSE_BUTTON.back,
  4: LEOBOG_GM3_MOUSE_BUTTON.forward,
};

export function leobogMacroIsMouse(step: LeobogGm3MacroStep): boolean {
  return step.event.type === "mouseDown" || step.event.type === "mouseUp";
}

export function leobogMacroIsRelease(step: LeobogGm3MacroStep): boolean {
  return step.event.type === "keyUp" || step.event.type === "mouseUp";
}

/**
 * Option value for a step's input, so keys and mouse buttons share one
 * dropdown: `key:<hid usage>` or `mouse:<button number>`.
 */
export function leobogMacroInputValue(step: LeobogGm3MacroStep): string {
  return `${leobogMacroIsMouse(step) ? "mouse" : "key"}:${step.event.hidUsage}`;
}

/** Turns a dropdown value plus the press/release choice back into a step event. */
export function leobogMacroEventFromInput(
  value: string,
  release: boolean,
): LeobogGm3MacroStep["event"] {
  const separator = value.indexOf(":");
  const mouse = value.slice(0, separator) === "mouse";
  const code = Number(value.slice(separator + 1));
  if (mouse) return { type: release ? "mouseUp" : "mouseDown", hidUsage: code };
  return { type: release ? "keyUp" : "keyDown", hidUsage: code };
}
