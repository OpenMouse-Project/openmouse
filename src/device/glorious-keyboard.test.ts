import assert from "node:assert/strict";
import test from "node:test";
import { gloriousModel, type GloriousJob, type GloriousModel } from "@openmouse/keyboard-protocol/glorious";
import { GloriousKeyboardClient, gloriousStorageKey, readStoredGlorious, type GloriousSender } from "./glorious-keyboard.ts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

function fakeSender(model: GloriousModel, fail = false): GloriousSender & { jobs: GloriousJob[] } {
  const jobs: GloriousJob[] = [];
  return {
    device: { vendorId: model.vendorId, productId: model.productId } as HIDDevice,
    model, jobs,
    open: async () => {}, close: async () => {},
    send: async (job) => { if (fail) throw new Error("unplugged"); jobs.push(job); },
  };
}

const G2 = gloriousModel(0x320f, 0x504a)!;
const NUMPAD = gloriousModel(0x320f, 0x5088)!;

test("a stored record keeps only what the board can take", () => {
  const raw = JSON.stringify({
    unlocked: true,
    state: {
      polling: 8000, profile: 7, layer: 1, debounce: [8, 5, 16], sleep: 30,
      keys: [[{ KeyA: { kind: "key", code: 6 }, Fn: { kind: "disabled" }, F1: { kind: "disabled" }, KeyB: { kind: "macro", slot: 9 } }]],
      macros: { 1: { name: "Hi", mode: "toggle", events: [{ type: "press", code: 4, delay: 5 }] }, 11: { name: "x", mode: "once", events: [] } },
    },
  });
  const { unlocked, state } = readStoredGlorious(G2, raw);
  assert.equal(unlocked, true);
  assert.equal(state.polling, 1000);
  assert.equal(state.profile, 0);
  assert.equal(state.layer, 1);
  assert.deepEqual(state.debounce, [8, 16, 16]);
  assert.equal(state.sleep, G2.defaultSleep);
  assert.deepEqual(state.keys[0]![0], { KeyA: { kind: "key", code: 6 } });
  assert.deepEqual(Object.keys(state.macros), ["1"]);
  assert.deepEqual(readStoredGlorious(NUMPAD, raw).state.macros, {});
  assert.equal(readStoredGlorious(G2, "{not json").unlocked, false);
});

test("nothing is sent until changes are allowed", async () => {
  const sender = fakeSender(G2);
  const client = new GloriousKeyboardClient(sender.device, sender, memoryStorage());
  await assert.rejects(client.command({ kind: "gloriousPolling", hz: 500 }));
  assert.equal(sender.jobs.length, 0);
});

test("a change is recorded and stored only after it was sent", async () => {
  const store = memoryStorage();
  const sender = fakeSender(G2);
  const client = new GloriousKeyboardClient(sender.device, sender, store);
  await client.command({ kind: "gloriousUnlock", unlocked: true });
  const update = await client.command({ kind: "gloriousPolling", hz: 500 });
  assert.equal(update.glorious?.state.polling, 500);
  assert.deepEqual(sender.jobs.map((job) => job.map((f) => f.frame[1])), [[0x08]]);
  assert.equal(JSON.parse(store.getItem(gloriousStorageKey(G2))!).state.polling, 500);

  const broken = fakeSender(G2, true);
  const again = new GloriousKeyboardClient(broken.device, broken, store);
  await assert.rejects(again.command({ kind: "gloriousPolling", hz: 250 }));
  assert.equal(JSON.parse(store.getItem(gloriousStorageKey(G2))!).state.polling, 500);
});

test("keys go to the active profile and layer; macros fill the first free slot", async () => {
  const sender = fakeSender(G2);
  const client = new GloriousKeyboardClient(sender.device, sender, memoryStorage());
  await client.command({ kind: "gloriousUnlock", unlocked: true });
  await client.command({ kind: "gloriousLayer", layer: 2 });
  const events = [{ type: "press", code: 4, delay: 5 }, { type: "release", code: 4, delay: 5 }] as const;
  const saved = await client.command({ kind: "gloriousMacroSave", slot: null, macro: { name: " ", mode: "once", events } });
  assert.equal(saved.glorious?.state.macros[1]?.name, "Macro 1");
  const keyed = await client.command({ kind: "gloriousKeys", keys: { KeyQ: { kind: "macro", slot: 1 } } });
  assert.deepEqual(keyed.glorious?.state.keys[0]![2], { KeyQ: { kind: "macro", slot: 1 } });
  const last = sender.jobs.at(-1)!;
  assert.deepEqual(last.map((f) => f.frame[1]), [0x04, 0x05, 0x03]);
  assert.equal(last[2]!.frame[3], 3);
  const removed = await client.command({ kind: "gloriousMacroDelete", slot: 1 });
  assert.deepEqual(removed.glorious?.state.keys[0]![2], {});
  assert.deepEqual(removed.glorious?.state.macros, {});
});
