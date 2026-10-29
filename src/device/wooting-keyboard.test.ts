import assert from "node:assert/strict";
import test from "node:test";
import { WootingKeyboardClient } from "./wooting-keyboard.ts";
import { createKeyboardClient, createSupportedClient, listLogicalDevices } from "./device-clients.ts";
import { HID_FILTERS } from "./hid-filters.ts";
import { availableKeyboardWorkspaceTabs } from "../features/devices/workspace-tabs.ts";

function device(usagePage: number, usage = 1): HIDDevice {
  return {
    vendorId: 0x31e3, productId: 0x1322, productName: "Wooting 60HE+", opened: false,
    collections: [{ usagePage, usage, inputReports: [], outputReports: [], featureReports: [], children: [] }],
  } as unknown as HIDDevice;
}

/** The adapter keeps its driver private; tests stub that driver structurally. */
function driverOf(client: WootingKeyboardClient): Record<string, unknown> {
  return (client as unknown as { client: Record<string, unknown> }).client;
}

/** Stub the re-read the command path performs after a successful write. */
function reReadOf(client: WootingKeyboardClient): { reopenAndRead(): Promise<unknown> } {
  return Object.getPrototypeOf(client) as { reopenAndRead(): Promise<unknown> };
}

test("Wooting 60HE+ selects its config collection and the keyboard driver", async () => {
  const config = device(0xff55);
  const analog = device(0xff53);
  const boot = device(1, 6);
  assert.ok(createKeyboardClient(config) instanceof WootingKeyboardClient);
  assert.equal(await createSupportedClient(config), null);
  assert.equal(createKeyboardClient(analog), null);
  assert.equal(createKeyboardClient(boot), null);
  assert.deepEqual(await listLogicalDevices([boot, analog, config]), [config]);
  assert.ok(HID_FILTERS.some((f) => f.vendorId === 0x31e3 && f.usagePage === 0xff55 && f.usage === 1));
  assert.deepEqual(availableKeyboardWorkspaceTabs("wooting"), ["overview", "performance", "lighting", "profiles", "advanced"]);
});

test("Wooting adapter rejects settings commands before opening HID", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  await assert.rejects(client.command({ kind: "save", scope: "all" }), /read-only/);
  await assert.rejects(client.command({ kind: "slot", value: 1 }), /read-only/);
  assert.equal("writeTrigger" in client, false);
  assert.equal("setPollingRate" in client, false);
});

test("Wooting analog save writes with confirmation then returns a fresh read", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const calls: unknown[][] = [];
  const status = { brand: "Wooting" } as unknown;
  const inner = driverOf(client);
  inner.writeAnalogDefaults = async (...args: unknown[]) => { calls.push(args); return true; };
  inner.close = async () => {};
  inner.open = async () => {};
  inner.readStatus = async () => status;
  // reopenAndRead builds a new driver client; stub it through the prototype instead.
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    const update = await client.command({ kind: "wootingAnalog", actuationMm: 1.5 });
    assert.deepEqual(calls, [[{ actuationMm: 1.5 }, true]]);
    assert.equal(update.wooting, status);
  } finally { proto.reopenAndRead = original; }
});

test("Wooting per-key actuation save passes each key and null reset through with confirmation", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const calls: unknown[][] = [];
  const status = { brand: "Wooting" } as unknown;
  const inner = driverOf(client);
  inner.editPerKeyActuation = async (...args: unknown[]) => { calls.push(args); return true; };
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    await client.command({ kind: "wootingKeyActuation", keys: 0x20, actuationMm: 1.2 });
    await client.command({ kind: "wootingKeyActuation", keys: [0x20, 0x21], actuationMm: null });
    assert.deepEqual(calls, [[0x20, 1.2, true], [0x20, null, true], [0x21, null, true]]);
  } finally { proto.reopenAndRead = original; }
});

test("Wooting accepts a per-key actuation write when only the immediate read-back was stale", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const status = {
    brand: "Wooting",
    activeProfile: 1,
    perKeyActuation: { overrides: [{ key: 0x86, actuationMm: 1.2, actuationRaw: 21315 }], raw: new Uint8Array() },
  } as unknown;
  const inner = driverOf(client);
  inner.editPerKeyActuation = async () => { throw new Error("Wooting per-key actuation save was not confirmed by read-back."); };
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    const update = await client.command({ kind: "wootingKeyActuation", keys: 0x86, actuationMm: 1.2 });
    assert.equal(update.wooting, status);
  } finally { proto.reopenAndRead = original; }
});

test("Wooting reports the key and profile when per-key actuation really did not stick", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const status = {
    brand: "Wooting",
    activeProfile: 1,
    perKeyActuation: { overrides: [], raw: new Uint8Array() },
  } as unknown;
  const inner = driverOf(client);
  inner.editPerKeyActuation = async () => { throw new Error("Wooting per-key actuation save was not confirmed by read-back."); };
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    await assert.rejects(
      client.command({ kind: "wootingKeyActuation", keys: 0x86, actuationMm: 1.2 }),
      /Profile 1, key 134 reads no override/,
    );
  } finally { proto.reopenAndRead = original; }
});

test("Wooting RGB apply stages core and colors then saves to flash", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const calls: string[] = [];
  const status = { brand: "Wooting", activeProfile: 1 } as unknown;
  const inner = driverOf(client);
  inner.writeRgbCore = async () => { calls.push("core"); return true; };
  inner.writeRgbColors = async (part: number) => { calls.push(`colors${part}`); return true; };
  inner.saveProfile = async (command: number) => { calls.push(`save${command}`); return true; };
  inner.readStatus = async () => status;
  inner.readRgbCore = async () => null;
  inner.readRgbColors = async () => null;
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    const base = { brightness: 255, capsLockActiveColor: 0xffff, fnLockActiveColor: 0xffff, scrollLockActiveColor: null, numLockActiveColor: null };
    await client.command({
      kind: "wootingRgbApply",
      core: { base, layers: [] },
      colors1: [[0xffff]],
      colors2: [[0xffff]],
      save: true,
    });
    assert.deepEqual(calls, ["core", "colors1", "colors2", "save8"]);
  } finally { proto.reopenAndRead = original; }
});

test("Wooting profile switch goes through the driver then re-reads status", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const calls: number[] = [];
  const status = { brand: "Wooting", activeProfile: 2 } as unknown;
  const inner = driverOf(client);
  inner.switchProfile = async (slot: number) => { calls.push(slot); return slot; };
  inner.readRgbCore = async () => null;
  inner.readRgbColors = async () => null;
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    const update = await client.command({ kind: "wootingProfileSwitch", slot: 2 });
    assert.deepEqual(calls, [2]);
    assert.equal(update.wooting, status);
  } finally { proto.reopenAndRead = original; }
});

test("Wooting AKC item save goes through the single-item path", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const calls: unknown[][] = [];
  const status = { brand: "Wooting" } as unknown;
  const inner = driverOf(client);
  inner.editAkcItem = async (...args: unknown[]) => { calls.push(args); return true; };
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    const payload = { kind: "toggleKey" as const, keybind: 4 };
    await client.command({ kind: "wootingAkcItem", keyIndex: 0x38, layer: 1, payload });
    await client.command({ kind: "wootingAkcItem", keyIndex: 0x38, layer: 1, payload: null });
    assert.deepEqual(calls, [[0, 0x38, 1, payload, true], [0, 0x38, 1, null, true]]);
  } finally { proto.reopenAndRead = original; }
});

test("Wooting per-key rapid trigger saves keys, target and confirmation then re-reads", async () => {
  const client = new WootingKeyboardClient(device(0xff55));
  const calls: unknown[][] = [];
  const status = { brand: "Wooting" } as unknown;
  const inner = driverOf(client);
  inner.editPerKeyRapidTrigger = async (...args: unknown[]) => { calls.push(args); return true; };
  const proto = reReadOf(client);
  const original = proto.reopenAndRead;
  proto.reopenAndRead = async () => status;
  try {
    const custom = await client.command({ kind: "wootingKeyRapidTrigger", keys: 0x20, target: { sensitivityMm: 0.1, continuous: false } });
    const off = await client.command({ kind: "wootingKeyRapidTrigger", keys: [0x20, 0x21], target: { enabled: false } });
    const base = await client.command({ kind: "wootingKeyRapidTrigger", keys: 0x20, target: null });
    assert.deepEqual(calls, [
      [0x20, { sensitivityMm: 0.1, continuous: false }, true],
      [[0x20, 0x21], { enabled: false }, true],
      [0x20, null, true],
    ]);
    assert.equal(custom.wooting, status);
    assert.equal(off.wooting, status);
    assert.equal(base.wooting, status);
  } finally { proto.reopenAndRead = original; }
});
