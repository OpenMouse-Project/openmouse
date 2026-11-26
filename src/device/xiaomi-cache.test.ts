import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as xiaomi from "@openmouse/protocol/xiaomi";
import * as pending from "./pending-changes.ts";
import * as snapshots from "./game-profile-snapshot.ts";

class FakeXiaomi {}

// Every other driver class or helper is an inert stand-in.
const modules = new Proxy({ XiaomiHidClient: FakeXiaomi } as Record<string | symbol, unknown>, {
  get: (target, key) => target[key] ??= function () {},
});

function harness() {
  pending.clearPendingChanges();
  const exports: any = {};
  const mocks = new Map();
  const source = readFileSync(new URL("./controller.ts", import.meta.url), "utf8").replaceAll("import.meta.env", "({ DEV: false })") + `
export function testSelect(client) { clearActiveClients(); clearPendingChanges(); active = client; activeDevice = client.device; latestDeviceStatus = { name: "Mi Gaming Mouse", dpi: 800, pollingRateHz: 1000, buttonMappings: { M4: "Forward", M5: "Back" } }; }
`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localStorage = { getItem: () => null };
  const context = { exports, structuredClone, __BUILD_CHANNEL__: "stable", __BUILD_ID__: "test", __APP_VERSION__: "test", localStorage, window: { localStorage, setTimeout: () => 1, clearTimeout() {} }, setTimeout, clearTimeout, console, require: (name: string) => {
    if (name.endsWith("pending-changes")) return pending;
    if (name.endsWith("game-profile-snapshot")) return snapshots;
    if (name === "@openmouse/protocol/xiaomi") return xiaomi;
    if (name.endsWith("driver-classes")) return { driverModules: () => modules, ensureDriverModules: async () => modules };
    if (name.endsWith("interface-preferences")) return { loadInterfacePreferences: () => ({ locale: "en", reducedMotion: false }) };
    if (name.endsWith("i18n/index")) return { t: (_locale: string, key: string) => key, tp: (_locale: string, key: string) => key };
    if (!mocks.has(name)) mocks.set(name, new Proxy({}, { get: (target: any, key) => target[key] ??= function () {} }));
    return mocks.get(name);
  } };
  vm.runInNewContext(code, context);
  return exports;
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve)); };

test("a preset remap during a Xiaomi load drops the stale bindings and reloads", async () => {
  const control = harness();
  const KEY = xiaomi.XIAOMI_KEY_COMBOS.CTRL_C;
  let mode: number = xiaomi.XIAOMI_KEY_COMBOS.MOVE_BACK;
  let release = () => {};
  const firstRead = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const client = Object.assign(new FakeXiaomi(), {
    device: {},
    async readBinding(button: number) {
      reads++;
      if (reads === 1) await firstRead;
      return { mode: button === 3 ? mode : xiaomi.XIAOMI_KEY_COMBOS.LEFT_CLICK };
    },
    async readMacro() { return []; },
    async setButtonMapping() { mode = KEY; },
  });
  control.testSelect(client);

  control.loadXiaomiMacros();
  // Button 3 ("M5") is remapped while the scan is still waiting on its first read.
  control.applyDeviceButtonMapping("M5", "Copy");
  await pending.pendingChanges().find((change) => change.key === "button-M5")!.apply();
  // The scan now reads M5 after the write, but it started before it: drop it.
  release();
  await settle();
  assert.equal(control.getSnapshot().xiaomiBindings, null, "the overtaken scan publishes nothing");
  assert.equal(control.getSnapshot().xiaomiMacrosLoading, false);

  control.loadXiaomiMacros();
  await settle();
  assert.equal(control.getSnapshot().xiaomiBindings[3].mode, KEY);
});

test("a remap with a loaded cache invalidates it", async () => {
  const control = harness();
  const client = Object.assign(new FakeXiaomi(), {
    device: {},
    async readBinding() { return { mode: xiaomi.XIAOMI_KEY_COMBOS.LEFT_CLICK }; },
    async readMacro() { return []; },
    async setButtonMapping() {},
  });
  control.testSelect(client);
  control.loadXiaomiMacros();
  await settle();
  assert.notEqual(control.getSnapshot().xiaomiBindings, null);
  control.applyDeviceButtonMapping("M4", "Copy");
  await pending.pendingChanges().find((change) => change.key === "button-M4")!.apply();
  assert.equal(control.getSnapshot().xiaomiBindings, null);
});
