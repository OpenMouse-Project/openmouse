import { ARBITER_KEY_CODE, ARBITER_LIGHT_EFFECTS } from "@openmouse/keyboard-protocol/arbiter";

export type ArbiterKeyCategory = "letters" | "numbers" | "function" | "punctuation" | "navigation" | "modifiers" | "media" | "special";

/** Vendor key codes are .NET `Keys` values; this names the ones a keyboard can carry. */
const NAMED: Readonly<Record<number, string>> = {
  8: "Backspace", 9: "Tab", 13: "Enter", 20: "Caps Lock", 27: "Esc", 32: "Space",
  33: "Page Up", 34: "Page Down", 35: "End", 36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down",
  42: "Print", 44: "Print Screen", 45: "Insert", 46: "Delete",
  91: "Win", 160: "L Shift", 161: "R Shift", 162: "L Ctrl", 163: "R Ctrl", 164: "L Alt", 165: "R Alt",
  173: "Mute", 174: "Volume down", 175: "Volume up", 176: "Next track", 177: "Previous track", 179: "Play/pause",
  186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\", 221: "]", 222: "'", 226: "\\ (ISO)",
  [ARBITER_KEY_CODE.fnLayer]: "Fn", [ARBITER_KEY_CODE.fn]: "Fn", [ARBITER_KEY_CODE.superTap]: "SuperTap",
};

/** Label for a key code, or null for a code the vendor gives no name (reserved FN codes). */
export function arbiterKeyLabel(code: number): string | null {
  if (code === 0) return null;
  const named = NAMED[code];
  if (named !== undefined) return named;
  if (code >= 65 && code <= 90) return String.fromCharCode(code);
  if (code >= 48 && code <= 57) return String(code - 48);
  if (code >= 112 && code <= 123) return `F${code - 111}`;
  return null;
}

/** Categories offered when rebinding a key, each a list of key codes. */
export const ARBITER_KEY_CHOICES: Readonly<Record<ArbiterKeyCategory, readonly number[]>> = {
  letters: Array.from({ length: 26 }, (_, i) => 65 + i),
  numbers: Array.from({ length: 10 }, (_, i) => 48 + i),
  function: Array.from({ length: 12 }, (_, i) => 112 + i),
  punctuation: [189, 187, 219, 221, 220, 186, 222, 188, 190, 191, 192, 226],
  navigation: [27, 9, 8, 13, 32, 20, 45, 46, 36, 35, 33, 34, 37, 38, 39, 40, 44, 42],
  modifiers: [160, 161, 162, 163, 164, 165, 91],
  media: [177, 179, 176, 173, 174, 175],
  special: [ARBITER_KEY_CODE.fn, ARBITER_KEY_CODE.superTap],
};

export const ARBITER_KEY_CATEGORIES = Object.keys(ARBITER_KEY_CHOICES) as ArbiterKeyCategory[];

/** The category a code is offered under, or null for a code outside every list. */
export function arbiterKeyCategory(code: number): ArbiterKeyCategory | null {
  return ARBITER_KEY_CATEGORIES.find((category) => ARBITER_KEY_CHOICES[category].includes(code)) ?? null;
}

/** The vendor's effect names, with the underscores of their identifiers read as spaces. */
export function arbiterEffectLabel(effect: number): string {
  return (ARBITER_LIGHT_EFFECTS[effect] ?? `Effect ${effect}`).replaceAll("_", " ");
}

export function arbiterRgbToHex(color: { red: number; green: number; blue: number }): string {
  return `#${[color.red, color.green, color.blue].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function arbiterHexToRgb(hex: string): { red: number; green: number; blue: number } {
  const value = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return { red: (value >> 16) & 255, green: (value >> 8) & 255, blue: value & 255 };
}
