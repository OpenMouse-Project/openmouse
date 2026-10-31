import assert from "node:assert/strict";
import test from "node:test";
import { MCHOSE_ACE68_LAYOUT, MCHOSE_PRODUCTS, decodeMchoseDks, decodeMchoseKeyTravel } from "@openmouse/keyboard-protocol/mchose";
import type { MchoseWorkspace } from "./mchose-workspace.ts";
import { mchoseKeymapChanges, mchoseProfileFile, mchoseProfileFileName, mchoseTravelRestore, parseMchoseProfileFile } from "./mchose-profile-file.ts";

const none = { type: 0, code1: 0, code2: 0 };
const workspace = (): MchoseWorkspace => ({
  product: MCHOSE_PRODUCTS[0]!,
  info: { firmwareVersion: "116", buildDate: "", chip: "" },
  profile: 1,
  profileCount: 3,
  profileNames: [null, "Games", null],
  layout: MCHOSE_ACE68_LAYOUT,
  performance: null,
  settings: {
    macMode: false, lockWin: false, lockAltTab: false, lockAltF4: false, scanRateRaw: 0, tachyonMode: false,
    bottomRapidTrigger: true, travelCheck: true, debounce: false, rtSmart: 5, sleepTime: 12, sleepEnabled: true,
  },
  lighting: {
    main: { effect: 6, brightness: 80, speed: 2, direction: 0, rainbow: true, color: { r: 0, g: 200, b: 160 } },
    side: { effect: 2, brightness: 100, speed: 2, rainbow: false, color: { r: 255, g: 255, b: 255 } },
  },
  travel: Array.from({ length: 128 }, () => decodeMchoseKeyTravel([0xa0, 0x01, 0x1e, 0x00, 0x09, 0x1e, 0x0c, 0x1e])),
  keymap: Array.from({ length: 4 }, () => Array.from({ length: 128 }, () => ({ ...none }))),
  defaults: [],
  advanced: {
    dks: Array.from({ length: 32 }, () => decodeMchoseDks(new Array(24).fill(0))),
    modTap: Array.from({ length: 32 }, () => ({ tap: { ...none }, hold: { ...none } })),
    toggle: Array.from({ length: 32 }, () => ({ ...none })),
  },
  macros: null,
  colors: Array.from({ length: 128 }, () => ({ r: 1, g: 2, b: 3 })),
});

test("a saved profile reads back for the same keyboard only", () => {
  const file = mchoseProfileFile(workspace())!;
  assert.equal(file.name, "Games");
  assert.equal(mchoseProfileFileName(file, "Profile 2"), "ace-68-air-iii-games.json");
  const text = JSON.stringify(file);
  assert.deepEqual(parseMchoseProfileFile(text, file.productId), file);
  assert.throws(() => parseMchoseProfileFile(text, 0x1234), { message: "other-product" });
  assert.throws(() => parseMchoseProfileFile("{}", file.productId), { message: "not-profile" });
  assert.throws(() => parseMchoseProfileFile("not json", file.productId), { message: "not-profile" });
  assert.throws(() => parseMchoseProfileFile(JSON.stringify({ ...file, travel: [] }), file.productId), { message: "not-profile" });
  assert.equal(mchoseProfileFile({ ...workspace(), settings: null }), null, "nothing to save before the profile is read");
});

test("restoring writes only what differs and every travel field", () => {
  const current = workspace().keymap;
  const target = current.map((layer) => layer.map((action) => ({ ...action })));
  target[2]![5] = { type: 0x10, code1: 1, code2: 6 };
  assert.deepEqual(mchoseKeymapChanges(current, target), [[], [], [{ index: 5, action: { type: 0x10, code1: 1, code2: 6 } }], []]);
  const key = workspace().travel[0]!;
  assert.deepEqual(mchoseTravelRestore(7, key), {
    index: 7, pressPrecision: key.pressPrecision, releasePrecision: key.releasePrecision, actuation: key.actuation, rapidTrigger: key.keyMode === 1,
    rapidTriggerPress: key.rapidTriggerPress, rapidTriggerRelease: key.rapidTriggerRelease, pressDeadzone: key.pressDeadzone,
    releaseDeadzone: key.releaseDeadzone, switchType: key.switchType, priority: key.priority,
  });
});

test("only complete profiles are saved, and damaged entries are refused before writing", () => {
  const short = workspace();
  assert.equal(mchoseProfileFile({ ...short, travel: short.travel.slice(0, 64) }), null);
  assert.equal(mchoseProfileFile({ ...short, keymap: short.keymap.map((layer) => layer.slice(0, 64)) }), null);
  const file = mchoseProfileFile(workspace())!;
  const damaged = (patch: (copy: any) => void): string => { const copy = JSON.parse(JSON.stringify(file)); patch(copy); return JSON.stringify(copy); };
  assert.throws(() => parseMchoseProfileFile(damaged((copy) => { copy.keymap[1][3] = null; }), file.productId), { message: "not-profile" });
  assert.throws(() => parseMchoseProfileFile(damaged((copy) => { copy.keymap[0][0] = { type: "16", code1: 0, code2: 4 }; }), file.productId), { message: "not-profile" });
  assert.throws(() => parseMchoseProfileFile(damaged((copy) => { copy.travel[7] = null; }), file.productId), { message: "not-profile" });
  assert.throws(() => parseMchoseProfileFile(damaged((copy) => { copy.colors[2] = null; }), file.productId), { message: "not-profile" });
  assert.throws(() => parseMchoseProfileFile(damaged((copy) => { copy.travel[7] = {}; }), file.productId), { message: "not-profile" });
  assert.throws(() => parseMchoseProfileFile(damaged((copy) => { copy.keymap[0][5] = { type: 0x90, code1: 2, code2: 0 }; copy.advanced.dks[2] = null; }), file.productId), { message: "not-profile" });
  assert.equal(parseMchoseProfileFile(damaged((copy) => { copy.advanced.dks[2] = null; }), file.productId).advanced.dks[2], null, "an empty slot nothing points at is fine");
  assert.equal(mchoseProfileFile({ ...workspace(), advanced: { ...workspace().advanced!, dks: [] } }), null, "advanced tables must be complete to save");
});
