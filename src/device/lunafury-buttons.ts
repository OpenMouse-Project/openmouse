import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { LUNAFURY_BUTTON_ACTIONS, LUNAFURY_BUTTON_IDS, lunafuryButtonActionWritable,
  lunafuryIsMappedButton, lunafuryKeyboardAction, lunafuryParseKeyboardAction } from "@openmouse/protocol/lamzu";
import { t } from "../i18n.ts";
import type { InterfaceLocale } from "../interface-preferences.ts";

export function canEditLunaFuryMapping(status: MouseStatus, button: string, action: string): boolean {
  const current = status.buttonMappings?.[button];
  return status.brand === "LunaFury" && lunafuryIsMappedButton(button) && button !== "Left"
    && !status.fixedButtons?.includes(button) && typeof current === "string"
    && lunafuryButtonActionWritable(current) && lunafuryButtonActionWritable(action);
}

/** Only already-readable, supported assignments can be applied and restored. */
export function pickLunaFuryMappings(status: MouseStatus, raw: unknown, prior = false): Record<string, string> {
  const picked: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return picked;
  for (const [button, action] of Object.entries(raw)) {
    if (typeof action === "string" && canEditLunaFuryMapping(status, button, action)) {
      picked[button] = prior ? status.buttonMappings![button] : action;
    }
  }
  return picked;
}

export const LUNAFURY_MODIFIERS = ["Ctrl L", "Shift L", "Alt L", "Win L", "Ctrl R", "Shift R", "Alt R", "Win R"] as const;

// KeyboardEvent.code -> USB HID usage. The physical key, not the text produced
// by the current keyboard layout, determines a saved mouse assignment.
const KEY_CODES: Record<string, number> = {};
for (let index = 0; index < 26; index++) KEY_CODES[`Key${String.fromCharCode(65 + index)}`] = 4 + index;
for (let index = 1; index <= 9; index++) KEY_CODES[`Digit${index}`] = 29 + index;
KEY_CODES.Digit0 = 39;
for (let index = 1; index <= 12; index++) KEY_CODES[`F${index}`] = 57 + index;
Object.assign(KEY_CODES, { Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44,
  Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49, Semicolon: 51,
  Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75,
  Delete: 76, End: 77, PageDown: 78, ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
  NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86, NumpadAdd: 87,
  NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, ControlRight: 228, ShiftRight: 229, AltRight: 230 });
for (let index = 1; index <= 9; index++) KEY_CODES[`Numpad${index}`] = 88 + index;

export const LUNAFURY_KEY_CHOICES = Object.entries(KEY_CODES).map(([code, usage]) => ({ code, usage }));
export const LUNAFURY_MODIFIER_CODES: Readonly<Record<string, number>> = {
  ControlLeft: 1, ShiftLeft: 2, AltLeft: 4, MetaLeft: 8,
  ControlRight: 16, ShiftRight: 32, AltRight: 64, MetaRight: 128,
};

export function lunaFuryKeyAction(code: string, modifiers: number): string | undefined {
  return Object.hasOwn(KEY_CODES, code) ? lunafuryKeyboardAction(modifiers, KEY_CODES[code]) : undefined;
}

export function lunaFuryKeyboardLabel(action: string): string | undefined {
  const key = lunafuryParseKeyboardAction(action);
  if (!key) return undefined;
  const name = LUNAFURY_KEY_CHOICES.find((choice) => choice.usage === key.usage)?.code ?? String(key.usage);
  return [...LUNAFURY_MODIFIERS.filter((_, bit) => key.modifiers & (1 << bit)), name.replace(/^Key|^Digit/, "")].join(" + ");
}

export function lunaFuryMappingLabel(locale: InterfaceLocale, value: string, physical = false): string {
  // These two fixed-order vocabularies share the codec's order. Tests check every locale.
  const names = physical ? Object.keys(LUNAFURY_BUTTON_IDS) : LUNAFURY_BUTTON_ACTIONS;
  const index = names.indexOf(value);
  if (index >= 0) return t(locale, physical ? "luna.physicalButtons" : "luna.buttonActions").split("|")[index] ?? value;
  return lunaFuryKeyboardLabel(value) ?? t(locale, "prof.customPreserved");
}
