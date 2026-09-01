const SPECIAL_HID_KEYS: Readonly<Record<string, number>> = {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
  Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30,
  Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
  Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
  PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49,
  Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
  ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
};

export function hidKeyForCode(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return 0x04 + code.charCodeAt(3) - 65;
  if (/^Digit[1-9]$/.test(code)) return 0x1e + Number(code[5]) - 1;
  if (code === "Digit0") return 0x27;
  const functionKey = code.match(/^F([1-9]|1[0-2])$/);
  if (functionKey) return 0x3a + Number(functionKey[1]) - 1;
  return SPECIAL_HID_KEYS[code] ?? null;
}

export function shortcutLabel(event: KeyboardEvent): string {
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const isModifier = ["Control", "Shift", "Alt", "Meta"].includes(key);
  return [event.ctrlKey ? "Ctrl" : null, event.shiftKey ? "Shift" : null, event.altKey ? "Alt" : null,
    event.metaKey ? "Meta" : null, isModifier ? null : key]
    .filter(Boolean).join(" + ");
}
