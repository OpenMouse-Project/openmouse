import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { build } from "vite";
import type { BridgeProfile } from "../src/bridge.ts";
import { getDfuInfo, type FirmwareManifest } from "../src/device/firmware-updates.ts";

let controller: any;
const controllerPath = fileURLToPath(new URL("../src/device/controller.ts", import.meta.url)).replaceAll("\\", "/");
const bridgeHookPath = fileURLToPath(new URL("../src/app/useBridgeProfileApplier.ts", import.meta.url)).replaceAll("\\", "/");
const dpiEditorPath = fileURLToPath(new URL("../src/app/cards/LunaFuryDpiEditor.tsx", import.meta.url)).replaceAll("\\", "/");

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
        if (id === "../ui" && importer?.replaceAll("\\", "/") === dpiEditorPath) return "\0test:dpi-ui";
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
          export function useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; }
          export function beginRender() { cursor = 0; }
          export function resetHook() { cleanup?.(); refs = []; cursor = 0; mounted = false; cleanup = null; }
          export function hookWriting() { return refs.at(-1)?.current === true; }
        `;
        // Keep the editor's real event handlers; shared widgets need no DOM here.
        if (id === "\0test:dpi-ui") return `export const OptionMenu = "OptionMenu", StepperSlider = "StepperSlider", SwitchRow = "SwitchRow";`;
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
        export async function testConnect(device, preserveSessions = false) {
          if (!preserveSessions) resetHook();
          testToastLog.length = 0;
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
        export function testFailStatusReads() {
          const read = active.readStatus.bind(active);
          let failing = true, attempts = 0;
          active.readStatus = async () => {
            attempts++;
            if (failing) throw new Error("Injected persistent status failure.");
            return read();
          };
          return { allow: () => { failing = false; }, attempts: () => attempts };
        }
        export function testDeferNextStatusRead() {
          const client = active, read = client.readStatus.bind(client);
          let release, started = false;
          const gate = new Promise(resolve => { release = resolve; });
          client.readStatus = async () => {
            client.readStatus = read; started = true;
            await gate;
            return read();
          };
          return { release: () => release(), started: () => started };
        }
        export async function testConnectGeneric(device) {
          const template = await testConnect(device);
          const stored = { ...template, brand: "Generic", name: "Generic test mouse",
            dpi: 800, dpiY: 800, dpiStages: undefined, dpiStagesY: undefined,
            activeDpiStage: undefined, lunafury: undefined, ui: undefined };
          const writes = [];
          let reads = 0;
          active = { device, getDpiOptions: () => [400, 800, 1200, 1600],
            readStatus: async () => { reads++; return structuredClone(stored); },
            setDpi: async (dpi) => { writes.push(dpi); stored.dpi = stored.dpiY = dpi; },
            setPollingRate: async (rate) => { stored.pollingRateHz = rate; } };
          applyStatus(await active.readStatus());
          return { stored, writes, reads: () => reads };
        }
        export async function testConnectGenericStages(device) {
          const generic = await testConnectGeneric(device), stored = generic.stored;
          stored.dpiStages = [400, 800, 1600, 3200, 6400, 8000];
          stored.activeDpiStage = 1;
          stored.ui = { dpiStageEditor: { maxStages: 6, countEditable: true } };
          dpiOptions = [400, 800, 1200, 1600, 2400, 3200, 4800, 6400, 8000];
          active.setDpiStageCount = async count => {
            generic.writes.push({ count });
            stored.dpiStages = count <= stored.dpiStages.length
              ? stored.dpiStages.slice(0, count)
              : [...stored.dpiStages, ...Array(count - stored.dpiStages.length).fill(3200)];
            stored.activeDpiStage = Math.min(stored.activeDpiStage, count - 1);
            stored.dpi = stored.dpiStages[stored.activeDpiStage];
          };
          active.setDpiStageValue = async (stage, dpi) => {
            if (stage >= stored.dpiStages.length) throw new Error("Generic stage is not enabled.");
            generic.writes.push({ stage, dpi });
            stored.dpiStages[stage] = dpi;
          };
          applyStatus(await active.readStatus());
          return generic;
        }
        export { refreshStatus as testRefreshStatus };
        export function testClientOnly() { activeDevice = null; }
        export { hookWriting as testBridgeWriting };
        export { LunaFuryDpiEditor as testDpiEditor } from "../app/cards/LunaFuryDpiEditor";
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

function dpiEditorNodes(status: unknown): any[] {
  const root = controller.testDpiEditor({ snapshot: { status, preferences: { locale: "en" },
    capabilities: { dpiStagesWritable: true, activeDpiStageWritable: true } } });
  const nodes: any[] = [];
  const visit = (node: any) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node?.props) return;
    nodes.push(node); visit(node.props.children);
  };
  visit(root);
  return nodes;
}

for (const pid of [0x32, 0x33, 0x54, 0x84]) {
  test(`firmware manifest matches actual protocol readouts on ${pid.toString(16)}`, async () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/firmware-manifest.json", import.meta.url), "utf8")) as FirmwareManifest;
    const wireless = pid === 0x33 || pid === 0x84;
    const latest = pid === 0x32 || pid === 0x33 ? [25, 0] : [1, 47];
    const older = latest[1] > 0 ? [latest[0], latest[1] - 1] : [latest[0] - 1, 0];
    const newer = [latest[0] + 1, latest[1]];
    for (const [mouseVersion, dongleVersion, entity] of [
      [latest, latest, null], [newer, newer, null],
      [older, latest, "Mouse"], [latest, older, wireless ? "Dongle" : null],
    ] as const) {
      const mouse = fixture(pid), receive = mouse.device.receiveFeatureReport;
      mouse.device.receiveFeatureReport = async () => {
        const reply = await receive(), packet = mouse.sent.at(-1)!;
        if (packet[4] === 0 && packet[5] === 0x81) {
          const version = wireless && packet[2] === 0 ? dongleVersion : mouseVersion;
          new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength).set([0, 0, ...version], 6);
        }
        return reply;
      };
      const status = await controller.testConnect(mouse.device);
      assert.deepEqual(status.firmware, wireless
        ? [`Mouse ${mouseVersion.join(".")}`, `Dongle ${dongleVersion.join(".")}`]
        : [`Mouse ${mouseVersion.join(".")}`]);
      const info = getDfuInfo({ ...status, interfaceId: `373e_${pid.toString(16).padStart(4, "0")}` }, manifest);
      assert.equal(info?.latestVersion, latest.join("."));
      assert.equal(info?.dfuAvailable, entity !== null);
      if (entity !== null) assert.equal(info?.entityName, entity);
    }
  });

  for (const input of ["slider", "number"]) {
    test(`DPI editor ${input} on ${pid.toString(16)} preserves Y after an axis-mode read failure`, async () => {
      const mouse = fixture(pid), receive = mouse.device.receiveFeatureReport;
      mouse.device.receiveFeatureReport = async () => {
        const request = mouse.sent.at(-1)!;
        if (request[4] === 1 && request[5] === 0x8d) throw new Error("Injected axis-mode read failure.");
        return receive();
      };
      const before = await controller.testConnect(mouse.device);
      assert.equal(before.lunafury.separateDpiAxes, undefined);
      const original = [...mouse.banks[0].table];
      const nodes = dpiEditorNodes(before);
      if (input === "slider") nodes.find(node => node.props.id === "lunafury-dpi-x").props.onCommit(1200);
      else nodes.filter(node => node.type === "input")[1].props.onfocusout({ currentTarget: { value: "1200" } });
      assert.equal(await controller.flashPendingChanges(), "written");
      assert.deepEqual(mouse.banks[0].table, [...original.slice(0, 2), 1200, ...original.slice(3)]);
    });
  }

  test(`numeric DPI stage edits on ${pid.toString(16)} respect LunaFury axis mode`, async () => {
    for (const separate of [false, true, undefined]) {
      const mouse = fixture(pid), receive = mouse.device.receiveFeatureReport;
      mouse.banks[0].axes = separate !== false;
      mouse.device.receiveFeatureReport = async () => {
        const request = mouse.sent.at(-1)!;
        if (separate === undefined && request[4] === 1 && request[5] === 0x8d) {
          throw new Error("Injected axis-mode read failure.");
        }
        return receive();
      };
      const before = await controller.testConnect(mouse.device);
      assert.equal(before.lunafury.separateDpiAxes, separate);
      const y = separate === false ? 1200 : before.dpiStagesY[1];
      controller.applyDpiStageValue(1, 1200);
      const preview = controller.testState().preview;
      assert.deepEqual([preview.dpiStages[1], preview.dpiStagesY[1]], [1200, y]);
      assert.equal(await controller.flashPendingChanges(), "written");
      assert.deepEqual(mouse.banks[0].table.slice(2, 4), [1200, y]);
    }
  });

  test(`Bridge on ${pid.toString(16)} applies and restores Games separately for each onboard bank`, async () => {
    const mouse = fixture(pid);
    mouse.banks[1].table[2] = 1000; mouse.banks[1].table[3] = 2000;
    const original = structuredClone(mouse.banks);
    const before = await controller.testConnect(mouse.device);
    const profile = game("A", { dpi: 1200 }, before.name);
    await bridgePoll(profile);
    assert.equal(mouse.banks[0].table[2], 1200);
    controller.applyProfileSelection(2);
    assert.equal(await controller.flashPendingChanges(), "written");
    await bridgePoll(profile);
    assert.equal(mouse.banks[1].table[2], 1200, "the same game must also apply to the newly selected bank");
    assert.equal(mouse.banks[1].table[3], 2000);
    await bridgePoll(null);
    assert.deepEqual(mouse.banks[1], original[1]);
    assert.equal(mouse.banks[0].table[2], 1200, "do not switch the selected bank during restoration");
    controller.applyProfileSelection(1);
    assert.equal(await controller.flashPendingChanges(), "written");
    await bridgePoll(null);
    assert.deepEqual(mouse.banks, original, "the inactive bank's backup must survive until it is selected again");
    assert.equal(controller.testState().error, null);
    assert.equal(bridgeSuccessNotices().length, 4);
  });
}

for (const separate of [false, true]) {
  test(`DPI editor respects a confirmed ${separate ? "independent" : "linked"} axis mode`, async () => {
    const mouse = fixture(); mouse.banks[0].axes = separate;
    const before = await controller.testConnect(mouse.device);
    dpiEditorNodes(before).find(node => node.props.id === "lunafury-dpi-x").props.onCommit(1200);
    assert.equal(await controller.flashPendingChanges(), "written");
    assert.deepEqual(mouse.banks[0].table.slice(2, 4), [1200, separate ? 1600 : 1200]);
  });
}

test("Bridge keeps bank backups through a failed restore and a visit to another bank", async () => {
  const mouse = fixture(), original = structuredClone(mouse.banks);
  const before = await controller.testConnect(mouse.device);
  const profile = game("A", { dpi: 1200 }, before.name);
  await bridgePoll(profile);
  const allowWrites = ignoreWrites(mouse);
  await bridgePoll(null);
  assert.equal(mouse.banks[0].table[2], 1200);
  controller.applyProfileSelection(2);
  assert.equal(await controller.flashPendingChanges(), "written");
  await bridgePoll(profile);
  assert.equal(mouse.banks[1].table[2], 1200);
  await bridgePoll(null);
  assert.deepEqual(mouse.banks[1], original[1]);
  controller.applyProfileSelection(1);
  assert.equal(await controller.flashPendingChanges(), "written");
  allowWrites();
  await bridgePoll(null);
  assert.deepEqual(mouse.banks, original);
});

test("Bridge keeps separate backups for two mice with the same name and bank number", async () => {
  const first = fixture(), second = fixture();
  second.banks[0].table[2] = 1000; second.banks[0].table[3] = 2000;
  const originals = [structuredClone(first.banks), structuredClone(second.banks)];
  const before = await controller.testConnect(first.device);
  const profile = game("A", { dpi: 1200 }, before.name);
  await bridgePoll(profile);
  await controller.testConnect(second.device, true);
  await bridgePoll(null);
  assert.deepEqual(second.banks, originals[1], "the first mouse's backup must not reach the second mouse");
  await bridgePoll(profile);
  assert.equal(second.banks[0].table[2], 1200);
  await bridgePoll(null);
  assert.deepEqual(second.banks, originals[1]);
  await controller.testConnect(first.device, true);
  await bridgePoll(null);
  assert.deepEqual(first.banks, originals[0]);
  assert.equal(controller.testState().error, null);
});

test("Games rejects a saved scope after the selected bank or device changes", async () => {
  const mouse = fixture();
  await controller.testConnect(mouse.device);
  const scope = controller.currentGameProfileScope();
  controller.applyProfileSelection(2);
  assert.equal(await controller.flashPendingChanges(), "written");
  const sent = mouse.sent.length;
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }, scope), "busy");
  assert.equal(mouse.sent.length, sent);
  const other = fixture();
  await controller.testConnect(other.device, true);
  const otherSent = other.sent.length;
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }, scope), "busy");
  assert.equal(other.sent.length, otherSent);
});

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
    const start = mouse.sent.length;
    assert.equal(await controller.flashGameProfileSnapshot(target), "unchanged",
      "fresh read confirms the first write landed, so retry needs no duplicate write");
    assert.equal(mouse.sent.slice(start).some(packet => packet[5] < 0x80), false);
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

for (const pid of [0x32, 0x33, 0x54, 0x84]) {
  test(`Bridge on ${pid.toString(16)} restores after apply lands but final read fails`, async () => {
    const mouse = fixture(pid);
    const before = await controller.testConnect(mouse.device);
    const original = structuredClone(mouse.banks[0]);
    controller.testRejectNextStatusRead();
    await bridgePoll(game("A", { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] }, before.name));
    assert.equal(mouse.banks[0].table[2], 1200);
    assert.equal(controller.testState().status.dpiStages[1], 800, "cache predates the unconfirmed write");
    assert.deepEqual(bridgeSuccessNotices(), []);
    await bridgePoll(null);
    assert.deepEqual(mouse.banks[0], original, "do not clear backup using the stale original-looking cache");
    const sent = mouse.sent.length;
    await controller.testRefreshStatus();
    await bridgePoll(null);
    assert.deepEqual(mouse.banks[0], original);
    assert.equal(mouse.sent.slice(sent).some(packet => packet[5] < 0x80), false);
    assert.equal(bridgeSuccessNotices().length, 1);
  });

  test(`Bridge on ${pid.toString(16)} reapplies after restore lands but final read fails`, async () => {
    const mouse = fixture(pid);
    const before = await controller.testConnect(mouse.device);
    const original = structuredClone(mouse.banks[0]);
    const target = game("A", { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] }, before.name);
    await bridgePoll(target);
    controller.testToastLog.length = 0;
    controller.testRejectNextStatusRead();
    await bridgePoll(null);
    assert.deepEqual(mouse.banks[0], original);
    assert.equal(controller.testState().status.dpiStages[1], 1200, "cache still looks like game A");
    assert.deepEqual(bridgeSuccessNotices(), []);
    await bridgePoll(target);
    assert.equal(mouse.banks[0].table[2], 1200, "do not record A's signature using the stale game-looking cache");
    assert.equal(mouse.banks[0].table[3], 2400);
    const sent = mouse.sent.length;
    await controller.testRefreshStatus();
    await bridgePoll(target);
    assert.equal(mouse.banks[0].table[2], 1200);
    assert.equal(mouse.sent.slice(sent).some(packet => packet[5] < 0x80), false);
    assert.equal(bridgeSuccessNotices().length, 1);
    await bridgePoll(null);
    assert.deepEqual(mouse.banks[0], original);
  });
}

for (const failedRestore of [false, true]) {
  test(`Bridge preserves retry state while refresh keeps failing after ${failedRestore ? "restore" : "apply"}`, async () => {
    const mouse = fixture();
    const before = await controller.testConnect(mouse.device);
    const original = structuredClone(mouse.banks[0]);
    const target = game("A", { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] }, before.name);
    if (failedRestore) await bridgePoll(target);
    const fault = controller.testFailStatusReads();
    controller.testToastLog.length = 0;
    await bridgePoll(failedRestore ? null : target);
    const afterUnconfirmedWrite = structuredClone(mouse.banks[0]);
    const sent = mouse.sent.length;
    for (let poll = 0; poll < 3; poll++) {
      await controller.testRefreshStatus();
      await bridgePoll(failedRestore ? target : null);
      assert.deepEqual(mouse.banks[0], afterUnconfirmedWrite);
      assert.deepEqual(bridgeSuccessNotices(), []);
      assert.equal(mouse.sent.length, sent, "no speculative write without a successful status refresh");
    }
    assert.equal(fault.attempts(), 7, "one final read plus three background and three foreground retries");
    fault.allow();
    await bridgePoll(failedRestore ? target : null);
    if (failedRestore) {
      assert.equal(mouse.banks[0].table[2], 1200);
      assert.equal(mouse.banks[0].table[3], 2400);
      await bridgePoll(null);
    }
    assert.deepEqual(mouse.banks[0], original, "retained originals remain restorable after recovery");
  });
}

test("controller does not report an empty manual Apply unchanged until status is confirmed", async () => {
  const mouse = fixture();
  await controller.testConnect(mouse.device);
  const fault = controller.testFailStatusReads();
  controller.applyLunaFuryDpiStageAxes(1, 1200, 2400);
  assert.equal(await controller.flashPendingChanges(), "failed");
  assert.deepEqual(controller.testState().pending, []);
  assert.equal(await controller.flashPendingChanges(), "failed");
  fault.allow();
  const sent = mouse.sent.length;
  assert.equal(await controller.flashPendingChanges(), "unchanged");
  assert.equal(controller.testState().status.dpiStages[1], 1200);
  assert.equal(mouse.sent.slice(sent).some(packet => packet[5] < 0x80), false);
});

test("a same-JSON background read confirms an untrusted cache without another read or write", async () => {
  const mouse = fixture();
  await controller.testConnect(mouse.device);
  const original = structuredClone(mouse.banks[0]);
  ignoreWrites(mouse);
  const fault = controller.testFailStatusReads();
  assert.equal(await controller.flashGameProfileSnapshot({ dpiStages: [400, 1200, 1600] }), "failed");
  fault.allow();
  await controller.testRefreshStatus();
  assert.deepEqual(mouse.banks[0], original);
  const attempts = fault.attempts(), sent = mouse.sent.length;
  assert.equal(await controller.flashGameProfileSnapshot({ dpiStages: [400, 800, 1600] }), "unchanged");
  assert.equal(fault.attempts(), attempts, "a successful background read restores trust even when JSON did not change");
  assert.equal(mouse.sent.length, sent);
});

test("Bridge captures newly touched fields from the refreshed status after an unconfirmed write", async () => {
  const mouse = fixture();
  const generic = await controller.testConnectGeneric(mouse.device);
  const name = generic.stored.name;
  controller.testRejectNextStatusRead();
  await bridgePoll(game("A", { dpi: 1200 }, name));
  assert.equal(generic.stored.dpi, 1200);
  assert.equal(controller.testState().status.dpi, 800);
  generic.stored.pollingRateHz = 2000; // A did not touch this externally changed field.
  assert.equal(controller.testState().status.pollingRateHz, 1000);
  await bridgePoll(game("B", { dpi: 1200, pollingRateHz: 1000 }, name));
  assert.equal(generic.stored.pollingRateHz, 1000);
  await bridgePoll(null);
  assert.equal(generic.stored.dpi, 800, "A's accumulated original still wins for DPI");
  assert.equal(generic.stored.pollingRateHz, 2000, "B captures its newly touched field after refresh, not from stale cache");
});

test("generic scalar-DPI Games writes obey status trust and avoid redundant confirmed writes", async () => {
  const mouse = fixture();
  const generic = await controller.testConnectGeneric(mouse.device);
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }), "written");
  assert.deepEqual(generic.writes, [1200]);
  const reads = generic.reads();
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }), "unchanged");
  assert.equal(generic.reads(), reads);
  controller.testRejectNextStatusRead();
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 800 }), "failed");
  assert.equal(generic.stored.dpi, 800);
  const fault = controller.testFailStatusReads();
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }), "failed");
  assert.deepEqual(generic.writes, [1200, 800]);
  fault.allow();
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }), "written");
  assert.deepEqual(generic.writes, [1200, 800, 1200]);
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 800 }), "written");
});

test("manual staging does not drop an edit matching only the untrusted old cache", async () => {
  const mouse = fixture();
  const generic = await controller.testConnectGeneric(mouse.device);
  controller.testRejectNextStatusRead();
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }), "failed");
  assert.equal(controller.testState().status.dpi, 800);
  assert.equal(generic.stored.dpi, 1200);
  controller.applyDpiValue(800);
  assert.deepEqual(controller.testState().pending, ["dpi"]);
  assert.equal(await controller.flashPendingChanges(), "written");
  assert.equal(generic.stored.dpi, 800);
});

test("failed foreground refresh preserves pending edits, then confirmed recovery rebases their preview", async () => {
  const mouse = fixture();
  await controller.testConnect(mouse.device);
  controller.applyLunaFuryDpiStageAxes(0, 600, 1200);
  const fault = controller.testFailStatusReads();
  const target = { dpiStages: [400, 1200, 1600], dpiStagesY: [800, 2400, 3200] };
  assert.equal(await controller.flashGameProfileSnapshot(target), "failed");
  assert.equal(await controller.flashGameProfileSnapshot(target), "failed");
  assert.deepEqual(controller.testState().pending, ["dpi-stage-0"]);
  assert.deepEqual(controller.testState().preview.dpiStages, [600, 800, 1600]);
  fault.allow();
  assert.equal(await controller.flashGameProfileSnapshot(target), "unchanged");
  assert.deepEqual(controller.testState().pending, ["dpi-stage-0"]);
  assert.deepEqual(controller.testState().preview.dpiStages, [600, 1200, 1600]);
});

test("an in-flight foreground recovery blocks another Games attempt until the read completes", async () => {
  const mouse = fixture();
  const generic = await controller.testConnectGeneric(mouse.device);
  controller.testRejectNextStatusRead();
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }), "failed");
  const gate = controller.testDeferNextStatusRead();
  const first = controller.flashGameProfileSnapshot({ dpi: 1200 });
  assert.equal(gate.started(), true);
  try {
    assert.equal(await controller.flashGameProfileSnapshot({ dpi: 800 }), "busy");
    assert.deepEqual(generic.writes, [1200]);
  } finally {
    gate.release();
  }
  assert.equal(await first, "unchanged");
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 800 }), "written");
});

function dpiTableWrites(mouse: ReturnType<typeof fixture>, start = 0) {
  return mouse.sent.slice(start).filter(packet => packet[4] === 1 && packet[5] === 1);
}

async function unconfirmedCount(mouse: ReturnType<typeof fixture>, from: number, to: number) {
  mouse.banks[0].count = from;
  await controller.testConnect(mouse.device);
  controller.applyDpiStageCount(to);
  controller.testRejectNextStatusRead();
  assert.equal(await controller.flashPendingChanges(), "failed");
  assert.equal(mouse.banks[0].count, to);
  assert.equal(controller.testState().status.dpiStages.length, from);
}

for (const pid of [0x32, 0x33, 0x54, 0x84]) {
  const max = pid === 0x32 || pid === 0x33 ? 6 : 5;
  for (const background of [false, true]) {
    test(`manual count recovery on ${pid.toString(16)} expands before slot edits ${background ? "after background refresh" : "before refresh"}`, async () => {
      const mouse = fixture(pid);
      await unconfirmedCount(mouse, max, 3);
      const original = [...mouse.banks[0].table];
      controller.applyDpiStageCount(4);
      controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
      if (background) await controller.testRefreshStatus();
      const start = mouse.sent.length;
      assert.equal(await controller.flashPendingChanges(), "written");
      assert.equal(mouse.banks[0].count, 4);
      assert.deepEqual(mouse.banks[0].table, [...original.slice(0, 6), 2400, 4800, ...original.slice(8)]);
      assert.deepEqual(dpiTableWrites(mouse, start).map(packet => packet[7]), [4, 4]);
      assert.equal((dpiTableWrites(mouse, start)[0][20] << 8) | dpiTableWrites(mouse, start)[0][21], original[6],
        "the first write expands storage before the fourth-slot value changes");
      assert.deepEqual(controller.testState().pending, []);
      assert.equal(await controller.flashPendingChanges(), "unchanged");
    });
  }

  test(`manual count recovery on ${pid.toString(16)} edits before a recovered reduction`, async () => {
    const mouse = fixture(pid);
    await unconfirmedCount(mouse, 3, max);
    controller.applyDpiStageCount(4);
    controller.applyLunaFuryDpiStageAxes(1, 2400, 4800);
    const start = mouse.sent.length;
    assert.equal(await controller.flashPendingChanges(), "written");
    assert.deepEqual(dpiTableWrites(mouse, start).map(packet => packet[7]), [max, 4]);
    assert.equal(mouse.banks[0].count, 4);
    assert.deepEqual(mouse.banks[0].table.slice(2, 4), [2400, 4800]);
  });

  test(`manual count recovery on ${pid.toString(16)} preserves nonempty staging while reads keep failing`, async () => {
    const mouse = fixture(pid);
    await unconfirmedCount(mouse, max, 3);
    controller.applyDpiStageCount(4);
    controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
    const fault = controller.testFailStatusReads();
    const start = mouse.sent.length;
    controller.testToastLog.length = 0;
    for (let retry = 0; retry < 3; retry++) {
      assert.equal(await controller.flashPendingChanges(), "failed");
      assert.deepEqual(controller.testState().pending, ["dpi-stage-count", "dpi-stage-3"]);
      assert.equal(mouse.banks[0].count, 3);
      assert.equal(dpiTableWrites(mouse, start).length, 0);
      assert.equal(controller.getSnapshot().settingInProgress, false);
      assert.equal(controller.testToastLog.some((toast: { kind: string }) => toast.kind === "success"), false);
    }
    assert.equal(fault.attempts(), 3);
    fault.allow();
    assert.equal(await controller.flashPendingChanges(), "written");
    assert.equal(mouse.banks[0].count, 4);
    assert.deepEqual(mouse.banks[0].table.slice(6, 8), [2400, 4800]);
  });

  test(`manual count recovery on ${pid.toString(16)} retries a failed slot write after expansion landed`, async () => {
    const mouse = fixture(pid);
    await unconfirmedCount(mouse, max, 3);
    controller.applyDpiStageCount(4);
    controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
    const send = mouse.device.sendFeatureReport;
    let tables = 0, rejectSlot = true;
    mouse.device.sendFeatureReport = async (id, report) => {
      const original = structuredClone(mouse.banks[0]);
      await send(id, report);
      if (report[4] === 1 && report[5] === 1 && ++tables === 2 && rejectSlot) {
        Object.assign(mouse.banks[0], original);
      }
    };
    assert.equal(await controller.flashPendingChanges(), "failed");
    assert.equal(mouse.banks[0].count, 4, "expansion landed before the rejected slot edit");
    assert.deepEqual(controller.testState().pending, ["dpi-stage-3"]);
    rejectSlot = false;
    assert.equal(await controller.flashPendingChanges(), "written");
    assert.deepEqual(mouse.banks[0].table.slice(6, 8), [2400, 4800]);
    assert.deepEqual(controller.testState().pending, []);
  });

  test(`manual restaging on ${pid.toString(16)} drops edits and selection outside the final count`, async () => {
    const mouse = fixture(pid);
    await controller.testConnect(mouse.device);
    controller.applyDpiStageCount(max);
    controller.applyLunaFuryDpiStageAxes(max - 1, 2400, 4800);
    controller.applyActiveDpiStage(max - 1);
    controller.applyDpiStageCount(4);
    assert.deepEqual(controller.testState().pending, ["dpi-stage-count"]);
    controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
    controller.applyActiveDpiStage(3);
    // Re-selecting the same count must not discard a valid stage selection.
    controller.applyDpiStageCount(4);
    assert.equal(controller.testState().pending.includes("dpi-active-stage"), true);
    assert.equal(await controller.flashPendingChanges(), "written");
    assert.equal(mouse.banks[0].count, 4);
    assert.equal(mouse.banks[0].active, 4);
    assert.deepEqual(mouse.banks[0].table.slice(6, 8), [2400, 4800]);
  });

  test(`manual priorities on ${pid.toString(16)} survive a Games stash while hardware count changes`, async () => {
    const mouse = fixture(pid);
    mouse.banks[0].count = max;
    await controller.testConnect(mouse.device);
    controller.applyDpiStageCount(4);
    controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
    assert.equal(await controller.flashGameProfileSnapshot({
      dpiStages: [400, 800, 1600], dpiStagesY: [800, 1600, 3200],
    }), "written");
    assert.equal(mouse.banks[0].count, 3);
    assert.deepEqual(controller.testState().pending, ["dpi-stage-count", "dpi-stage-3"]);
    assert.equal(await controller.flashPendingChanges(), "written");
    assert.equal(mouse.banks[0].count, 4);
    assert.deepEqual(mouse.banks[0].table.slice(6, 8), [2400, 4800]);
  });
}

test("manual preflight retains its queue after an in-flight background read and foreground recovery both fail", async () => {
  const mouse = fixture();
  await unconfirmedCount(mouse, 6, 3);
  controller.applyDpiStageCount(4);
  controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
  const fault = controller.testFailStatusReads();
  const gate = controller.testDeferNextStatusRead();
  const start = mouse.sent.length;
  const background = controller.testRefreshStatus();
  const apply = controller.flashPendingChanges();
  try {
    assert.equal(await controller.flashPendingChanges(), "busy");
  } finally {
    gate.release();
  }
  await background;
  assert.equal(await apply, "failed");
  assert.equal(fault.attempts(), 2, "no post-write read or queued auto-retry when preflight failed");
  assert.equal(dpiTableWrites(mouse, start).length, 0);
  assert.deepEqual(controller.testState().pending, ["dpi-stage-count", "dpi-stage-3"]);
  assert.equal(controller.getSnapshot().settingInProgress, false);
  fault.allow();
  assert.equal(await controller.flashPendingChanges(), "written");
  assert.deepEqual(mouse.banks[0].table.slice(6, 8), [2400, 4800]);
});

test("nonempty manual Apply waits for an in-flight background read before resolving priorities", async () => {
  const mouse = fixture();
  await unconfirmedCount(mouse, 6, 3);
  controller.applyDpiStageCount(4);
  controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
  const gate = controller.testDeferNextStatusRead();
  const background = controller.testRefreshStatus();
  const apply = controller.flashPendingChanges();
  assert.equal(gate.started(), true);
  assert.equal(controller.getSnapshot().settingInProgress, true);
  try {
    assert.equal(await controller.flashPendingChanges(), "busy");
    controller.applyLunaFuryDpiStageAxes(3, 3200, 6400);
  } finally {
    gate.release();
  }
  await background;
  assert.equal(await apply, "written");
  assert.deepEqual(mouse.banks[0].table.slice(6, 8), [2400, 4800], "the write guard protects the staged plan while waiting");
});

test("nonempty manual Apply locks foreground recovery and leaves Games/user staging intact", async () => {
  const mouse = fixture();
  await unconfirmedCount(mouse, 6, 3);
  controller.applyDpiStageCount(4);
  controller.applyLunaFuryDpiStageAxes(3, 2400, 4800);
  const gate = controller.testDeferNextStatusRead();
  const apply = controller.flashPendingChanges();
  try {
    assert.equal(gate.started(), true);
    assert.equal(controller.getSnapshot().settingInProgress, true);
    assert.equal(await controller.flashGameProfileSnapshot({ dpiStages: [400, 800, 1600] }), "busy");
    assert.equal(controller.beginGameProfileDraft({}), false);
    controller.applyDpiStageCount(2);
    assert.deepEqual(controller.testState().pending, ["dpi-stage-count", "dpi-stage-3"]);
  } finally {
    gate.release();
    await apply;
  }
  assert.equal(await apply, "written");
  assert.equal(mouse.banks[0].count, 4);
  assert.deepEqual(mouse.banks[0].table.slice(6, 8), [2400, 4800]);
});

test("generic staged-DPI manual Apply also replans expansion against recovered status", async () => {
  const mouse = fixture();
  const generic = await controller.testConnectGenericStages(mouse.device);
  controller.applyDpiStageCount(3);
  controller.testRejectNextStatusRead();
  assert.equal(await controller.flashPendingChanges(), "failed");
  controller.applyDpiStageCount(4);
  controller.applyDpiStageValue(3, 2400);
  assert.equal(await controller.flashPendingChanges(), "written");
  assert.deepEqual(generic.writes, [{ count: 3 }, { count: 4 }, { stage: 3, dpi: 2400 }]);
  assert.deepEqual(generic.stored.dpiStages, [400, 800, 1600, 2400]);
});

test("client-only stand-ins still support manual Apply and recovery without a physical HID selection", async () => {
  const mouse = fixture();
  const generic = await controller.testConnectGeneric(mouse.device);
  controller.testClientOnly();
  controller.applyDpiValue(1200);
  assert.equal(await controller.flashPendingChanges(), "written");
  controller.applyDpiValue(800);
  controller.testRejectNextStatusRead();
  assert.equal(await controller.flashPendingChanges(), "failed");
  assert.equal(await controller.flashGameProfileSnapshot({ dpi: 1200 }), "written");
  controller.applyDpiValue(400);
  assert.equal(await controller.flashPendingChanges(), "written");
  assert.equal(generic.stored.dpi, 400);
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
