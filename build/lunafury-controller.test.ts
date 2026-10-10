import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { build } from "vite";

let controller: any;
const controllerPath = fileURLToPath(new URL("../src/device/controller.ts", import.meta.url)).replaceAll("\\", "/");

before(async () => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  // No browser, native Bridge or real HID device is opened by this harness.
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { search: "" },
    setTimeout: (fn: () => void, ms = 0) => setTimeout(fn, Math.min(ms, 1)), clearTimeout,
    matchMedia: () => ({ matches: false }) };
  (globalThis as any).document = { title: "OpenMouse test" };
  const result: any = await build({
    configFile: false, logLevel: "silent",
    define: { __BUILD_CHANNEL__: '"stable"', __APP_VERSION__: '"test"', __BUILD_ID__: '"test"' },
    plugins: [{ name: "controller-test-state", transform(source, id) {
      if (id.replaceAll("\\", "/") !== controllerPath) return null;
      // Only inject device setup/observability. All staging, Games apply and
      // flash code below is the real controller, bundled by the normal toolchain.
      return source + `
        export async function testConnect(device) {
          clearPendingChanges(); gameProfileDraft = null;
          active = new LamzuHidClient(device); activeDevice = device;
          dpiOptions = active.getDpiOptions(); lastDiagnosticError = null;
          interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES, reducedMotion: true };
          applyStatus(await active.readStatus());
          return latestDeviceStatus;
        }
        export function testState() {
          return { status: latestDeviceStatus, preview: withPendingChanges(latestDeviceStatus),
            pending: pendingChanges().map(change => change.key), error: lastDiagnosticError };
        }
        export { snapshotDiff as testSnapshotDiff, pickSnapshot as testPickSnapshot,
          mergeSnapshots as testMergeSnapshots } from "./game-profile-snapshot.ts";
      `;
    } }],
    build: { write: false, minify: false, lib: { entry: controllerPath, formats: ["es"] },
      rollupOptions: { output: { inlineDynamicImports: true } } },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(entry => entry.output);
  const code = output.find((entry: any) => entry.type === "chunk").code;
  controller = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
});

function fixture(productId = 0x0033) {
  let profile = 1;
  const banks = Array.from({ length: 3 }, () => ({ count: 3, active: 2, axes: true,
    table: [400, 800, 800, 1600, 1600, 3200, 3200, 6400, 6400, 6400, 30000, 30000] }));
  const sent: Uint8Array[] = [];
  const device = { vendorId: 0x373e, productId, productName: "LUNA33", opened: true, collections: [],
    open: async () => {}, close: async () => {},
    sendFeatureReport: async (_id: number, report: Uint8Array) => {
      const packet = new Uint8Array(report); sent.push(packet);
      const key = `${packet[4]}:${packet[5]}`;
      if (key === "0:5") profile = packet[6];
      const bank = banks[packet[6] - 1];
      if (!bank) return;
      if (key === "1:2") bank.active = packet[7];
      if (key === "1:13") bank.axes = packet[7] === 1;
      if (key === "1:1") {
        bank.count = packet[7];
        bank.table = Array.from({ length: 12 }, (_, i) => (packet[8 + i * 2] << 8) | packet[9 + i * 2]);
      }
    },
    receiveFeatureReport: async () => {
      const packet = sent.at(-1)!;
      const key = `${packet[4]}:${packet[5]}`, requested = packet[6];
      const bank = banks[requested - 1] ?? banks[profile - 1];
      let payload = [requested, 0];
      if (key === "0:129") payload = [0, 0, 26, 0];
      if (key === "0:131") payload = [0, 90];
      if (key === "0:133") payload = [profile];
      if (key === "0:135") payload = [requested, 1, 44];
      if (key === "0:159") payload = [requested, 1];
      if (key === "1:128" || key === "1:136") payload = [requested, 1];
      if (key === "1:129") payload = [requested, bank.count, ...bank.table.flatMap(value => [value >> 8, value & 255])];
      if (key === "1:130") payload = [requested, bank.active];
      if (key === "1:141") payload = [requested, +bank.axes];
      const reply = new Uint8Array(64);
      reply[0] = 0xa1; reply[3] = payload.length; reply[4] = packet[4]; reply[5] = packet[5]; reply.set(payload, 6);
      return new DataView(reply.buffer);
    },
  };
  return { device, banks, sent };
}

for (const pid of [0x32, 0x33, 0x54, 0x84]) {
  test(`controller Games selection/restore on ${pid.toString(16)} never writes either DPI table`, async () => {
    const { device, banks, sent } = fixture(pid);
    const before = await controller.testConnect(device);
    const original = [...banks[0].table];
    const target = { ...before, activeDpiStage: 2, dpi: 1600, dpiY: 3200 };
    const saved = controller.testSnapshotDiff(before, target);
    assert.deepEqual(saved, { activeDpiStage: 2 });
    const prior = controller.testPickSnapshot(before, saved);
    assert.equal(await controller.flashGameProfileSnapshot(saved), "written");
    assert.equal(banks[0].active, 3); assert.deepEqual(banks[0].table, original);
    assert.equal(await controller.flashGameProfileSnapshot(prior), "written");
    assert.equal(banks[0].active, 2); assert.deepEqual(banks[0].table, original);
    assert.equal(sent.some(packet => packet[4] === 1 && packet[5] === 1), false);
    assert.equal(controller.testState().error, null);
  });
}

test("controller restores legacy target-stage edits and preserves unrelated pending user changes", async () => {
  const { device, banks } = fixture();
  const before = await controller.testConnect(device);
  const original = [...banks[0].table];
  controller.applyLunaFuryDpiStageAxes(0, 1200, 2400);
  const target = { dpi: 2000, dpiY: 4000, activeDpiStage: 2 };
  const prior = controller.testPickSnapshot(before, target);
  await controller.flashGameProfileSnapshot(target);
  assert.deepEqual(banks[0].table, [400, 800, 800, 1600, 2000, 4000, ...original.slice(6)]);
  assert.deepEqual(controller.testState().pending, ["dpi-stage-0"]);
  await controller.flashGameProfileSnapshot(prior);
  assert.deepEqual(banks[0].table, original); assert.equal(banks[0].active, 2);
  assert.deepEqual(controller.testState().pending, ["dpi-stage-0"]);
  assert.deepEqual(controller.testState().preview.dpiStages, [1200, 800, 1600]);
  assert.equal(controller.testState().error, null);
});

test("controller applies and restores old selection snapshots without DPI-table writes", async () => {
  const { device, banks, sent } = fixture();
  const before = await controller.testConnect(device);
  const original = [...banks[0].table];
  const target = { dpi: 1600, dpiY: 3200, activeDpiStage: 2 };
  const prior = controller.testPickSnapshot(before, target);
  await controller.flashGameProfileSnapshot(target);
  assert.equal(banks[0].active, 3);
  await controller.flashGameProfileSnapshot(prior);
  assert.equal(banks[0].active, 2); assert.deepEqual(banks[0].table, original);
  assert.equal(sent.some(packet => packet[4] === 1 && packet[5] === 1), false);
  assert.equal(controller.testState().error, null);
});

test("controller restores a Y-only edit and a stage-count shrink with the original selected stage", async () => {
  const { device, banks } = fixture();
  const before = await controller.testConnect(device);
  const original = [...banks[0].table];
  const target = { dpiStagesY: [1200, 1600, 3200] };
  await controller.flashGameProfileSnapshot(target);
  assert.deepEqual(banks[0].table, [400, 1200, ...original.slice(2)]);
  await controller.flashGameProfileSnapshot(controller.testPickSnapshot(before, target));
  assert.deepEqual(banks[0].table, original);
  const fewer = { dpiStages: [400] };
  const prior = controller.testPickSnapshot(before, fewer);
  await controller.flashGameProfileSnapshot(fewer);
  assert.equal(banks[0].count, 1); assert.equal(banks[0].active, 1);
  await controller.flashGameProfileSnapshot(prior);
  assert.equal(banks[0].count, 3); assert.equal(banks[0].active, 2);
  assert.deepEqual(banks[0].table, original);
  assert.equal(controller.testState().error, null);
});

test("controller drafts distinguish pure selection from edits to X/Y on another stage", async () => {
  const { device, banks } = fixture();
  const before = await controller.testConnect(device);
  const original = [...banks[0].table];
  assert.equal(controller.beginGameProfileDraft({}), true);
  controller.applyActiveDpiStage(2);
  assert.deepEqual(controller.gameProfileDraftSnapshot(), { activeDpiStage: 2 });
  controller.applyLunaFuryDpiStageAxes(2, 2000, 4000);
  const saved = controller.gameProfileDraftSnapshot();
  assert.deepEqual(saved, { dpiStages: [400, 800, 2000], dpiStagesY: [800, 1600, 4000], activeDpiStage: 2 });
  controller.endGameProfileDraft();
  assert.deepEqual(banks[0].table, original, "drafts must not send writes");
  await controller.flashGameProfileSnapshot(saved);
  assert.deepEqual(banks[0].table.slice(0, 6), [400, 800, 800, 1600, 2000, 4000]);
  await controller.flashGameProfileSnapshot(controller.testPickSnapshot(before, saved));
  assert.deepEqual(banks[0].table, original); assert.equal(banks[0].active, 2);
  assert.equal(controller.testState().error, null);
});

test("controller restores the axis mode and dormant Y table after a combined X edit", async () => {
  const { device, banks } = fixture();
  banks[0].axes = false;
  const before = await controller.testConnect(device);
  const original = [...banks[0].table];
  const target = { dpiStages: [400, 1200, 1600], lunafury: { separateDpiAxes: true } };
  const prior = controller.testPickSnapshot(before, target);
  await controller.flashGameProfileSnapshot(target);
  assert.equal(banks[0].axes, true);
  assert.deepEqual(banks[0].table, [400, 800, 1200, 1600, ...original.slice(4)]);
  await controller.flashGameProfileSnapshot(prior);
  assert.equal(banks[0].axes, false); assert.deepEqual(banks[0].table, original);
  assert.equal(controller.testState().error, null);
});

for (const reverse of [false, true]) {
  test(`controller switches ${reverse ? "table to legacy" : "legacy to table"} Games snapshots and restores the originals`, async () => {
    const { device, banks } = fixture();
    const before = await controller.testConnect(device);
    const original = [...banks[0].table];
    const legacy = { dpi: 1600, dpiY: 3200, activeDpiStage: 2 };
    const table = { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] };
    const first = reverse ? table : legacy, second = reverse ? legacy : table;
    const prior = controller.testPickSnapshot(before, first);
    await controller.flashGameProfileSnapshot(first);
    const afterFirst = controller.testState().status;
    const allPrior = controller.testMergeSnapshots(controller.testPickSnapshot(afterFirst, second), prior, afterFirst);
    const toWrite = controller.testMergeSnapshots(prior, second, afterFirst);
    await controller.flashGameProfileSnapshot(toWrite);
    assert.deepEqual(controller.testState().status.dpiStages, reverse ? before.dpiStages : table.dpiStages);
    assert.deepEqual(controller.testState().status.dpiStagesY, reverse ? before.dpiStagesY : table.dpiStagesY);
    await controller.flashGameProfileSnapshot(allPrior);
    assert.deepEqual(banks[0].table, original); assert.equal(banks[0].active, 2);
    assert.equal(controller.testState().error, null);
  });
}

for (const pid of [0x32, 0x33, 0x54, 0x84]) {
  test(`controller Games expansion on ${pid.toString(16)} restores hidden slots before re-enabling them`, async () => {
    const { device, banks } = fixture(pid);
    const before = await controller.testConnect(device);
    const original = [...banks[0].table];
    const target = { dpiStages: [400, 800, 1600, 2000], dpiStagesY: [800, 1600, 3200, 4000] };
    const prior = controller.testPickSnapshot(before, target);
    await controller.flashGameProfileSnapshot(target);
    assert.equal(banks[0].count, 4); assert.equal(banks[0].table[6], 2000);
    await controller.flashGameProfileSnapshot(prior);
    assert.equal(banks[0].count, 3); assert.equal(banks[0].active, 2);
    assert.deepEqual(banks[0].table, original, "restore must include disabled slots and TYPE33 trailing bytes");
    controller.applyDpiStageCount(4);
    await controller.flashPendingChanges();
    assert.equal(controller.testState().status.dpiStages[3], 3200);
    assert.equal(controller.testState().status.dpiStagesY[3], 6400);
    assert.deepEqual(banks[0].table, original);
    assert.equal(controller.testState().error, null);
  });
}
