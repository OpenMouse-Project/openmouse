import type { LogitechButtonAction } from "@openmouse/protocol/drivers/logitech/onboard-profiles";

/** What a button can be set to: one of the three kinds the onboard profile stores. */
export type CommandTarget =
  | { kind: "action"; action: LogitechButtonAction }
  | { kind: "keyboard"; key: number; modifiers: number }
  | { kind: "consumer"; usage: number };

export interface CommandEntry {
  id: string;
  label: string;
  /** The shortcut or a short note, shown beside the label. */
  hint?: string;
  target: CommandTarget;
}

export interface CommandSection {
  id: string;
  title: string;
  entries: CommandEntry[];
}

// HID keyboard modifier bits, as the profile stores them.
export const CTRL = 0x01;
export const SHIFT = 0x02;
export const ALT = 0x04;
export const META = 0x08;

// HID keyboard usages used below.
const KEY = {
  A: 0x04, C: 0x06, D: 0x07, L: 0x0f, N: 0x11, O: 0x12, S: 0x16, T: 0x17, V: 0x19, W: 0x1a, X: 0x1b, Y: 0x1c, Z: 0x1d,
  ZERO: 0x27, ESC: 0x29, TAB: 0x2b, MINUS: 0x2d, EQUALS: 0x2e, F4: 0x3d, F5: 0x3e, PRINT_SCREEN: 0x46, LEFT: 0x50, RIGHT: 0x4f,
} as const;

const KEY_NAMES: Record<number, string> = {
  0x28: "Enter", 0x29: "Esc", 0x2a: "Backspace", 0x2b: "Tab", 0x2c: "Space", 0x2d: "-", 0x2e: "=",
  0x2f: "[", 0x30: "]", 0x31: "\\", 0x33: ";", 0x34: "'", 0x35: "`", 0x36: ",", 0x37: ".", 0x38: "/",
  0x46: "Print Screen", 0x47: "Scroll Lock", 0x48: "Pause", 0x49: "Insert", 0x4a: "Home", 0x4b: "Page Up",
  0x4c: "Delete", 0x4d: "End", 0x4e: "Page Down", 0x4f: "→", 0x50: "←", 0x51: "↓", 0x52: "↑",
};

const action = (name: LogitechButtonAction, hint?: string): CommandEntry => ({
  id: `action:${name}`,
  label: name,
  hint,
  target: { kind: "action", action: name },
});

const shortcut = (id: string, label: string, key: number, modifiers: number): CommandEntry => ({
  id: `key:${id}`,
  label,
  hint: shortcutText(key, modifiers),
  target: { kind: "keyboard", key, modifiers },
});

const media = (id: string, label: string, usage: number): CommandEntry => ({
  id: `consumer:${id}`,
  label,
  target: { kind: "consumer", usage },
});

export const COMMAND_SECTIONS: readonly CommandSection[] = [
  {
    id: "mouse",
    title: "Mouse",
    entries: [
      action("Left click"), action("Right click"), action("Middle click"), action("Back"), action("Forward"),
      action("Tilt left"), action("Tilt right"), action("Disabled"),
    ],
  },
  {
    id: "dpi",
    title: "DPI",
    entries: [action("Next DPI"), action("Previous DPI"), action("Cycle DPI"), action("Default DPI"), action("DPI Shift")],
  },
  {
    id: "profiles",
    title: "Profiles",
    entries: [
      action("Next profile"), action("Previous profile"), action("Cycle profiles"), action("G-Shift"), action("Battery indicator"),
    ],
  },
  {
    id: "editing",
    title: "Editing",
    entries: [
      shortcut("copy", "Copy", KEY.C, CTRL), shortcut("paste", "Paste", KEY.V, CTRL), shortcut("cut", "Cut", KEY.X, CTRL),
      shortcut("undo", "Undo", KEY.Z, CTRL), shortcut("redo", "Redo", KEY.Y, CTRL), shortcut("select-all", "Select all", KEY.A, CTRL),
      shortcut("save", "Save", KEY.S, CTRL), shortcut("open", "Open", KEY.O, CTRL), shortcut("new", "New", KEY.N, CTRL),
    ],
  },
  {
    id: "browser",
    title: "Browser",
    entries: [
      shortcut("new-tab", "New tab", KEY.T, CTRL), shortcut("close-tab", "Close tab", KEY.W, CTRL),
      shortcut("next-tab", "Next tab", KEY.TAB, CTRL), shortcut("previous-tab", "Previous tab", KEY.TAB, CTRL | SHIFT),
      shortcut("zoom-in", "Zoom in", KEY.EQUALS, CTRL), shortcut("zoom-out", "Zoom out", KEY.MINUS, CTRL),
      shortcut("zoom-reset", "Zoom reset", KEY.ZERO, CTRL), shortcut("reload", "Reload", KEY.F5, 0),
      shortcut("page-back", "Page back", KEY.LEFT, ALT), shortcut("page-forward", "Page forward", KEY.RIGHT, ALT),
    ],
  },
  {
    id: "media",
    title: "Media",
    entries: [
      media("volume-up", "Volume up", 233), media("volume-down", "Volume down", 234), media("mute", "Mute", 226),
      media("play-pause", "Play / pause", 205), media("next-track", "Next track", 181), media("previous-track", "Previous track", 182),
    ],
  },
  {
    id: "system",
    title: "System",
    entries: [
      shortcut("task-manager", "Task manager", KEY.ESC, CTRL | SHIFT), shortcut("close-window", "Close window", KEY.F4, ALT),
      shortcut("desktop", "Show desktop", KEY.D, META), shortcut("screenshot", "Screenshot", KEY.S, META | SHIFT),
      shortcut("lock", "Lock screen", KEY.L, META), shortcut("print-screen", "Print screen", KEY.PRINT_SCREEN, 0),
    ],
  },
];

export function keyName(usage: number): string {
  if (usage >= 0x04 && usage <= 0x1d) return String.fromCharCode(0x41 + usage - 0x04);
  if (usage >= 0x1e && usage <= 0x26) return String(usage - 0x1d);
  if (usage === 0x27) return "0";
  if (usage >= 0x3a && usage <= 0x45) return `F${usage - 0x39}`;
  return KEY_NAMES[usage] ?? `Key 0x${usage.toString(16)}`;
}

/** "Ctrl + Shift + Tab" for a key and its modifier bits. */
export function shortcutText(key: number, modifiers: number): string {
  return [
    modifiers & CTRL ? "Ctrl" : null,
    modifiers & SHIFT ? "Shift" : null,
    modifiers & ALT ? "Alt" : null,
    modifiers & META ? "Win" : null,
    keyName(key),
  ].filter(Boolean).join(" + ");
}

const MEDIA_NAMES = new Map<number, string>(
  COMMAND_SECTIONS.flatMap((section) => section.entries)
    .flatMap((entry) => (entry.target.kind === "consumer" ? [[entry.target.usage, entry.label] as [number, string]] : [])),
);

/**
 * What a stored assignment is, in words. `raw` is the 4-byte record; a keyboard
 * shortcut is 80 02 <modifiers> <key> and a media key is 80 03 <usage hi> <usage lo>.
 */
export function describeAssignment(action: string, raw: readonly number[]): string {
  if (action !== "Custom") return action;
  if (raw[0] === 0x80 && raw[1] === 0x02) return shortcutText(raw[3] ?? 0, raw[2] ?? 0);
  if (raw[0] === 0x80 && raw[1] === 0x03) {
    const usage = ((raw[2] ?? 0) << 8) | (raw[3] ?? 0);
    return MEDIA_NAMES.get(usage) ?? `Media key ${usage}`;
  }
  // A macro record is 00 <button> <macro sector> 00.
  if (raw[0] === 0x00 && (raw[2] ?? 0) > 0) return "Macro";
  return "Custom";
}

/** What is "not a real command" for the conflict check. */
const NO_COMMAND = new Set(["-", "Disabled", "Pending"]);
/** Text of a macro or an unreadable custom record: it does something, but we cannot say what. */
const isOpaque = (text: string): boolean => text === "Macro" || text === "Custom" || /-key macro$/.test(text);

/**
 * Plain-words warnings about a button layout: two buttons that do the same thing.
 * (Back or Forward left unset is not flagged: a macro or shortcut may stand in for
 * them, and the check cannot tell.) `buttons` is every button with the text it shows.
 */
export function conflictHints(buttons: readonly { label: string; text: string }[]): string[] {
  const hints: string[] = [];
  const seen = new Map<string, string[]>();
  for (const { label, text } of buttons) {
    if (NO_COMMAND.has(text) || isOpaque(text)) continue;
    seen.set(text, [...(seen.get(text) ?? []), label]);
  }
  for (const [text, labels] of seen) {
    if (labels.length > 1) hints.push(`${labels.join(" and ")} both do ${text}.`);
  }
  return hints;
}

/** True when the stored assignment is exactly this command. */
export function isAssigned(entry: CommandEntry, action: string, raw: readonly number[]): boolean {
  const target = entry.target;
  if (target.kind === "action") return action === target.action;
  if (target.kind === "keyboard") return raw[0] === 0x80 && raw[1] === 0x02 && raw[2] === target.modifiers && raw[3] === target.key;
  return raw[0] === 0x80 && raw[1] === 0x03 && (((raw[2] ?? 0) << 8) | (raw[3] ?? 0)) === target.usage;
}

const CODE_USAGE: Record<string, number> = {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
  BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
  Comma: 0x36, Period: 0x37, Slash: 0x38, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49,
  Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50,
  ArrowDown: 0x51, ArrowUp: 0x52,
};

/** The HID usage for a KeyboardEvent.code, or null for keys the profile cannot store (modifiers, numpad, ...). */
export function usageForCode(code: string): number | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return 0x04 + letter[1].charCodeAt(0) - 0x41;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1] === "0" ? 0x27 : 0x1d + Number(digit[1]);
  const fn = /^F([1-9]|1[0-2])$/.exec(code);
  if (fn) return 0x39 + Number(fn[1]);
  return CODE_USAGE[code] ?? null;
}

/** A recorded key press as a keyboard binding, or null while only modifiers are held. */
export function bindingFromKeyEvent(event: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): CommandTarget | null {
  const key = usageForCode(event.code);
  if (key === null) return null;
  const modifiers = (event.ctrlKey ? CTRL : 0) | (event.shiftKey ? SHIFT : 0) | (event.altKey ? ALT : 0) | (event.metaKey ? META : 0);
  return { kind: "keyboard", key, modifiers };
}
