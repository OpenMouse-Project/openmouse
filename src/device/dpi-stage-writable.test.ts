import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as pending from "./pending-changes.ts";
import * as snapshots from "./game-profile-snapshot.ts";

function harness() {
  pending.clearPendingChanges();
  const exports: any = {};
  const mocks = new Map();
  const source = readFileSync(new URL("./controller.ts", import.meta.url), "utf8").replaceAll("import.meta.env", "({ DEV: false })") + `
export function testSelect(client) { clearActiveClients(); clearPendingChanges(); active = client; activeDevice = client.device; latestDeviceStatus = { name: "Fixed stages", dpi: 800, dpiStages: [400, 800, 1600], pollingRateHz: 1000, ui: { dpiStageEditor: { maxStages: 3 } } }; dpiOptions = [400, 800, 1200, 1600, 3200]; }
`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localStorage = { getItem: () => null };
  const context = { exports, structuredClone, __BUILD_CHANNEL__: "stable", __BUILD_ID__: "test", __APP_VERSION__: "test", localStorage, window: { localStorage, setTimeout: () => 1, clearTimeout() {} }, setTimeout, clearTimeout, console, require: (name: string) => {
    if (name.endsWith("pending-changes")) return pending;
    if (name.endsWith("game-profile-snapshot")) return snapshots;
    if (name.endsWith("interface-preferences")) return { loadInterfacePreferences: () => ({ locale: "en", reducedMotion: false }) };
    if (name.endsWith("i18n/index")) return { t: (_locale: string, key: string) => key, tp: (_locale: string, key: string) => key };
    if (!mocks.has(name)) mocks.set(name, new Proxy({}, { get: (target: any, key) => target[key] ??= function () {} }));
    return mocks.get(name);
  } };
  vm.runInNewContext(code, context);
  return exports;
}

test("a mouse with fixed DPI stages gets no stage-value write", () => {
  const control = harness();
  control.testSelect({ device: {} });
  control.applyDpiStageValue(1, 1200);
  assert.deepEqual(pending.pendingChanges().map((change) => change.key), []);
});

test("a mouse that can rewrite a stage still gets the write", () => {
  const control = harness();
  control.testSelect({ device: {}, async setDpiStageValue() {} });
  control.applyDpiStageValue(1, 1200);
  assert.deepEqual(pending.pendingChanges().map((change) => change.key), ["dpi-stage-1"]);
});
