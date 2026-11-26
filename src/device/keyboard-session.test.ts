import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as pending from "./pending-changes.ts";
import * as snapshots from "./game-profile-snapshot.ts";

function harness() {
  const exports: any = {};
  const mocks = new Map();
  const source = readFileSync(new URL("./controller.ts", import.meta.url), "utf8").replaceAll("import.meta.env", "({ DEV: false })") + `
export function testKeyboard(client) { activeKeyboard = client; keyboardBusy = false; }
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

function keyboard() {
  const sent: string[] = [];
  return { sent, client: { device: {}, async command(command: { step: string }) { sent.push(command.step); return {}; } } };
}

test("a keyboard command bound to a session never reaches a different keyboard", async () => {
  const control = harness();
  const first = keyboard();
  const second = keyboard();
  control.testKeyboard(first.client);
  const session = control.keyboardSession();
  control.testKeyboard(second.client);
  assert.equal(await control.runKeyboardCommand({ kind: "mchoseCalibrate", step: "end" }, session), false);
  assert.deepEqual(second.sent, []);
  assert.equal(await control.runKeyboardCommand({ kind: "mchoseCalibrate", step: "end" }), true, "unbound commands still go to the active keyboard");
  assert.deepEqual(second.sent, ["end"]);
  control.testKeyboard(first.client);
  assert.equal(await control.runKeyboardCommand({ kind: "mchoseCalibrate", step: "end" }, session), true);
  assert.deepEqual(first.sent, ["end"]);
});
