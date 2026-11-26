import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as pending from "./pending-changes.ts";
import * as snapshots from "./game-profile-snapshot.ts";

function controllerHarness() {
  pending.clearPendingChanges();
  const timers: (() => void)[] = [];
  const exports: any = {};
  const mocks = new Map();
  const source = readFileSync(new URL("./controller.ts", import.meta.url), "utf8").replaceAll("import.meta.env", "({ DEV: false })") + `
export function testSelect(client) { clearActiveClients(); clearPendingChanges(); active = client; activeDevice = client.device; latestDeviceStatus = { name: "Same model", dpi: 800, pollingRateHz: 1000, supportedPollingRates: [500,1000] }; dpiOptions = [800,1200,1600,3200]; }
export function testDisconnect() { clearActiveClients(); clearPendingChanges(); activeDevice = null; latestDeviceStatus = null; }
export function testReading(value) { refreshInProgress = value; }
`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localStorage = { getItem: () => null };
  const context = { exports, structuredClone, __BUILD_CHANNEL__: "stable", __BUILD_ID__: "test", __APP_VERSION__: "test", localStorage, window: { localStorage, setTimeout: (callback: () => void) => { timers.push(callback); return 1; }, clearTimeout() {} }, setTimeout, clearTimeout, console, require: (name: string) => {
    if (name.endsWith("pending-changes")) return pending;
    if (name.endsWith("game-profile-snapshot")) return snapshots;
    if (name.endsWith("interface-preferences")) return { loadInterfacePreferences: () => ({ locale: "en", reducedMotion: false }) };
    if (name.endsWith("i18n/index")) return { t: (_locale: string, key: string) => key, tp: (_locale: string, key: string) => key };
    if (!mocks.has(name)) mocks.set(name, new Proxy({}, { get: (target: any, key) => target[key] ??= function () {} }));
    return mocks.get(name);
  } };
  vm.runInNewContext(code, context);
  const a = { device: {}, readStatus: async () => { throw new Error("fake read denied"); } };
  const b = { device: {}, readStatus: async () => { throw new Error("fake read denied"); } };
  exports.testSelect(a);
  return { control: exports, a, b, timers, async drain() { for (let i = 0; i < 30; i++) { timers.splice(0).forEach((callback) => callback()); await Promise.resolve(); } } };
}

test("an abandoned profile write never restores A's staged edits into B", async () => {
  const h = controllerHarness();
  pending.stagePendingChange({ key: "user-A", label: "A", command: "A", progress: "A", apply: async () => {} });
  const running = h.control.flashGameProfileSnapshot({ pollingRateHz: 500 }, h.control.getGameProfileOwner());
  h.control.testSelect(h.b);
  pending.stagePendingChange({ key: "user-B", label: "B", command: "B", progress: "B", apply: async () => {} });
  await h.drain();
  assert.equal(await running, "stale");
  assert.deepEqual(pending.pendingChanges().map((change) => change.key), ["user-B"]);
});

test("controller owner tokens change across an A/B/A session switch", () => {
  const h = controllerHarness();
  const first = h.control.getGameProfileOwner();
  assert.equal(h.control.getGameProfileOwner(), first);
  h.control.testSelect(h.b); h.control.testSelect(h.a);
  assert.notEqual(h.control.getGameProfileOwner(), first);
  assert.equal(h.control.isGameProfileOwner(first), false);
});

test("controller checks identity again after waiting on a refresh", async () => {
  const h = controllerHarness();
  let writes = 0;
  pending.stagePendingChange({ key: "test", label: "test", command: "test", progress: "test", apply: async () => { writes++; } });
  h.control.testReading(true);
  const running = h.control.flashPendingChanges();
  await Promise.resolve();
  h.control.testSelect(h.b); h.control.testReading(false);
  await h.drain(); await running;
  assert.equal(writes, 0);
});

test("controller refuses an explicit stale owner before touching pending changes", async () => {
  const h = controllerHarness();
  const owner = h.control.getGameProfileOwner?.();
  h.control.testSelect(h.b);
  assert.equal(await h.control.flashGameProfileSnapshot({ dpi: 1600 }, owner), "stale");
});

test("controller rechecks identity after flash delay before dispatching a writer", async () => {
  const h = controllerHarness();
  let writes = 0;
  pending.stagePendingChange({ key: "test", label: "test", command: "test", progress: "test", apply: async () => { writes++; } });
  const running = h.control.flashPendingChanges();
  await Promise.resolve();
  h.control.testSelect(h.b);
  await h.drain(); await running;
  assert.equal(writes, 0);
});

test("controller drops remaining batches after a writer completion changes selection", async () => {
  const h = controllerHarness();
  const writes: string[] = [];
  pending.stagePendingChange({ key: "one", label: "one", command: "one", progress: "one", apply: async () => { writes.push("A"); h.control.testSelect(h.b); } });
  pending.stagePendingChange({ key: "two", label: "two", command: "two", progress: "two", apply: async () => { writes.push("B"); } });
  const running = h.control.flashPendingChanges();
  await h.drain(); await running;
  assert.deepEqual(writes, ["A"]);
});

for (const route of ["B", "disconnect", "A/B/A"]) {
  test(`manual profile draft and stash cannot cross ${route}`, async () => {
    const h = controllerHarness();
    const writes: string[] = [];
    Object.assign(h.a, { setDpi: async (dpi: number) => { writes.push(`A:${dpi}`); } });
    Object.assign(h.b, { setDpi: async (dpi: number) => { writes.push(`B:${dpi}`); } });
    const owner = h.control.getGameProfileOwner();
    assert.equal(h.control.applyDpiValue(1600), true);
    assert.equal(h.control.beginGameProfileDraft({}), true);
    h.control.applyDpiValue(3200);
    if (route === "disconnect") h.control.testDisconnect();
    else h.control.testSelect(h.b);
    if (route === "A/B/A") h.control.testSelect(h.a);
    assert.equal(h.control.isGameProfileDraftActive(), false);
    h.control.endGameProfileDraft(owner);
    const running = h.control.flashPendingChanges();
    await h.drain(); await running;
    assert.deepEqual(writes, []);
    assert.deepEqual(pending.pendingChanges(), []);
  });
}

test("departed panel cleanup cannot end the new session's draft or replace its stash", () => {
  const h = controllerHarness();
  Object.assign(h.a, { setDpi: async () => {} });
  Object.assign(h.b, { setDpi: async () => {} });
  const owner = h.control.getGameProfileOwner();
  h.control.applyDpiValue(1600);
  h.control.beginGameProfileDraft({});
  h.control.testSelect(h.b);
  h.control.applyDpiValue(1200);
  h.control.beginGameProfileDraft({ dpi: 3200 });
  h.control.endGameProfileDraft(owner);
  assert.equal(h.control.isGameProfileDraftActive(), true);
  assert.equal(h.control.gameProfileDraftSnapshot().dpi, 3200);
  h.control.endGameProfileDraft();
  assert.equal(pending.withPendingChanges({ dpi: 800 } as any).dpi, 1200);
});

test("same-session manual draft cleanup restores the original manual DPI edit", async () => {
  const h = controllerHarness();
  const writes: number[] = [];
  Object.assign(h.a, { setDpi: async (dpi: number) => { writes.push(dpi); } });
  h.control.applyDpiValue(1600);
  h.control.beginGameProfileDraft({ dpi: 3200 });
  h.control.endGameProfileDraft(h.control.getGameProfileOwner());
  const running = h.control.flashPendingChanges();
  await h.drain(); await running;
  assert.deepEqual(writes, [1600]);
});

test("a rejected profile setter reports failed and restores the exact manual edits", async () => {
  const h = controllerHarness();
  Object.assign(h.a, { setDpi: async () => { throw new Error("refused"); } });
  h.control.applyDpiValue(1200);
  const before = pending.pendingChanges();
  const running = h.control.flashGameProfileSnapshot({ dpi: 1600 });
  await h.drain();
  assert.equal(await running, "failed");
  assert.deepEqual(pending.pendingChanges(), before);
});

test("partial manual flash preserves failed and unsent edits and reports partial", async () => {
  const h = controllerHarness();
  const writes: string[] = [];
  Object.assign(h.a, {
    setDpi: async () => { writes.push("dpi"); },
    setPollingRate: async () => { writes.push("rate"); throw new Error("refused"); },
    setLiftOffDistance: async () => { writes.push("lod"); },
  });
  h.control.applyDpiValue(1600);
  h.control.applyPollingRate(500);
  h.control.applyLiftOffDistance("High");
  const before = pending.pendingChanges();
  const running = h.control.flashPendingChanges();
  await h.drain();
  assert.equal(await running, "partial");
  assert.deepEqual(writes, ["dpi", "rate"]);
  assert.deepEqual(pending.pendingChanges(), before.slice(1));
});

test("a partial profile flash reports partial without leaking automatic edits into the manual stash", async () => {
  const h = controllerHarness();
  const writes: string[] = [];
  Object.assign(h.a, {
    setDpi: async () => { writes.push("dpi"); },
    setPollingRate: async () => { writes.push("rate"); throw new Error("refused"); },
  });
  h.control.applyDpiValue(1200);
  const before = pending.pendingChanges();
  const running = h.control.flashGameProfileSnapshot({ dpi: 1600, pollingRateHz: 500 });
  await h.drain();
  assert.equal(await running, "partial");
  assert.deepEqual(writes, ["dpi", "rate"]);
  assert.deepEqual(pending.pendingChanges(), before);
});
