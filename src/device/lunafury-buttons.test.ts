import assert from "node:assert/strict";
import test from "node:test";
import { LUNAFURY_BUTTON_ACTIONS, LUNAFURY_BUTTON_IDS } from "@openmouse/protocol/lamzu";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { ensureLocale, t } from "../i18n.ts";
import { LOCALES } from "../interface-preferences.ts";
import { LUNAFURY_KEY_CHOICES, canEditLunaFuryMapping, lunaFuryKeyAction, lunaFuryKeyboardLabel,
  lunaFuryMappingLabel, pickLunaFuryMappings } from "./lunafury-buttons.ts";

const status = { brand: "LunaFury", buttonMappings: { Left: "Left Click", Right: "Right Click", Middle: "Keyboard:32:4",
  Back: "Back", Forward: "Macro:16:1" }, fixedButtons: ["Left", "Forward"] } as MouseStatus;

test("LunaFury profile imports cannot target protected, unreadable or unknown assignments", () => {
  assert.deepEqual(pickLunaFuryMappings(status, { Left: "Disabled", Right: "Keyboard:129:4", Middle: "Disabled",
    Back: "Unknown:255:", Forward: "DPI Up", Receiver: "Back" }), { Right: "Keyboard:129:4", Middle: "Disabled" });
  assert.deepEqual(pickLunaFuryMappings(status, { Right: "Mute", Middle: "Disabled" }, true),
    { Right: "Right Click", Middle: "Keyboard:32:4" });
  for (const raw of [null, [], "Right", 2, { Right: 4 }, JSON.parse('{"__proto__":"Mute"}')]) {
    assert.deepEqual(pickLunaFuryMappings(status, raw), {});
  }
  assert.equal(canEditLunaFuryMapping({ ...status, brand: "Lamzu" }, "Right", "Mute"), false);
  assert.equal(canEditLunaFuryMapping({ ...status, buttonMappings: {} }, "Right", "Mute"), false);
});

test("removed extension actions cannot be imported as button assignments", () => {
  for (const action of ["Left Double Click", "Browser Refresh", "Open Browser"]) {
    assert.equal(canEditLunaFuryMapping(status, "Back", action), false);
    assert.deepEqual(pickLunaFuryMappings(status, { Back: action }), {});
  }
});

test("physical keyboard codes and left/right modifiers are preserved", () => {
  assert.equal(lunaFuryKeyAction("KeyC", 1), "Keyboard:1:6");
  assert.equal(lunaFuryKeyAction("NumpadEnter", 128), "Keyboard:128:88");
  assert.equal(lunaFuryKeyAction("Tab", 0), "Keyboard:0:43");
  assert.equal(lunaFuryKeyAction("MetaLeft", 0), undefined);
  assert.equal(lunaFuryKeyAction("Unidentified", 0), undefined);
  assert.equal(lunaFuryKeyAction("__proto__", 0), undefined);
  assert.equal(lunaFuryKeyboardLabel("Keyboard:129:4"), "Ctrl L + Win R + A");
  assert.equal(lunaFuryKeyboardLabel("Keyboard:32:40"), "Shift R + Enter");
  assert.equal(lunaFuryKeyboardLabel("Unknown:255:"), undefined);
  for (const key of LUNAFURY_KEY_CHOICES) assert.ok(lunaFuryKeyAction(key.code, 255));
});

test("every locale labels the complete physical-button and action vocabularies", async () => {
  for (const { code: locale } of LOCALES) {
    await ensureLocale(locale);
    assert.equal(t(locale, "luna.physicalButtons").split("|").length, Object.keys(LUNAFURY_BUTTON_IDS).length);
    assert.equal(t(locale, "luna.buttonActions").split("|").length, LUNAFURY_BUTTON_ACTIONS.length);
    for (const action of LUNAFURY_BUTTON_ACTIONS) assert.ok(lunaFuryMappingLabel(locale, action));
    for (const action of ["Macro:16:1", "Macro:17:1", "Unknown:255:"]) {
      assert.equal(lunaFuryMappingLabel(locale, action), action);
    }
    assert.equal(lunaFuryMappingLabel(locale, "Keyboard:129:4"), "Ctrl L + Win R + A");
  }
  assert.equal(lunaFuryMappingLabel("zh", "Right", true), "右键");
  assert.equal(lunaFuryMappingLabel("zh", "DPI Cycle"), "循环切换 DPI");
});
