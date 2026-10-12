import assert from "node:assert/strict";
import test from "node:test";

import { encodeButtonAssignment, LOGITECH_BUTTON_ACTIONS } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import { ALT, COMMAND_SECTIONS, CTRL, META, SHIFT, bindingFromKeyEvent, conflictHints, describeAssignment, isAssigned, keyName, shortcutText, usageForCode } from "./logitech-commands.ts";

const entries = COMMAND_SECTIONS.flatMap((section) => section.entries);

test("every command has a unique id", () => {
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
});

test("every mouse action the profile can store is offered once", () => {
  const offered = entries.flatMap((entry) => (entry.target.kind === "action" ? [entry.target.action] : [])).sort();
  assert.deepEqual(offered, [...LOGITECH_BUTTON_ACTIONS].sort());
});

test("shortcut names read the way G HUB writes them", () => {
  assert.equal(shortcutText(0x06, CTRL), "Ctrl + C");
  assert.equal(shortcutText(0x2b, CTRL | SHIFT), "Ctrl + Shift + Tab");
  assert.equal(shortcutText(0x16, META | SHIFT), "Shift + Win + S");
  assert.equal(shortcutText(0x3d, ALT), "Alt + F4");
  assert.equal(keyName(0x27), "0");
  assert.equal(keyName(0x1e), "1");
  assert.equal(keyName(0x3e), "F5");
  assert.equal(keyName(0xe0), "Key 0xe0");
});

test("every command, written into a profile sector, reads back as that command and no other", () => {
  const blank = new Uint8Array(255).fill(0x00);
  for (const entry of entries) {
    const binding = entry.target.kind === "action" ? entry.target.action : entry.target;
    const written = [...encodeButtonAssignment(blank, 8, "primary", 4, binding)];
    // Button 4's record is the only thing that changed besides the checksum at the end.
    const changed = written.map((byte, index) => (byte !== blank[index] && index < 253 ? index : -1)).filter((index) => index >= 0);
    if (changed.length === 0) continue; // an all-zero record, nothing to compare
    const start = changed[0] - (changed[0] % 4);
    const raw = written.slice(start, start + 4);
    const label = entry.target.kind === "action" ? entry.target.action : "Custom";
    assert.equal(isAssigned(entry, label, raw), true, `${entry.id} is recognised`);
    const mistaken = entries.filter((other) => other.id !== entry.id && isAssigned(other, label, raw));
    assert.deepEqual(mistaken.map((other) => other.id), [], `${entry.id} is not mistaken for another command`);
  }
});

test("a stored keyboard or media assignment is described, and anything else is Custom", () => {
  assert.equal(describeAssignment("Custom", [0x80, 0x02, CTRL, 0x06]), "Ctrl + C");
  assert.equal(describeAssignment("Custom", [0x80, 0x03, 0x00, 233]), "Volume up");
  assert.equal(describeAssignment("Custom", [0x80, 0x03, 0x12, 0x34]), "Media key 4660");
  assert.equal(describeAssignment("Custom", [0x12, 0x34, 0x56, 0x78]), "Custom");
  assert.equal(describeAssignment("Forward", [0x80, 0x01, 0x00, 0x10]), "Forward");
});

test("a recorded key press becomes the HID key and modifiers the profile stores", () => {
  const press = (code: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) =>
    bindingFromKeyEvent({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  assert.deepEqual(press("KeyC", { ctrlKey: true }), { kind: "keyboard", key: 0x06, modifiers: CTRL });
  assert.deepEqual(press("Digit0"), { kind: "keyboard", key: 0x27, modifiers: 0 });
  assert.deepEqual(press("F5"), { kind: "keyboard", key: 0x3e, modifiers: 0 });
  assert.deepEqual(press("Tab", { ctrlKey: true, shiftKey: true }), { kind: "keyboard", key: 0x2b, modifiers: CTRL | SHIFT });
  assert.equal(press("ShiftLeft", { shiftKey: true }), null);
  // Every usage we can record is named the way the card shows it back.
  for (const code of ["KeyA", "KeyZ", "Digit1", "Digit9", "F1", "F12", "ArrowUp", "Delete", "Space"]) {
    assert.ok(!keyName(usageForCode(code)!).startsWith("Key 0x"), code);
  }
});

test("a macro record is described as a macro", () => {
  assert.equal(describeAssignment("Custom", [0x00, 0x04, 0x07, 0x00]), "Macro");
});

test("two buttons doing the same thing are called out, and nothing else is", () => {
  const layout = (...texts: string[]) => ["Primary click", "Secondary click", "Middle click", "Forward", "Back"]
    .map((label, index) => ({ label, text: texts[index] }));
  assert.deepEqual(conflictHints(layout("Left click", "Right click", "Middle click", "Forward", "Back")), []);
  assert.deepEqual(conflictHints(layout("Left click", "Right click", "Middle click", "Back", "Back")), ["Forward and Back both do Back."]);
  assert.deepEqual(conflictHints(layout("Left click", "Right click", "Disabled", "Disabled", "Disabled")), []);
  // A macro, a shortcut or a custom record never produces a hint of its own.
  assert.deepEqual(conflictHints(layout("Left click", "Right click", "Macro", "2-key macro", "Ctrl + C")), []);
});
