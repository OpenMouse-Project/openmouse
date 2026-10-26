import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as snapshots from "../../device/game-profile-snapshot.ts";
import * as local from "./local-applications.ts";

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function harness(initialProfiles?: any[], gameMetadata: object = {}) {
  let owner: object = {};
  let selected = 0;
  let draft: snapshots.GameProfileSnapshot | null = null;
  let profiles: any[] = initialProfiles ?? [800, 1600].map((dpi, i) => ({ application: { name: "Test", localId: "local:test", executable: "test.exe", path: "C:/test.exe" }, device: { id: `Fake:${i ? "B" : "A"}`, name: i ? "B" : "A" }, enabled: i === 1, settings: { dpi, snapshot: { dpi }, pollingRateHz: null } }));
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let tree: any;
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const requests: { profiles: any[]; resolve: () => void; reject: () => void }[] = [];
  let delayed = false;
  let ignoreWrites = false;
  const toasts: unknown[][] = [];
  const react = {
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useState(initial: unknown) { const i = cursor++; const state = slots[i] ??= { value: initial }; return [state.value, (value: any) => { state.value = typeof value === "function" ? value(state.value) : value; }]; },
    useEffect(effect: () => any, deps: unknown[] = []) {
      const i = cursor++; const prior = slots[i];
      if (prior && deps.length === prior.deps.length && deps.every((value, j) => Object.is(value, prior.deps[j]))) return;
      effects.push(() => { prior?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    },
  };
  const control = {
    getGameProfileOwner: () => owner,
    beginGameProfileDraft(value: any) { draft = plain(value); return true; },
    endGameProfileDraft(target = owner) { if (target === owner) draft = null; },
    resetGameProfileDraft(value: any) { draft = plain(value); },
    gameProfileDraftSnapshot: () => draft,
    selectAuthorizedDevice(index: number) { selected = index; owner = {}; draft = null; },
    pushToast: (...args: unknown[]) => toasts.push(args),
    hasGameProfileApplyToRestore: () => false,
    restoreGameProfileApply: async () => {},
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL("./GameProfilePanel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id: number) => timers.delete(id), require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
    if (name.endsWith("controller")) return control;
    if (name.endsWith("game-profile-snapshot")) return snapshots;
    if (name.endsWith("/bridge")) return { bridgeProfiles: async () => plain(profiles), saveBridgeProfiles: async (next: any[]) => { if (delayed) await new Promise<void>((resolve, reject) => requests.push({ profiles: plain(next), resolve: () => { profiles = plain(next); resolve(); }, reject: () => reject(new Error("offline")) })); else { if (!ignoreWrites) profiles = plain(next); requests.push({ profiles: plain(next), resolve() {}, reject() {} }); } } };
    if (name.endsWith("bridge-hid")) return { subscribeBridgeHidActive: () => () => {} };
    if (name.endsWith("local-applications")) return local;
    if (name.endsWith("useBridgeProfileApplier")) return { profileTarget: (profile: any) => profile.settings.snapshot };
    if (name.endsWith("workspace-tabs")) return { availableWorkspaceTabs: () => [] };
    if (name.endsWith("availability")) return { cardAvailability: () => ({}) };
    if (name.endsWith("i18n/index")) return { t: (_: unknown, key: string) => key, tp: (_: unknown, key: string) => key, displayText: (_: unknown, text: string) => text };
    return {};
  } });
  function render() {
    cursor = 0; effects = [];
    tree = exports.GameProfilePanel({ snapshot: { devices: ["A", "B"].map((name, index) => ({ selected: selected === index, index, name, detail: "Fake" })), preferences: { locale: "en" }, deviceStatus: { name: selected ? "B" : "A" }, settingInProgress: false, gameProfileDraft: draft !== null, pending: { keys: [] } }, game: { id: "local:test", source: "local", name: "Test", executables: ["test.exe"], ...gameMetadata }, onBack() {} });
    effects.forEach((effect) => effect());
  }
  function nodes(node: any): any[] { if (!node || typeof node !== "object") return []; if (Array.isArray(node)) return node.flatMap((entry) => nodes(entry)); return [node, ...nodes(node.props?.children)]; }
  return { render, hasText(text: string) { return nodes(tree).some((node) => node.props?.children === text); }, async ready() { render(); await settle(); render(); render(); }, select(index: number) { nodes(tree).filter((node) => node.type === "button" && node.props.className?.includes("game-profile-select"))[index].props.onClick(); }, toggle() { nodes(tree).find((node) => node.props?.role === "switch").props.onClick(); }, clear() { nodes(tree).find((node) => node.props?.className?.includes("game-profile-clear")).props.onClick(); }, retry() { nodes(tree).find((node) => node.props?.className?.includes("game-profile-retry")).props.onClick(); }, enabled: () => nodes(tree).find((node) => node.props?.role === "switch").props["aria-checked"], edit(dpi: number) { draft = { dpi }; render(); }, tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); }, requests, profiles: () => plain(profiles), draft: () => plain(draft), ignoreWrites(value: boolean) { ignoreWrites = value; }, delay() { delayed = true; }, toasts, changeOwnerBeforeRender() { owner = {}; draft = null; }, newSession() { owner = {}; draft = null; render(); render(); }, remount() { slots.length = 0; draft = null; render(); }, unmount() { slots.forEach((slot) => slot?.cleanup?.()); } };
}

test("switch mid-debounce flushes only A and old completion cannot change B or a later A session", async () => {
  const h = harness(); await h.ready(); h.delay();
  h.edit(900); h.select(1); h.render(); h.render(); await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].profiles.find((entry) => entry.device.name === "A").settings.dpi, 900);
  assert.deepEqual(h.draft(), { dpi: 1600 });
  h.requests[0].resolve(); await settle(); h.render();
  h.select(0); h.render(); h.render();
  assert.deepEqual(h.draft(), { dpi: 900 });
  h.newSession(); assert.deepEqual(h.draft(), { dpi: 900 });
});

test("autosave, toggle and clear are serialized and stale debounce cannot undo clear", async () => {
  const h = harness(); await h.ready(); h.delay();
  h.edit(900); h.tick(); await settle();
  h.edit(1000); h.toggle(); h.render(); h.clear(); h.render(); h.tick(); await settle();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(); await settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].profiles.find((entry) => entry.device.name === "A").settings.dpi, 1000);
  assert.equal(h.requests[1].profiles.find((entry) => entry.device.name === "A").enabled, true);
  h.requests[1].resolve(); await settle();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].profiles.some((entry) => entry.device.name === "A"), false);
  assert.equal(h.requests[2].profiles.find((entry) => entry.device.name === "B").settings.dpi, 1600);
  h.requests[2].resolve(); await settle(); h.render(); h.tick(); await settle();
  assert.equal(h.requests.length, 3); assert.deepEqual(h.draft(), {}); assert.equal(h.enabled(), false);
});

test("failed autosave keeps draft and offers an explicit successful retry", async () => {
  const h = harness(); await h.ready(); h.delay();
  h.edit(900); h.tick(); await settle(); h.requests[0].reject(); await settle(); h.render();
  assert.deepEqual(h.draft(), { dpi: 900 }); assert.equal(h.profiles()[0].settings.dpi, 800);
  assert.equal(h.toasts.some((entry) => entry[0] === "error"), true);
  h.retry(); await settle(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(); await settle(); h.render(); h.tick(); await settle();
  assert.equal(h.profiles().find((entry: any) => entry.device.name === "A").settings.dpi, 900);
  assert.equal(h.requests.length, 2);
});

test("unmount flushes a pending edit once", async () => {
  const h = harness(); await h.ready(); h.edit(900); h.unmount(); await settle(); h.tick(); await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.profiles().find((entry: any) => entry.device.name === "A").settings.dpi, 900);
});

test("same-model session ownership is checked before a delayed dispatch, even before render", async () => {
  const h = harness(); await h.ready(); h.edit(900); h.changeOwnerBeforeRender(); h.tick(); await settle();
  assert.equal(h.requests.length, 0);
  h.render(); h.render(); assert.deepEqual(h.draft(), { dpi: 800 });
});

test("old A completion cannot acknowledge B edits and B saves read the completed A write", async () => {
  const h = harness(); await h.ready(); h.delay(); h.edit(900); h.tick(); await settle();
  h.select(1); h.render(); h.render(); h.edit(1700); h.tick(); await settle();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(); await settle(); h.render();
  assert.deepEqual(h.draft(), { dpi: 1700 }); assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].profiles.find((entry) => entry.device.name === "A").settings.dpi, 900);
  assert.equal(h.requests[1].profiles.find((entry) => entry.device.name === "B").settings.dpi, 1700);
  h.requests[1].resolve(); await settle(); h.render(); h.tick(); await settle(); assert.equal(h.requests.length, 2);
});

test("a disconnected stored target cannot donate its settings to the selected mouse", async () => {
  const h = harness([{ application: { localId: "local:test" }, device: { id: "Fake:Absent", name: "Absent" }, enabled: true, settings: { dpi: 6400, snapshot: { dpi: 6400 } } }]);
  await h.ready(); assert.deepEqual(h.draft(), {}); assert.equal(h.enabled(), false); h.tick(); await settle(); assert.equal(h.requests.length, 0);
});

test("reopening a panel waits for its previous queued write before loading saved values", async () => {
  const h = harness(); await h.ready(); h.delay(); h.edit(900); h.tick(); await settle();
  h.unmount(); h.remount(); await settle(); h.render(); h.render(); assert.equal(h.draft(), null);
  h.requests[0].resolve(); await settle(); h.render(); h.render(); assert.deepEqual(h.draft(), { dpi: 900 });
});

test("a fulfilled but unacknowledged profile save is not committed and stays retryable", async () => {
  const h = harness(); await h.ready(); h.ignoreWrites(true); h.edit(900); h.tick(); await settle(); h.render();
  assert.equal(h.toasts.some((entry) => entry[0] === "error"), true); assert.deepEqual(h.draft(), { dpi: 900 });
  h.ignoreWrites(false); h.retry(); await settle(); h.render(); assert.equal(h.requests.length, 2);
  assert.equal(h.profiles().find((entry: any) => entry.device.name === "A").settings.dpi, 900);
});

test("legacy focused panels explain unsupported focus without relabeling running apps", async () => {
  const focused = harness(undefined, { kind: "app" }); await focused.ready(); assert.equal(focused.hasText("localApps.focusedLimit"), true);
  const running = harness(undefined, { kind: "app", activation: "running" }); await running.ready(); assert.equal(running.hasText("localApps.focusedLimit"), false); assert.equal(running.hasText("localApps.gameHint"), true);
});

test("bundle panels display the selected bundle while profile metadata keeps the actual executable", async () => {
  const h = harness(undefined, { path: "/Applications/Editor.app/Contents/MacOS/Editor", bundlePath: "/Applications/Editor.app" });
  await h.ready(); assert.equal(h.hasText("/Applications/Editor.app"), true);
});

test("select B loads B1600 and enabled state without persisting A800 into B", async () => {
  const h = harness(); await h.ready();
  assert.deepEqual(h.draft(), { dpi: 800 }); assert.equal(h.enabled(), false);
  h.select(1); h.render(); h.render(); await settle();
  assert.deepEqual(h.draft(), { dpi: 1600 }); assert.equal(h.enabled(), true);
  assert.equal(h.requests.length, 0); assert.equal(h.profiles()[1].settings.dpi, 1600);
});
