import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as local from "./local-applications.ts";

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const plain = (value: any) => JSON.parse(JSON.stringify(value));
function harness(application?: any, transform: (value: any[]) => any[] = (value) => value) {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let tree: any;
  let stored = application ? [application] : [];
  const writes: any[][] = [];
  const saved: any[][] = [];
  let processCalls = 0;
  const react = {
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useState(initial: unknown) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, (value: any) => { slots[i].value = value; }]; },
    useEffect(effect: () => any, deps: unknown[] = []) { const i = cursor++; if (slots[i]) return; effects.push(() => { slots[i] = { cleanup: effect() }; }); },
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL("./LocalApplicationDialog.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type: any, props: any) => { if (type === "dialog") props.ref.current = { showModal() {}, close() {} }; return { type, props }; };
  vm.runInNewContext(code, { exports, crypto: { randomUUID: () => "id" }, document: { activeElement: null }, HTMLElement: class {}, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.endsWith("/bridge")) return { bridgeLocalApplications: async () => plain(stored), saveBridgeLocalApplications: async (value: any[]) => { writes.push(plain(value)); stored = transform(plain(value)); }, bridgeRunningApplications: async () => { processCalls++; return []; }, BridgeHttpError: class extends Error {} };
    if (name.endsWith("local-applications")) return local;
    if (name.endsWith("i18n/index")) return { t: (_: unknown, key: string) => key, tp: (_: unknown, key: string) => key };
    throw new Error(name);
  } });
  function render() { cursor = 0; effects = []; tree = exports.LocalApplicationDialog({ locale: "en", application, active: true, onClose() {}, onSaved: (...args: any[]) => saved.push(args) }); effects.forEach((effect) => effect()); }
  function nodes(node: any): any[] { if (!node || typeof node !== "object") return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
  render();
  return { render, writes, saved, processCalls: () => processCalls, nodes: () => nodes(tree), input(id: string, value: string) { nodes(tree).find((node) => node.props?.id === id).props.onChange({ currentTarget: { value } }); render(); }, choose(value: string) { nodes(tree).find((node) => node.props?.role === "radio" && node.props.children === value).props.onClick(); render(); }, async submit() { nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle(); render(); }, unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}

test("legacy app edits show focused activation independently of category and allow explicit conversion", async () => {
  const application = { id: "local:old", name: "Editor", executable: "editor", path: "/usr/bin/editor", kind: "app" };
  const h = harness(application);
  assert.equal(h.nodes().find((node) => node.props?.role === "radio" && node.props.children === "localApps.focused").props["aria-checked"], true);
  h.choose("localApps.game"); await h.submit(); assert.equal(h.writes[0][0].activation, "focused");
  h.choose("localApps.running"); await h.submit(); assert.equal(h.writes[1][0].activation, "running");
  assert.equal(h.writes[1][0].id, application.id);
});

test("manual form requires a full path and rejects unsupported launchers", async () => {
  for (const path of ["editor.exe", "/usr/share/applications/editor.desktop", "/opt/editor.AppImage", "/bin/editor.sh", "C:/editor.cmd"]) {
    const h = harness(); h.input("local-app-name", "Editor"); h.input("local-app-target", path); await h.submit(); assert.equal(h.writes.length, 0, path);
  }
});

test("bundle selection accepts canonical executable metadata and reopens the bundle path", async () => {
  const canonical = { id: "local:id", name: "Editor", kind: "app", activation: "running", executable: "Editor", path: "/Applications/Editor.app/Contents/MacOS/Editor", bundlePath: "/Applications/Editor.app", bundleIdentifier: "org.editor" };
  const h = harness(undefined, (value) => value.map((entry) => ({ ...entry, ...canonical })));
  h.input("local-app-name", "Editor"); h.input("local-app-target", canonical.bundlePath); h.choose("localApps.app"); await h.submit();
  assert.equal(h.saved.length, 1); assert.deepEqual(h.saved[0][1], canonical);
  const edit = harness(canonical); assert.equal(edit.nodes().find((node) => node.props?.id === "local-app-target").props.value, canonical.bundlePath);
});

test("old Bridge dropping activation is reported as requiring an update, not a saved target", async () => {
  const h = harness(undefined, (value) => value.map(({ activation, ...entry }) => entry));
  h.input("local-app-name", "Editor"); h.input("local-app-target", "/usr/bin/editor"); h.choose("localApps.app"); await h.submit();
  assert.equal(h.saved.length, 0); assert.equal(h.nodes().some((node) => node.props?.role === "alert" && node.props.children === "localApps.updateBridge"), true);
});

test("bundle metadata cannot grant a canonical path outside the selected bundle", async () => {
  for (const path of ["/other/Editor", "/Applications/Editor.app/../other/Editor", "/Applications/Editor.app2/Editor", "/Applications/Editor.app"]) {
    const h = harness(undefined, (value) => value.map((entry) => ({ ...entry, path, executable: path.split("/").pop(), bundlePath: "/Applications/Editor.app" })));
    h.input("local-app-name", "Editor"); h.input("local-app-target", "/Applications/Editor.app"); await h.submit(); assert.equal(h.saved.length, 0, path);
  }
});

test("closing before the initial read completes cannot mutate a closed form's target", async () => {
  const h = harness(); h.input("local-app-name", "Editor"); h.input("local-app-target", "/usr/bin/editor");
  const pending = h.submit(); h.unmount(); await pending; assert.equal(h.writes.length, 0); assert.equal(h.saved.length, 0);
});

test("late write response cannot call a closed form's completion callback", async () => {
  const h = harness(undefined, (value) => { h.unmount(); return value; });
  h.input("local-app-name", "Editor"); h.input("local-app-target", "/usr/bin/editor"); await h.submit(); assert.equal(h.writes.length, 1); assert.equal(h.saved.length, 0);
});

test("manual full-path app creation explicitly requests running activation without a process chooser", async () => {
  const h = harness(); h.input("local-app-name", "Editor"); h.input("local-app-target", "/usr/bin/editor"); h.choose("localApps.app"); await h.submit();
  assert.equal(h.writes[0][0].activation, "running"); assert.equal(h.saved.length, 1);
  assert.equal(h.nodes().some((node) => node.props?.children === "localApps.pick"), false); assert.equal(h.processCalls(), 0);
});
