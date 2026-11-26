import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as snapshots from "../../device/game-profile-snapshot.ts";
import * as targets from "./local-applications.ts";

function panelHarness() {
  let owner: object | null = {};
  let draft: snapshots.GameProfileSnapshot | null = null;
  const opened: { owner: unknown; snapshot: unknown }[] = [];
  const ended: unknown[] = [];
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const react = {
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useState(initial: unknown) { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, (value: unknown) => { slots[index].value = value; }]; },
    useEffect(effect: () => any, deps: unknown[]) {
      const index = cursor++;
      const prior = slots[index];
      if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return;
      effects.push(() => { prior?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
    },
  };
  const control = {
    getGameProfileOwner: () => owner,
    beginGameProfileDraft(snapshot: snapshots.GameProfileSnapshot) { opened.push({ owner, snapshot }); draft = snapshot; return true; },
    endGameProfileDraft(target: unknown) { ended.push(target); },
    gameProfileDraftSnapshot: () => draft,
    hasGameProfileApplyToRestore: () => false,
    restoreGameProfileApply: async () => {},
  };
  const exports: any = {};
  const source = readFileSync(new URL("./GameProfilePanel.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, setTimeout: () => 1, clearTimeout() {}, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    if (name.endsWith("controller")) return control;
    if (name.endsWith("game-profile-snapshot")) return snapshots;
    if (name.endsWith("/bridge")) return { bridgeProfiles: async () => [], saveBridgeProfiles: async () => {} };
    if (name.endsWith("bridge-hid")) return { subscribeBridgeHidActive: () => () => {} };
    if (name.endsWith("local-applications")) return targets;
    if (name.endsWith("workspace-tabs")) return { availableWorkspaceTabs: () => [] };
    if (name.endsWith("availability")) return { cardAvailability: () => ({}) };
    if (name.endsWith("i18n/index")) return { t: (_: unknown, key: string) => key, tp: (_: unknown, key: string) => key, displayText: (_: unknown, text: string) => text };
    return {};
  } });
  function render() {
    cursor = 0; effects = [];
    exports.GameProfilePanel({ snapshot: { devices: [{ selected: true, index: 0, name: "Same model", detail: "Fake" }], preferences: { locale: "en" }, deviceStatus: owner ? { name: "Same model", dpi: 800 } : null, settingInProgress: false, gameProfileDraft: draft !== null, pending: { keys: [] } }, game: { source: "local", name: "Test", executables: ["test.exe"] }, onBack() {} });
    effects.forEach((effect) => effect());
  }
  return { opened, ended, render, owner: () => owner, edit() { draft = { dpi: 3200 }; }, switchDevice() { owner = {}; draft = null; }, unmount() { slots.forEach((slot) => slot?.cleanup?.()); } };
}

test("panel reopens same-name sessions without carrying the prior session's unsaved draft", async () => {
  const h = panelHarness();
  h.render(); for (let i = 0; i < 8; i++) await Promise.resolve(); h.render(); h.edit(); h.render();
  const first = h.owner();
  h.switchDevice(); h.render();
  assert.equal(h.opened.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.opened[1].snapshot)), {});
  assert.equal(h.ended[0], first);
  h.unmount();
  assert.equal(h.ended.at(-1), h.owner());
});
