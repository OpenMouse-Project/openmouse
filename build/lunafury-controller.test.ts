import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { build } from "vite";
import type { BridgeProfile } from "../src/bridge.ts";

let controller: any;
const controllerPath = fileURLToPath(new URL("../src/device/controller.ts", import.meta.url)).replaceAll("\\", "/");
const bridgeHookPath = fileURLToPath(new URL("../src/app/useBridgeProfileApplier.ts", import.meta.url)).replaceAll("\\", "/");

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
    plugins: [{ name: "controller-test-state", enforce: "pre",
      resolveId(id, importer) {
        if (id === "test:bridge-hooks" || id === "react") return "\0test:bridge-hooks";
        if (id === "test:bridge-status" || (id === "../bridge-status-store" && importer?.replaceAll("\\", "/") === bridgeHookPath)) {
          return "\0test:bridge-status";
        }
      },
      load(id) {
        // Run the real hook's subscription callback without a DOM renderer or
        // native Bridge. Refs persist across renders; the effect mounts once.
        if (id === "\0test:bridge-hooks") return `
          let refs = [], cursor = 0, mounted = false, cleanup;
          export function useRef(initial) { return refs[cursor++] ??= { current: initial }; }
          export function useEffect(setup) { if (!mounted) { mounted = true; cleanup = setup(); } }
          export function beginRender() { cursor = 0; }
          export function resetHook() { cleanup?.(); refs = []; cursor = 0; mounted = false; cleanup = null; }
          export function hookWriting() { return refs.at(-1)?.current === true; }
        `;
        if (id === "\0test:bridge-status") return `
          const listeners = new Set();
          export function subscribeBridgeStatus(listener) { listeners.add(listener); listener(null); return () => listeners.delete(listener); }
          export function emitBridge(activeProfile) { for (const listener of listeners) listener({ activeProfile }); }
        `;
      },
      transform(source, id) {
        if (id.replaceAll("\\", "/") !== controllerPath) return null;
        // Only inject device setup/observability. All staging, Games apply and
        // flash code below is the real controller, bundled by the normal toolchain.
        return source.replace(
          "export function pushToast(kind: ToastKind, title: string, detail?: string, options: ToastOptions = {}): void {",
          "$&\n  testToastLog.push({ kind, title, detail });",
        ) + `
        import { useBridgeProfileApplier } from "../app/useBridgeProfileApplier";
        import { beginRender, resetHook, hookWriting } from "test:bridge-hooks";
        import { emitBridge } from "test:bridge-status";
        export const testToastLog = [];
        export async function testConnect(device) {
          resetHook(); testToastLog.length = 0;
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
        export function testBridgePoll(profile) {
          beginRender(); useBridgeProfileApplier(getSnapshot()); emitBridge(profile);
        }
        export function testRejectNextStatusRead() {
          const read = active.readStatus.bind(active);
          active.readStatus = async () => {
            active.readStatus = read;
            throw new Error("Injected post-write status failure.");
          };
        }
        export { hookWriting as testBridgeWriting };
        export { snapshotDiff as testSnapshotDiff, pickSnapshot as testPickSnapshot,
          mergeSnapshots as testMergeSnapshots } from "./game-profile-snapshot.ts";
        `;
      } }],
    build: { write: false, minify: false, lib: { entry: controllerPath, formats: ["es"] },
      rollupOptions: { output: { inlineDynamicImports: true } } },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(entry => entry.output);
  const code = output.find((entry: any) => entry.type === "chunk").code + "\n//# sourceURL=openmouse-controller-test.mjs";
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

function ignoreWrites(mouse: ReturnType<typeof fixture>, command = 1) {
  let ignored = true;
  const send = mouse.device.sendFeatureReport;
  mouse.device.sendFeatureReport = async (id, report) => {
    const original = structuredClone(mouse.banks[0]);
    await send(id, report);
    if (ignored && report[4] === 1 && report[5] === command) Object.assign(mouse.banks[0], original);
  };
  return () => { ignored = false; };
}

function game(name: string, snapshot: BridgeProfile["settings"]["snapshot"], deviceName: string): BridgeProfile {
  return { application: { name, executable: `${name}.exe`, path: `${name}.exe` },
    device: { id: "test-mouse", name: deviceName }, settings: { dpi: null, pollingRateHz: null, snapshot } };
}

async function bridgePoll(profile: BridgeProfile | null): Promise<void> {
  controller.testBridgePoll(profile);
  for (let step = 0; step < 1000 && controller.testBridgeWriting(); step++) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(controller.testBridgeWriting(), false, "the hook must release its writing guard");
}

function bridgeSuccessNotices() {
  return controller.testToastLog.filter((toast: { title: string }) =>
    toast.title === "Applied game profile" || toast.title === "Restored your previous mouse settings");
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

for (const pid of [0x32, 0x33, 0x54, 0x84]) {
  test(`controller on ${pid.toString(16)} reports a rejected Games table and retries without losing user edits`, async () => {
    const mouse = fixture(pid);
    const before = await controller.testConnect(mouse.device);
    const first = { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] };
    const second = { dpiStages: [400, 1400, 1600], dpiStagesY: [800, 2800, 3200] };
    const prior = controller.testPickSnapshot(before, first);
    assert.equal(await controller.flashGameProfileSnapshot(first), "written");
    const toWrite = controller.testMergeSnapshots(prior, second, controller.testState().status);
    controller.applyLunaFuryDpiStageAxes(0, 600, 1200);
    const allowWrites = ignoreWrites(mouse);
    assert.equal(await controller.flashGameProfileSnapshot(toWrite), "failed");
    assert.match(controller.testState().error, /did not confirm the complete stored DPI table/);
    assert.deepEqual(controller.testState().status.dpiStages, first.dpiStages);
    assert.deepEqual(controller.testState().status.dpiStagesY, first.dpiStagesY);
    assert.deepEqual(controller.testState().pending, ["dpi-stage-0"]);
    assert.deepEqual(controller.testState().preview.dpiStages, [600, 1200, 1600]);
    allowWrites();
    assert.equal(await controller.flashGameProfileSnapshot(toWrite), "written");
    assert.deepEqual(controller.testState().status.dpiStages, second.dpiStages);
    assert.deepEqual(controller.testState().status.dpiStagesY, second.dpiStagesY);
    assert.deepEqual(controller.testState().pending, ["dpi-stage-0"]);
    assert.equal(await controller.flashPendingChanges(), "written");
    assert.equal(mouse.banks[0].table[0], 600);
    assert.equal(await controller.flashPendingChanges(), "unchanged");
  });

  test(`controller on ${pid.toString(16)} reports failed restore and retries the complete original storage`, async () => {
    const mouse = fixture(pid);
    const before = await controller.testConnect(mouse.device);
    const original = structuredClone(mouse.banks[0]);
    const target = { dpiStages: [400, 1200, 1600, 2000], dpiStagesY: [800, 2400, 3200, 4000], activeDpiStage: 3 };
    const prior = controller.testPickSnapshot(before, target);
    assert.equal(await controller.flashGameProfileSnapshot(target), "written");
    const allowWrites = ignoreWrites(mouse);
    assert.equal(await controller.flashGameProfileSnapshot(prior), "failed");
    assert.match(controller.testState().error, /did not confirm/);
    assert.notEqual(mouse.banks[0].active, original.active, "a driver clamp is not the original selection being restored");
    assert.equal(mouse.banks[0].count, 4);
    assert.deepEqual(controller.testState().pending, []);
    allowWrites();
    assert.equal(await controller.flashGameProfileSnapshot(prior), "written");
    assert.deepEqual(mouse.banks[0], original);
    assert.equal(await controller.flashGameProfileSnapshot(prior), "unchanged");
  });
}

test("controller keeps a failed batch failed when another flash was queued", async () => {
  const mouse = fixture();
  await controller.testConnect(mouse.device);
  controller.applyLunaFuryDpiStageAxes(1, 1200, 2400);
  const allowWrites = ignoreWrites(mouse);
  const send = mouse.device.sendFeatureReport;
  let queued: unknown;
  let didQueue = false;
  mouse.device.sendFeatureReport = async (id, report) => {
    if (report[4] === 1 && report[5] === 1 && !didQueue) {
      didQueue = true;
      queued = await controller.flashPendingChanges();
    }
    await send(id, report);
  };
  assert.equal(await controller.flashPendingChanges(), "failed");
  assert.equal(queued, "busy");
  assert.deepEqual(controller.testState().pending, ["dpi-stage-1"]);
  assert.equal(mouse.sent.filter(packet => packet[4] === 1 && packet[5] === 1).length, 1);
  allowWrites();
  assert.equal(await controller.flashPendingChanges(), "written");
  assert.deepEqual(controller.testState().pending, []);
});

for (const games of [false, true]) {
  test(`controller reports post-write status failure for ${games ? "Games" : "manual Apply"} and permits retry`, async () => {
    const mouse = fixture();
    await controller.testConnect(mouse.device);
    controller.testRejectNextStatusRead();
    const target = { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] };
    if (!games) controller.applyLunaFuryDpiStageAxes(1, 1200, 2400);
    assert.equal(await (games ? controller.flashGameProfileSnapshot(target) : controller.flashPendingChanges()), "failed");
    assert.equal(mouse.banks[0].table[2], 1200, "the write may land before readback fails");
    assert.match(controller.testState().error, /Injected post-write status failure/);
    assert.equal(controller.getSnapshot().settingInProgress, false);
    assert.equal(controller.testToastLog.some((toast: { kind: string }) => toast.kind === "success"), false);
    assert.equal(await controller.flashGameProfileSnapshot(target), "written");
    assert.deepEqual(controller.testState().status.dpiStages, target.dpiStages);
    assert.deepEqual(controller.testState().status.dpiStagesY, target.dpiStagesY);
  });
}

test("controller restores the user's stash even if Games staging unexpectedly throws", async () => {
  const mouse = fixture();
  await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  controller.applyLunaFuryDpiStageAxes(0, 600, 1200);
  const target = { dpiStages: [400, 1200, 1600], get pollingRateHz() { throw new Error("Injected staging failure."); } };
  assert.equal(await controller.flashGameProfileSnapshot(target), "failed");
  assert.deepEqual(mouse.banks[0], original);
  assert.deepEqual(controller.testState().pending, ["dpi-stage-0"]);
  assert.deepEqual(controller.testState().preview.dpiStages, [600, 800, 1600]);
  assert.match(controller.testState().error, /Injected staging failure/);
});

test("Bridge retries the same failed game switch and deduplicates only confirmed success", async () => {
  const mouse = fixture();
  const before = await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  const first = game("A", { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] }, before.name);
  const second = game("B", { dpiStages: [400, 1400, 1600], dpiStagesY: [800, 2800, 3200] }, before.name);
  await bridgePoll(first);
  controller.testToastLog.length = 0;
  const allowWrites = ignoreWrites(mouse);
  await bridgePoll(second);
  assert.equal(mouse.banks[0].table[2], 1200);
  assert.match(controller.testState().error, /did not confirm/);
  assert.deepEqual(bridgeSuccessNotices(), []);
  allowWrites();
  await bridgePoll(second);
  assert.equal(mouse.banks[0].table[2], 1400);
  assert.equal(bridgeSuccessNotices().length, 1);
  const sent = mouse.sent.length;
  await bridgePoll(second);
  assert.equal(mouse.sent.length, sent);
  assert.equal(bridgeSuccessNotices().length, 1);
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[0], original);
});

test("Bridge keeps its original backup after restore fails and retries on the next poll", async () => {
  const mouse = fixture();
  const before = await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  await bridgePoll(game("A", { dpiStages: [400, 1200, 1600, 2000], dpiStagesY: [800, 2400, 3200, 4000], activeDpiStage: 3 }, before.name));
  const allowWrites = ignoreWrites(mouse);
  controller.testToastLog.length = 0;
  await bridgePoll(null);
  assert.equal(mouse.banks[0].count, 4);
  assert.notEqual(mouse.banks[0].active, original.active);
  assert.deepEqual(bridgeSuccessNotices(), []);
  allowWrites();
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[0], original);
  assert.equal(bridgeSuccessNotices().length, 1);
  const sent = mouse.sent.length;
  await bridgePoll(null);
  assert.equal(mouse.sent.length, sent, "clear the backup only after a confirmed restore");
});

test("Bridge restores a partial first application even when no game signature was confirmed", async () => {
  const mouse = fixture();
  mouse.banks[0].axes = false;
  const before = await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  const allowWrites = ignoreWrites(mouse);
  await bridgePoll(game("A", { dpiStages: [400, 1200, 1600], lunafury: { separateDpiAxes: true } }, before.name));
  assert.equal(mouse.banks[0].axes, true, "the first batch landed before the DPI write failed");
  assert.equal(mouse.banks[0].table[2], 800);
  assert.match(controller.testState().error, /did not confirm/);
  assert.deepEqual(bridgeSuccessNotices(), []);
  allowWrites();
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[0], original);
  assert.equal(bridgeSuccessNotices().length, 1);
});

test("Bridge retains backup through a partial restore and retries its remaining axis change", async () => {
  const mouse = fixture();
  mouse.banks[0].axes = false;
  const before = await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  await bridgePoll(game("A", { dpiStages: [400, 1200, 1600], lunafury: { separateDpiAxes: true } }, before.name));
  const allowWrites = ignoreWrites(mouse, 13);
  controller.testToastLog.length = 0;
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[0].table, original.table, "the DPI restore landed before the axis-mode failure");
  assert.equal(mouse.banks[0].axes, true);
  assert.deepEqual(bridgeSuccessNotices(), []);
  allowWrites();
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[0], original);
  assert.equal(bridgeSuccessNotices().length, 1);
});

test("Bridge invalidates the previous signature after a partial switch fails", async () => {
  const mouse = fixture();
  const before = await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  const first = game("A", { dpiStages: [400, 1200, 1600] }, before.name);
  const second = game("B", { dpiStages: [400, 1400, 1600], lunafury: { separateDpiAxes: false } }, before.name);
  await bridgePoll(first);
  const allowWrites = ignoreWrites(mouse, 13);
  controller.testToastLog.length = 0;
  await bridgePoll(second);
  assert.equal(mouse.banks[0].table[2], 1400, "the DPI write landed before B's axis-mode failure");
  assert.deepEqual(bridgeSuccessNotices(), []);
  allowWrites();
  await bridgePoll(first);
  assert.equal(mouse.banks[0].table[2], 1200, "A must not be skipped using its old confirmed signature");
  assert.equal(bridgeSuccessNotices().length, 1);
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[0], original);
});

test("Bridge retries a busy game application after the draft closes", async () => {
  const mouse = fixture();
  const before = await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  const target = game("A", { dpiStages: [400, 1200, 1600] }, before.name);
  assert.equal(controller.beginGameProfileDraft({}), true);
  await bridgePoll(target);
  assert.deepEqual(mouse.banks[0], original);
  assert.deepEqual(bridgeSuccessNotices(), []);
  controller.endGameProfileDraft();
  await bridgePoll(target);
  assert.equal(mouse.banks[0].table[2], 1200);
  assert.equal(bridgeSuccessNotices().length, 1);
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[0], original);
});

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

for (const pid of [0x32, 0x33, 0x54, 0x84]) {
  test(`controller game switch on ${pid.toString(16)} keeps DPI shared by both games`, async () => {
    const { device, banks, sent } = fixture(pid);
    const before = await controller.testConnect(device);
    const original = [...banks[0].table];
    const first = { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] };
    const second = { ...first, activeDpiStage: 2 };
    const prior = controller.testPickSnapshot(before, first);
    await controller.flashGameProfileSnapshot(first);
    const afterFirst = controller.testState().status;
    const allPrior = controller.testMergeSnapshots(controller.testPickSnapshot(afterFirst, second), prior, afterFirst);
    const toWrite = controller.testMergeSnapshots(prior, second, afterFirst);
    const start = sent.length;
    assert.equal(await controller.flashGameProfileSnapshot(toWrite), "written");
    assert.deepEqual(controller.testState().status.dpiStages, second.dpiStages);
    assert.deepEqual(controller.testState().status.dpiStagesY, second.dpiStagesY);
    assert.equal(banks[0].active, 3);
    assert.equal(sent.slice(start).some(packet => packet[4] === 1 && packet[5] === 1), false,
      "a shared final table needs no restore-then-rewrite");
    assert.equal(controller.testState().error, null);
    await controller.flashGameProfileSnapshot(allPrior);
    assert.deepEqual(banks[0].table, original); assert.equal(banks[0].count, 3); assert.equal(banks[0].active, 2);
    assert.equal(controller.testState().error, null);
  });

  test(`controller game switch on ${pid.toString(16)} retains four stages while editing the fourth`, async () => {
    const { device, banks, sent } = fixture(pid);
    const before = await controller.testConnect(device);
    const original = [...banks[0].table];
    const first = { dpiStages: [400, 800, 1600, 2000], dpiStagesY: [800, 1600, 3200, 4000] };
    const second = { dpiStages: [400, 800, 1600, 2400], dpiStagesY: [800, 1600, 3200, 4800], activeDpiStage: 3 };
    const prior = controller.testPickSnapshot(before, first);
    await controller.flashGameProfileSnapshot(first);
    const afterFirst = controller.testState().status;
    const allPrior = controller.testMergeSnapshots(controller.testPickSnapshot(afterFirst, second), prior, afterFirst);
    const start = sent.length;
    await controller.flashGameProfileSnapshot(controller.testMergeSnapshots(prior, second, afterFirst));
    assert.equal(controller.testState().error, null);
    assert.equal(banks[0].count, 4); assert.equal(banks[0].active, 4);
    assert.deepEqual(controller.testState().status.dpiStages, second.dpiStages);
    assert.deepEqual(controller.testState().status.dpiStagesY, second.dpiStagesY);
    assert.deepEqual(banks[0].table, [400, 800, 800, 1600, 1600, 3200, 2400, 4800, ...original.slice(8)]);
    assert.deepEqual(sent.slice(start).filter(packet => packet[4] === 1 && packet[5] === 1).map(packet => packet[7]), [4],
      "write the final count/table without an intermediate three-stage restore");
    await controller.flashGameProfileSnapshot(allPrior);
    assert.deepEqual(banks[0].table, original); assert.equal(banks[0].count, 3); assert.equal(banks[0].active, 2);
    assert.equal(controller.testState().error, null);
  });

  test(`controller game switch on ${pid.toString(16)} reduces max stages to four without writing disabled slots`, async () => {
    const { device, banks, sent } = fixture(pid);
    const before = await controller.testConnect(device);
    const original = [...banks[0].table];
    const max = before.ui.dpiStageEditor.maxStages;
    const first = { dpiStages: [400, 800, 1600, 2000, 4000, 8000].slice(0, max),
      dpiStagesY: [800, 1600, 3200, 4000, 8000, 16000].slice(0, max) };
    const second = { dpiStages: [400, 800, 1600, 2400], dpiStagesY: [800, 1600, 3200, 4800], activeDpiStage: 3 };
    const prior = controller.testPickSnapshot(before, first);
    await controller.flashGameProfileSnapshot(first);
    assert.equal(banks[0].count, max);
    const afterFirst = controller.testState().status;
    const allPrior = controller.testMergeSnapshots(controller.testPickSnapshot(afterFirst, second), prior, afterFirst);
    const start = sent.length;
    await controller.flashGameProfileSnapshot(controller.testMergeSnapshots(prior, second, afterFirst));
    assert.equal(controller.testState().error, null);
    assert.equal(banks[0].count, 4); assert.equal(banks[0].active, 4);
    assert.deepEqual(controller.testState().status.dpiStages, second.dpiStages);
    assert.deepEqual(controller.testState().status.dpiStagesY, second.dpiStagesY);
    assert.deepEqual(banks[0].table, [400, 800, 800, 1600, 1600, 3200, 2400, 4800, ...original.slice(8)]);
    assert.deepEqual(sent.slice(start).filter(packet => packet[4] === 1 && packet[5] === 1).map(packet => packet[7]), [4]);
    await controller.flashGameProfileSnapshot(allPrior);
    assert.deepEqual(banks[0].table, original); assert.equal(banks[0].count, 3); assert.equal(banks[0].active, 2);
    assert.equal(controller.testState().error, null);
  });
}
