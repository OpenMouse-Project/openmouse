import {
  INCOTT_BUTTON_NAMES,
  INCOTT_MACRO_ACTION_LABEL,
  INCOTT_MACRO_MAX_STEPS,
  INCOTT_MACRO_MOUSE_KEYS,
  incottMacroKeyLabel,
  type IncottButtonName,
  type IncottMacroLoop,
  type IncottMacroStep,
} from "@openmouse/protocol/incott";

/**
 * Local store for Incott macros: a library of named macros, plus which button
 * each one is assigned to.
 *
 * WHY IT LIVES HERE: the device has no macro READ command. It accepts a
 * 320-byte buffer and never hands one back, so nothing can ask the mouse what
 * a buffer contains. The library is therefore local state, and the card is an
 * authoring tool rather than a view of the device like every other card.
 *
 * WHY A LIBRARY RATHER THAN ONE MACRO PER BUTTON: the hardware constraint is
 * that a button runs the buffer carrying its own index, not that a macro
 * belongs to a button. Assigning a macro to a button uploads its steps into
 * that button's buffer, so one macro can drive several buttons and a macro can
 * exist without being assigned at all.
 *
 * What the store believes about assignments is checked against the button
 * mapping the mouse DOES report (see `incottMacroAssignment`), so a button
 * remapped elsewhere stops showing a macro it no longer runs.
 */

/**
 * How the gaps between steps are decided.
 *
 * Kept beside the steps rather than written into them, so switching to a fixed
 * gap and back does not destroy the recorded timing. The mouse only ever sees
 * the resolved per-step delays (see `stepsForDevice`).
 */
export interface MacroDelay {
  mode: "recorded" | "none" | "fixed";
  /** Milliseconds every step waits in "fixed" mode. */
  fixedMs: number;
}

export interface StoredMacro {
  id: string;
  name: string;
  loop: IncottMacroLoop;
  cycles: number;
  delay: MacroDelay;
  steps: IncottMacroStep[];
}

export interface MacroStore {
  macros: StoredMacro[];
  /** Button -> macro id. A button appears here only while it runs a macro. */
  assignments: Partial<Record<IncottButtonName, string>>;
}

const KEY = "openmouse.incott-macros";
const DEFAULT_FIXED_MS = 60;
/** The largest delay or repeat count the buffer's LE16 fields can hold. */
export const INCOTT_MACRO_MAX_U16 = 0xffff;

export function newMacroId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyMacro(name: string): StoredMacro {
  return {
    id: newMacroId(),
    name,
    loop: "cycle",
    cycles: 1,
    delay: { mode: "recorded", fixedMs: DEFAULT_FIXED_MS },
    steps: [],
  };
}

/** The delays the mouse actually receives, once the delay mode is applied. */
export function stepsForDevice(macro: StoredMacro): IncottMacroStep[] {
  if (macro.delay.mode === "recorded") return macro.steps;
  const delayMs = macro.delay.mode === "none" ? 0 : macro.delay.fixedMs;
  return macro.steps.map((step) => ({ ...step, delayMs }));
}

/** Total time one pass through the macro takes, for the editor's readout. */
export function macroDurationMs(steps: readonly IncottMacroStep[]): number {
  return steps.reduce((total, step) => total + step.delayMs, 0);
}

/** Clamps a typed number into a buffer LE16 field. */
export function clampU16(value: number, min = 0): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(INCOTT_MACRO_MAX_U16, Math.max(min, Math.round(value)));
}

/**
 * Appends one recorded event. The gap measured before it closes the PREVIOUS
 * step: the buffer stores "wait this long after this event", so the time
 * between two events belongs to the first of them.
 */
export function appendRecordedStep(
  steps: readonly IncottMacroStep[],
  key: number,
  press: boolean,
  gapMs: number,
): IncottMacroStep[] {
  if (steps.length >= INCOTT_MACRO_MAX_STEPS) return steps.slice();
  // Keep room for the release of every key still down, so a macro cut off at
  // the limit never leaves a key stuck: a new press is taken only if it and
  // its own release still fit beside the releases already owed. A release for
  // a key that was never recorded as pressed (its press was refused) is noise.
  const down = new Set<number>();
  for (const step of steps) {
    if (step.press) down.add(step.key);
    else down.delete(step.key);
  }
  if (press && steps.length + down.size + 2 > INCOTT_MACRO_MAX_STEPS) return steps.slice();
  if (!press && !down.has(key)) return steps.slice();
  const closed = steps.map((step, index) =>
    index === steps.length - 1 ? { ...step, delayMs: clampU16(gapMs) } : step,
  );
  return [...closed, { key, press, delayMs: 0 }];
}

function isStep(value: unknown): value is IncottMacroStep {
  if (typeof value !== "object" || value === null) return false;
  const step = value as Record<string, unknown>;
  return typeof step.key === "number"
    && typeof step.press === "boolean"
    && typeof step.delayMs === "number";
}

function readDelay(value: unknown): MacroDelay {
  const fallback: MacroDelay = { mode: "recorded", fixedMs: DEFAULT_FIXED_MS };
  if (typeof value !== "object" || value === null) return fallback;
  const delay = value as Record<string, unknown>;
  const mode = delay.mode;
  return {
    mode: mode === "none" || mode === "fixed" ? mode : "recorded",
    fixedMs: typeof delay.fixedMs === "number" && delay.fixedMs >= 0
      ? clampU16(Math.floor(delay.fixedMs))
      : fallback.fixedMs,
  };
}

function readMacro(entry: unknown, fallbackName: string): StoredMacro | null {
  if (typeof entry !== "object" || entry === null) return null;
  const macro = entry as Record<string, unknown>;
  const steps = Array.isArray(macro.steps) ? macro.steps.filter(isStep) : [];
  if (steps.length === 0) return null;
  const loop = macro.loop;
  return {
    id: typeof macro.id === "string" && macro.id ? macro.id : newMacroId(),
    name: typeof macro.name === "string" && macro.name ? macro.name : fallbackName,
    loop: loop === "untilKeyRelease" || loop === "untilAnyKey" || loop === "cycle" ? loop : "cycle",
    cycles: typeof macro.cycles === "number" && macro.cycles > 0 ? clampU16(Math.floor(macro.cycles), 1) : 1,
    delay: readDelay(macro.delay),
    steps: steps.slice(0, INCOTT_MACRO_MAX_STEPS).map((step) => ({ ...step, delayMs: clampU16(step.delayMs) })),
  };
}

/** Parses a stored value, discarding anything malformed rather than throwing. */
export function parseStore(raw: string | null): MacroStore {
  const empty: MacroStore = { macros: [], assignments: {} };
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const source = parsed as Record<string, unknown>;
    const macros = Array.isArray(source.macros)
      ? source.macros
        .map((entry, index) => readMacro(entry, `Macro ${index + 1}`))
        .filter((macro): macro is StoredMacro => macro !== null)
      : [];

    const assignments: MacroStore["assignments"] = {};
    const stored = typeof source.assignments === "object" && source.assignments !== null
      ? source.assignments as Record<string, unknown>
      : {};
    for (const button of INCOTT_BUTTON_NAMES) {
      const id = stored[button];
      // Drop an assignment whose macro no longer exists, rather than leaving
      // a button pointing at nothing.
      if (typeof id === "string" && macros.some((macro) => macro.id === id)) {
        assignments[button] = id;
      }
    }
    return { macros, assignments };
  } catch {
    return empty;
  }
}

export function loadStore(): MacroStore {
  try {
    return parseStore(localStorage.getItem(KEY));
  } catch {
    return parseStore(null);
  }
}

export function saveStore(store: MacroStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked. The upload still reached the mouse; only the
    // local copy of the definition is lost, so this must not throw.
  }
}

/**
 * What a button runs, judged against the mapping the mouse reports.
 *
 * - a macro id: the store assigned it and the mouse confirms the button runs
 *   its own macro buffer
 * - "elsewhere": the mouse says the button runs a macro this browser has no
 *   record of (written by the vendor tool or another browser)
 * - null: the button does something else, whatever the store remembers
 *
 * With no reported mapping at all the store is the only source, so it wins.
 */
export function incottMacroAssignment(
  store: MacroStore,
  button: IncottButtonName,
  mappings: Readonly<Record<string, string>> | null | undefined,
): string | "elsewhere" | null {
  const local = store.assignments[button] ?? null;
  if (!mappings) return local;
  if (mappings[button] !== INCOTT_MACRO_ACTION_LABEL) return null;
  return local ?? "elsewhere";
}

/**
 * What a button goes back to when its macro is taken off. There is no command
 * to empty a macro buffer, so unassigning can only re-point the button, and
 * its factory action is the least surprising place to land.
 */
export const INCOTT_MACRO_DEFAULT_ACTION: Readonly<Record<IncottButtonName, string>> = {
  Left: "Left click",
  Right: "Right click",
  Middle: "Middle click",
  Forward: "Forward",
  Back: "Back",
  DPI: "DPI cycle",
};

/**
 * Browser `KeyboardEvent.code` -> HID usage, for exactly the keys the Incott
 * key table names. A key outside it would upload as a code the editor cannot
 * show, so the recorder ignores it instead.
 */
const KEY_BY_CODE = new Map<string, number>([
  ...Array.from({ length: 26 }, (_, i) => [`Key${String.fromCharCode(65 + i)}`, 0x04 + i] as const),
  ...Array.from({ length: 9 }, (_, i) => [`Digit${i + 1}`, 0x1e + i] as const),
  ["Digit0", 0x27],
  ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 0x3a + i] as const),
  ["Enter", 0x28], ["Escape", 0x29], ["Backspace", 0x2a], ["Tab", 0x2b], ["Space", 0x2c],
  ["Insert", 0x49], ["Delete", 0x4c], ["Home", 0x4a], ["End", 0x4d],
  ["PageUp", 0x4b], ["PageDown", 0x4e],
  ["ArrowUp", 0x52], ["ArrowDown", 0x51], ["ArrowLeft", 0x50], ["ArrowRight", 0x4f],
  ["CapsLock", 0x39], ["NumLock", 0x53], ["ScrollLock", 0x47],
  ["PrintScreen", 0x46], ["Pause", 0x48], ["ContextMenu", 0x65],
  ["ControlLeft", 0xe0], ["ShiftLeft", 0xe1], ["AltLeft", 0xe2], ["MetaLeft", 0xe3],
  ["ControlRight", 0xe4], ["ShiftRight", 0xe5], ["AltRight", 0xe6], ["MetaRight", 0xe7],
]);

/** `MouseEvent.button` -> macro key. Only the three buttons the table has. */
const MOUSE_BY_BUTTON = new Map<number, number>([
  [0, INCOTT_MACRO_MOUSE_KEYS.left],
  [1, INCOTT_MACRO_MOUSE_KEYS.middle],
  [2, INCOTT_MACRO_MOUSE_KEYS.right],
]);

export function incottMacroKeyForCode(code: string): number | null {
  return KEY_BY_CODE.get(code) ?? null;
}

export function incottMacroKeyForMouseButton(button: number): number | null {
  return MOUSE_BY_BUTTON.get(button) ?? null;
}

export function incottMacroKeyName(key: number): string {
  return incottMacroKeyLabel(key) ?? `0x${key.toString(16).padStart(2, "0")}`;
}

/** Every key a step can be set to: mouse buttons first, then the keyboard. */
export const INCOTT_MACRO_KEY_CHOICES: Readonly<{ mouse: readonly number[]; keyboard: readonly number[] }> = {
  mouse: [INCOTT_MACRO_MOUSE_KEYS.left, INCOTT_MACRO_MOUSE_KEYS.right, INCOTT_MACRO_MOUSE_KEYS.middle],
  keyboard: [...KEY_BY_CODE.values()],
};
