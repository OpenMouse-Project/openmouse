import assert from "node:assert/strict";
import test from "node:test";
import { KeychronKeyboardClient } from "../keychron-keyboard.ts";
import { analogKeyCount, curveInRange, curveScale } from "../keychron-curve.ts";
import { legendFor } from "../keychron-legend.ts";
import { pickerCatalog } from "../keychron-picker.ts";
import { FakeKeychronBoard, keychronPreviewRequested } from "./keychron-preview.ts";

test("the preview is requested only by its query parameter", () => {
  assert.equal(keychronPreviewRequested(""), null);
  assert.deepEqual(keychronPreviewRequested("?keychronPreview=1"), { layout: "v4", protocol: 12, fault: "none" });
  assert.deepEqual(keychronPreviewRequested("?keychronPreview=v5"), { layout: "v5", protocol: 12, fault: "none" });
  assert.deepEqual(keychronPreviewRequested("?keychronPreview=legacy,reject"), { layout: "v4", protocol: 10, fault: "reject" });
  assert.deepEqual(keychronPreviewRequested("?keychronPreview=v5,novia"), { layout: "v5", protocol: 12, fault: "novia" });
});

for (const [name, v5, unit] of [["v4", false, 0.1], ["v5", true, 0.01]] as const) {
  test(`the ${name} preview board round-trips through the real driver`, async () => {
    const client = new KeychronKeyboardClient(new FakeKeychronBoard(v5, 0) as unknown as HIDDevice);
    const first = (await client.command({ kind: "refresh" })).keychron!;
    assert.equal(first.status.keychron?.unit, unit);
    assert.deepEqual(first.status.profileNames, ["Typing", "Gaming", "Shooter"]);
    assert.equal(first.profile?.keys.length, 6);
    assert.equal(first.profile?.keys[0]?.length, 19);
    assert.equal(first.layout.physical, true);
    assert.equal(first.layout.keys.length, 100);
    assert.equal(first.keymap?.[0]?.[0], 41); // Esc
    assert.equal(first.keymap?.[2]?.[1], 20); // Q
    assert.equal(first.profile?.keys[3]?.[4]?.advanceMode, 3); // the demo advanced key
    assert.equal(analogKeyCount(first.profile), 4);
    assert.ok(curveInRange(first.curve!, curveScale(first.status.keychron!, first.axis?.maxMm ?? null).maxX)); // the fake curve obeys Launcher's ranges

    // Staged travel is invisible to reads until it is saved.
    const staged = (await client.command({ kind: "keychronSetTravel", rapidTrigger: true, pressMm: 2, sensitivePressMm: 0.5, sensitiveReleaseMm: 0.6 })).keychron!;
    assert.ok(staged.unsaved);
    assert.notEqual(staged.profile?.keys[0]?.[0]?.distance, Math.round(2 / unit));
    const saved = (await client.command({ kind: "keychronSave" })).keychron!;
    assert.equal(saved.profile?.keys[0]?.[0]?.distance, Math.round(2 / unit));
    assert.equal(saved.profile?.keys[0]?.[0]?.advancePress, Math.round(0.5 / unit));
    assert.equal(saved.profile?.keys[0]?.[0]?.advanceRelease, Math.round(0.6 / unit));

    const renamed = (await client.command({ kind: "keychronRename", slot: 0, name: "Office" })).keychron!;
    assert.equal(renamed.status.profileNames?.[0], "Office");

    const cleared = (await client.command({ kind: "keychronClear", confirmed: true })).keychron!;
    assert.equal(cleared.profile?.keys[0]?.[0]?.distance, Math.round(1.2 / unit));

    const states = [];
    for (const action of ["start", "read", "read"] as const) {
      const result = await client.command(action === "start" ? { kind: "keychronCalibration", action, confirmed: true } : { kind: "keychronCalibration", action });
      states.push(result.keychron?.calibration?.state);
    }
    assert.deepEqual(states, [1, 2, 3]);
  });
}

const F = 9; // KC_F
const G = 10; // KC_G
const board = (options: { protocol?: number; fault?: "none" | "reject" | "novia" } = {}) => {
  const client = new KeychronKeyboardClient(new FakeKeychronBoard(false, 0, options) as unknown as HIDDevice);
  return { client, load: async () => (await client.command({ kind: "refresh" })).keychron! };
};

test("remapping sets the key, re-reads the keymap and remembers the original", async () => {
  const { client, load } = board();
  const first = await load();
  assert.equal(first.remap.unavailable, null);
  assert.equal(first.remap.protocol, 12);
  assert.equal(first.remap.layerCount, 3);
  assert.equal(first.remap.keymap?.[3]?.[4], F);
  const changed = (await client.command({ kind: "keychronRemap", layer: 0, row: 3, col: 4, code: G })).keychron!;
  assert.equal(changed.remap.keymap?.[3]?.[4], G);
  assert.equal(changed.keymap?.[3]?.[4], G); // layer 0 also labels the actuation map
  assert.equal(changed.remap.result?.kind, "ok");
  assert.deepEqual(changed.remap.originals, { "0:3:4": F });
  // Restoring puts the original back and forgets it.
  const restored = (await client.command({ kind: "keychronRemap", layer: 0, row: 3, col: 4, code: F, restore: true })).keychron!;
  assert.equal(restored.remap.keymap?.[3]?.[4], F);
  assert.deepEqual(restored.remap.originals, {});
});

test("replacing the only layer key waits for confirmation and writes nothing until then", async () => {
  const { client, load } = board();
  const first = await load();
  const layerKey = first.remap.keymap![5]![10]!;
  const held = (await client.command({ kind: "keychronRemap", layer: 0, row: 5, col: 10, code: G })).keychron!;
  assert.equal(held.remap.keymap?.[5]?.[10], layerKey);
  assert.ok(held.remap.warning && held.remap.warning.warnings.length > 0);
  assert.equal(held.remap.result, null);
  const dismissed = (await client.command({ kind: "keychronDismissRemap" })).keychron!;
  assert.equal(dismissed.remap.warning, null);
  assert.equal(dismissed.remap.keymap?.[5]?.[10], layerKey);
  await client.command({ kind: "keychronRemap", layer: 0, row: 5, col: 10, code: G });
  const done = (await client.command({ kind: "keychronRemap", layer: 0, row: 5, col: 10, code: G, confirmed: true })).keychron!;
  assert.equal(done.remap.keymap?.[5]?.[10], G);
  assert.equal(done.remap.warning, null);
  assert.equal(done.remap.result?.kind, "ok");
});

test("a board that keeps its old key fails the write and the map shows the real key", async () => {
  const { client, load } = board({ fault: "reject" });
  await load();
  await assert.rejects(() => client.command({ kind: "keychronRemap", layer: 0, row: 3, col: 4, code: G }), /did not keep the new key assignment/);
  const recovered = client.recoveredWorkspace()?.keychron;
  assert.equal(recovered?.remap.result?.kind, "failed");
  assert.match(recovered?.remap.result?.message ?? "", /did not keep/);
  assert.equal(recovered?.remap.keymap?.[3]?.[4], F);
  assert.deepEqual(recovered?.remap.originals, {});
  assert.equal(client.recoveredWorkspace(), null); // handed over once
});

test("the layer switcher reads that layer, and rejects layers that do not exist", async () => {
  const { client, load } = board();
  await load();
  const layer1 = (await client.command({ kind: "keychronSelectLayer", layer: 1 })).keychron!;
  assert.equal(layer1.remap.layer, 1);
  assert.equal(layer1.remap.keymap?.[3]?.[4], 1); // transparent on the fake's upper layers
  assert.equal(layer1.keymap?.[3]?.[4], F); // the actuation map keeps layer 0 legends
  await assert.rejects(() => client.command({ kind: "keychronSelectLayer", layer: 3 }), RangeError);
  await assert.rejects(() => client.command({ kind: "keychronRemap", layer: 0, row: 3, col: 4, code: G }), /Select that layer/);
});

test("legacy firmware uses its own table and refuses codes from the modern one", async () => {
  const { client, load } = board({ protocol: 10 });
  const first = await load();
  assert.equal(first.remap.protocol, 10);
  const catalog = pickerCatalog(first.remap.context, first.remap.layerCount);
  assert.equal(catalog.find((entry) => entry.id === "layers")?.entries.find((entry) => entry.label === "MO1")?.code, 0x5101);
  assert.equal(legendFor(first.remap.keymap![5]![10], first.remap.context).label, "MO1");
  await assert.rejects(() => client.command({ kind: "keychronRemap", layer: 0, row: 3, col: 4, code: 0x5221 }), /not valid for this board's firmware/);
  assert.equal((await client.command({ kind: "keychronRemap", layer: 0, row: 3, col: 4, code: 0x5101 })).keychron?.remap.result?.kind, "ok");
});

test("a board with custom keys shows them by name", async () => {
  const { load } = board();
  const first = await load();
  assert.equal(legendFor(first.remap.keymap![5]![2]!, first.remap.context).label, "LOpt");
  assert.equal(legendFor(first.remap.keymap![5]![2]!).unknown, true); // without the context it would be hex
});

test("a board that ignores VIA turns remapping off with the reason, and the rest keeps working", async () => {
  const { client, load } = board({ fault: "novia" });
  const first = await load();
  assert.match(first.remap.unavailable ?? "", /did not answer/);
  assert.equal(first.keymap, null);
  assert.ok(first.profile && first.curve);
  await assert.rejects(() => client.command({ kind: "keychronRemap", layer: 0, row: 3, col: 4, code: G }), /did not answer/);
  assert.equal((await client.command({ kind: "keychronKeyTravel", row: 1, col: 1 })).keychron?.keyTravel?.row, 1);
});
