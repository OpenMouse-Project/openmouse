import assert from "node:assert/strict";
import { test } from "node:test";
import { steelseriesRival650EncodeButtonsMapping } from "@openmouse/protocol/steelseries";
import {
  RIVAL650_FACTORY_MAPPING,
  previewRival650Buttons,
  editRival650ButtonDraft,
  mergeRival650ButtonEdits,
  RIVAL650_CUSTOM_ASSIGNMENT,
  rival650ButtonLocked,
  rival650ButtonStatus,
} from "./rival650-buttons.ts";

test("Rival 650 shows live assignments and preserves an existing custom chord on unrelated edits", () => {
  const chord = { type: "raw", bytes: [0x51, 0xe0, 0xe5, 0x06, 0] } as const;
  const status = { name: "Rival 650 Wireless" } as Parameters<typeof rival650ButtonStatus>[0];
  const observed = {
    ...status,
    rival650ButtonMappings: {
      ...RIVAL650_FACTORY_MAPPING,
      button4: { type: "multimedia", code: 0xea } as const,
      button5: chord,
    },
  };
  const { buttonMappings } = rival650ButtonStatus(observed);
  assert.equal(buttonMappings?.button4, "prof.volDown");
  assert.equal(buttonMappings?.button5, RIVAL650_CUSTOM_ASSIGNMENT);
  const edited = mergeRival650ButtonEdits(observed.rival650ButtonMappings,
    { button4: { type: "multimedia", code: 0xe9 } }, "Keep a left click assignment.");
  assert.deepEqual(edited.button5, chord);
});

test("Rival 650 protects a left-click assignment that was moved to another button", () => {
  const mapping = { button1: "adv.rightButton", button2: "adv.leftButton" };
  assert.equal(rival650ButtonLocked("button2", mapping), true);
});

test("Rival 650 preset explicitly assigns all seven buttons", () => {
  assert.deepEqual(RIVAL650_FACTORY_MAPPING, {
    button1: { type: "button", target: "button1" },
    button2: { type: "button", target: "button2" },
    button3: { type: "button", target: "button3" },
    button4: { type: "button", target: "button4" },
    button5: { type: "button", target: "button5" },
    button6: { type: "disabled" },
    button7: { type: "dpiSwitch" },
  });
});

test("Rival 650 side-button assignments preserve all the other fields", () => {
  const draft = editRival650ButtonDraft({ rival650ButtonMappings: RIVAL650_FACTORY_MAPPING } as Parameters<typeof rival650ButtonStatus>[0],
    { kind: "replace", mapping: RIVAL650_FACTORY_MAPPING }, "button4", "prof.volDown");
  assert.ok(draft);
  const next = editRival650ButtonDraft({} as Parameters<typeof rival650ButtonStatus>[0], draft, "button5", "key:PageUp");
  assert.ok(next?.kind === "replace");
  const packet = steelseriesRival650EncodeButtonsMapping(next.mapping);
  assert.deepEqual([...packet], [
    0x19,
    0x01, 0, 0, 0, 0,
    0x02, 0, 0, 0, 0,
    0x03, 0, 0, 0, 0,
    0x61, 0xea, 0, 0, 0,
    0x51, 0x4b, 0, 0, 0,
    0, 0, 0, 0, 0,
    0x30, 0, 0, 0, 0,
  ]);
});

test("Rival 650 editor starts with seven unknown assignments", () => {
  const status = { name: "Rival 650 Wireless" } as Parameters<typeof rival650ButtonStatus>[0];
  const editor = rival650ButtonStatus(status);
  assert.deepEqual(editor.buttonMappings, {
    button1: "", button2: "", button3: "", button4: "", button5: "", button6: "", button7: "",
  });
  assert.equal(status.buttonMappings, undefined);
  assert.equal(editRival650ButtonDraft(status, undefined, "button4", "prof.volUp"), undefined);
});


test("Rival 650 previews edits over the latest successful read", () => {
  const fallback = RIVAL650_FACTORY_MAPPING;
  const draft = editRival650ButtonDraft({ rival650ButtonMappings: fallback } as Parameters<typeof rival650ButtonStatus>[0],
    undefined, "button4", "prof.volUp");
  assert.ok(draft);
  const chord = { type: "raw", bytes: [0x51, 0xe0, 0xe5, 0x06, 0] } as const;
  const fresh = { rival650ButtonMappings: { ...fallback, button5: chord } } as Parameters<typeof rival650ButtonStatus>[0];
  previewRival650Buttons(fresh, draft);
  const editor = rival650ButtonStatus(fresh);
  assert.equal(editor.buttonMappings?.button4, "prof.volUp");
  assert.equal(editor.buttonMappings?.button5, RIVAL650_CUSTOM_ASSIGNMENT);
  const lost = {} as Parameters<typeof rival650ButtonStatus>[0];
  previewRival650Buttons(lost, draft);
  assert.equal(rival650ButtonStatus(lost).buttonMappings?.button4, "prof.volUp");
});

test("Rival 650 reverting the only edit leaves a failed poll unchanged", () => {
  const original = { rival650ButtonMappings: RIVAL650_FACTORY_MAPPING } as Parameters<typeof rival650ButtonStatus>[0];
  const draft = editRival650ButtonDraft(original, undefined, "button4", "prof.volUp");
  assert.ok(draft);
  const missing = {} as Parameters<typeof rival650ButtonStatus>[0];
  const reverted = editRival650ButtonDraft(missing, draft, "button4", "common.back");
  assert.ok(reverted);
  previewRival650Buttons(missing, reverted);
  assert.equal(missing.rival650ButtonMappings, undefined);
});

test("Rival 650 refuses to remove the latest map's only left click", () => {
  const actual = {
    ...RIVAL650_FACTORY_MAPPING, button1: RIVAL650_FACTORY_MAPPING.button2, button4: RIVAL650_FACTORY_MAPPING.button1,
  };
  assert.throws(() => mergeRival650ButtonEdits(actual, { button4: { type: "multimedia", code: 0xe9 } }, "Keep a left click assignment."), /left click/i);
});

test("Rival 650 keeps explicit defaults as a full replacement when adjusting the preset", () => {
  const defaults = { kind: "replace", mapping: RIVAL650_FACTORY_MAPPING } as const;
  const missing = {} as Parameters<typeof rival650ButtonStatus>[0];
  const draft = editRival650ButtonDraft(missing, defaults, "button4", "prof.volUp");
  assert.equal(draft?.kind, "replace");
  assert.deepEqual(draft?.kind === "replace" && draft.mapping.button4, { type: "multimedia", code: 0xe9 });
});
