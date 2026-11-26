import { wootingMatrixKeyId } from "@openmouse/keyboard-protocol/wooting";

/**
 * 60% ANSI keycap layout for the Wooting map. Widths are in quarter units
 * (4 = 1u), so every row sums to 60. `id` is the key id used by
 * `wootingMatrixKeyId`; `usage` is the HID keyboard usage the analog snapshot
 * reports (Fn has none, so it never shows travel).
 */
export interface WootingKeycap {
  id: string;
  label: string;
  width: number;
  usage: number | null;
}

const k = (id: string, label: string, usage: number | null, width = 4): WootingKeycap => ({ id, label, width, usage });
const letters = (ids: string): WootingKeycap[] => [...ids].map((c) => k(c, c.toUpperCase(), c.charCodeAt(0) - 93));

export const WOOTING_60_LAYOUT: readonly (readonly WootingKeycap[])[] = [
  [k("esc", "Esc", 0x29), k("1", "1", 0x1e), k("2", "2", 0x1f), k("3", "3", 0x20), k("4", "4", 0x21), k("5", "5", 0x22),
    k("6", "6", 0x23), k("7", "7", 0x24), k("8", "8", 0x25), k("9", "9", 0x26), k("0", "0", 0x27),
    k("minus", "-", 0x2d), k("equal", "=", 0x2e), k("backspace", "Backspace", 0x2a, 8)],
  [k("tab", "Tab", 0x2b, 6), ...letters("qwertyuiop"), k("lbracket", "[", 0x2f), k("rbracket", "]", 0x30), k("backslash", "\\", 0x31, 6)],
  [k("caps", "Caps", 0x39, 7), ...letters("asdfghjkl"), k("semicolon", ";", 0x33), k("quote", "'", 0x34), k("enter", "Enter", 0x28, 9)],
  [k("lshift", "L-Shift", 0xe1, 9), ...letters("zxcvbnm"), k("comma", ",", 0x36), k("period", ".", 0x37), k("slash", "/", 0x38), k("rshift", "R-Shift", 0xe5, 11)],
  [k("lctrl", "Ctrl", 0xe0, 5), k("lwin", "Win", 0xe3, 5), k("lalt", "Alt", 0xe2, 5), k("space", "Space", 0x2c, 25),
    k("ralt", "Alt", 0xe6, 5), k("menu", "Menu", 0x65, 5), k("rctrl", "Ctrl", 0xe4, 5), k("fn1", "Fn 1", null, 5)],
];

/**
 * Firmware matrix index (`row << 5 | col`) for each key id. A key id that the
 * driver's table places at more than one position is ambiguous, so it maps to
 * null and the UI never writes to it.
 */
export const WOOTING_KEY_MATRIX_INDEX: ReadonlyMap<string, number | null> = (() => {
  const found = new Map<string, number | null>();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 31; col++) {
      const id = wootingMatrixKeyId(row, col);
      if (id) found.set(id, found.has(id) ? null : (row << 5) | col);
    }
  }
  return found;
})();
