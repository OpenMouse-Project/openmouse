import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as snapshots from "../../device/game-profile-snapshot.ts";

function harness() {
  let owner: object | null = {};
  let listener: (value: unknown) => void = () => {};
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let mounted = false;
  const calls: { snapshot: unknown; owner: unknown; resolve: (result: string) => void }[] = [];
  const toasts: unknown[][] = [];
  const control = { getGameProfileOwner: () => owner, isGameProfileOwner: (value: unknown) => value === owner, flashGameProfileSnapshot: (snapshot: unknown, target: unknown) => new Promise<string>((resolve) => calls.push({ snapshot, owner: target, resolve })), pushToast: (...args: unknown[]) => toasts.push(args) };
  const exports = {};
  const source = readFileSync(new URL("./useBridgeProfileApplier.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return { useRef: (initial: unknown) => refs[cursor++] ??= { current: initial }, useEffect: (effect: () => unknown) => { if (!mounted) { effect(); mounted = true; } } };
    if (name.endsWith("controller")) return control;
    if (name.endsWith("bridge-status-store")) return { subscribeBridgeStatus: (callback: typeof listener) => { listener = callback; return () => {}; } };
    if (name.endsWith("game-profile-snapshot")) return snapshots;
    if (name.endsWith("i18n/index")) return { t: (_locale: string, key: string) => key };
    throw new Error(`Unexpected import ${name}`);
  } });
  const render = (dpi = 800) => { cursor = 0; (exports as any).useBridgeProfileApplier({ deviceStatus: { name: "Same model", dpi }, preferences: { locale: "en" } }); };
  render();
  return { calls, toasts, render, switchDevice(renderNow = true) { owner = {}; if (renderNow) render(1200); }, owner: () => owner, notify(active = true) { listener({ activeProfile: active ? { application: { name: "Game" }, device: { name: "Same model" }, settings: { dpi: 1600 } } : null }); } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("bridge events before the new render cannot capture the previous device status", async () => {
  const h = harness();
  h.notify(); h.calls[0].resolve("written"); await settle();
  h.switchDevice(false); h.notify();
  assert.equal(h.calls.length, 1);
  h.render(1200); h.notify();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve("written"); await settle(); h.notify(false);
  assert.equal((h.calls[2].snapshot as any).dpi, 1200);
});

test("profile originals cannot be restored onto another same-name mouse", async () => {
  const h = harness();
  h.notify();
  assert.equal(h.calls[0].owner, h.owner());
  h.calls[0].resolve("written"); await settle();
  h.switchDevice(); h.notify(false);
  assert.equal(h.calls.length, 1);
  h.notify();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve("written"); await settle();
  h.notify(false);
  assert.equal((h.calls[2].snapshot as any).dpi, 1200);
});

test("delayed apply completion does not commit ownership or toast after selection changes", async () => {
  const h = harness();
  h.notify(); h.switchDevice();
  h.calls[0].resolve("written"); await settle();
  assert.equal(h.toasts.length, 0);
  h.notify(false);
  assert.equal(h.calls.length, 1);
  h.notify(); assert.equal(h.calls.length, 2);
});

test("delayed restore completion cannot clear the next device's profile state", async () => {
  const h = harness();
  h.notify(); h.calls[0].resolve("written"); await settle();
  h.notify(false); assert.equal(h.calls.length, 2);
  h.switchDevice(); h.notify();
  h.calls[1].resolve("written"); await settle();
  h.notify();
  assert.equal(h.calls.length, 3);
  h.calls[2].resolve("written"); await settle();
  h.notify(false);
  assert.equal((h.calls[3].snapshot as any).dpi, 1200);
  assert.equal(h.toasts.filter((args) => args[1] === "bridge.profileRestored").length, 0);
});

for (const result of ["failed", "partial"]) {
  test(`${result} profile writes stay retryable without a success toast`, async () => {
    const h = harness();
    h.notify(); h.calls[0].resolve(result); await settle();
    assert.equal(h.toasts.length, 0);
    h.notify();
    assert.equal(h.calls.length, 2);
  });
}

test("partial apply retains the pre-profile baseline across a successful retry", async () => {
  const h = harness();
  h.notify(); h.calls[0].resolve("partial"); await settle();
  h.render(1600); h.notify();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve("written"); await settle();
  h.notify(false);
  assert.equal((h.calls[2].snapshot as any).dpi, 800);
});

test("partial apply restores the original baseline even if the game stops before retry", async () => {
  const h = harness();
  h.notify(); h.calls[0].resolve("partial"); await settle();
  h.render(1600); h.notify(false);
  assert.equal(h.calls.length, 2);
  assert.equal((h.calls[1].snapshot as any).dpi, 800);
});

for (const result of ["failed", "partial"]) {
  test(`${result} restoration retains the original baseline and retries without a restore toast`, async () => {
    const h = harness();
    h.notify(); h.calls[0].resolve("written"); await settle();
    h.notify(false); h.calls[1].resolve(result); await settle();
    assert.equal(h.toasts.filter((args) => args[1] === "bridge.profileRestored").length, 0);
    h.notify(false);
    assert.equal(h.calls.length, 3);
    assert.equal((h.calls[2].snapshot as any).dpi, 800);
  });
}

test("a rejected setter keeps originals when the hardware may have changed before rejecting", async () => {
  const h = harness();
  h.notify(); h.calls[0].resolve("failed"); await settle();
  h.render(1600); h.notify();
  h.calls[1].resolve("written"); await settle();
  h.notify(false);
  assert.equal((h.calls[2].snapshot as any).dpi, 800);
});
