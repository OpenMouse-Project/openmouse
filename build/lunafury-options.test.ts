import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

let controller: any;
const timers = new Set<ReturnType<typeof setTimeout>>();

after(() => { for (const timer of timers) clearTimeout(timer); });

before(async () => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { search: "" },
    matchMedia: () => ({ matches: false }), clearTimeout,
    setTimeout: (callback: () => void, delay?: number) => {
      const timer = setTimeout(callback, delay); timers.add(timer); return timer;
    } };
  (globalThis as any).document = { title: "OpenMouse test" };
  const entry = fileURLToPath(new URL("../src/device/controller.ts", import.meta.url));
  const result: any = await build({
    configFile: false, logLevel: "silent",
    define: { __BUILD_CHANNEL__: '"stable"', __APP_VERSION__: '"test"', __BUILD_ID__: '"test"' },
    plugins: [{ name: "lunafury-options-test", enforce: "pre",
      transform(source, id) {
        if (id.replaceAll("\\", "/") !== entry.replaceAll("\\", "/")) return null;
        // Stub UI notifications; keep the real staging, validation and dispatch.
        return source.replace("function emit(): void {", "function emit(): void { return;") + `
          export const testWrites = [];
          export const testBankWrites = [];
          let testProfile, testBanks, testReader;
          export function testSetup(settings, brand = "LunaFury", draft = false) {
            clearPendingChanges(); testWrites.length = 0; testBankWrites.length = 0; toasts.length = 0;
            testProfile = 1; testReader = null;
            testBanks = new Map([1, 2, 3].map(profile => [profile, structuredClone(settings)]));
            latestDeviceStatus = { brand, name: "Test mouse", dpi: 800, pollingRateHz: 1000,
              batteryPercent: null, batteryState: "Unknown", firmware: [],
              activeProfile: 1, profileCount: 3, lunafury: structuredClone(settings) };
            matchesBaseline = null; settingInProgress = false;
            dpiOptions = [800, 1600];
            interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES, locale: "en",
              instantFlash: false, reducedMotion: true };
            gameProfileDraft = draft ? { touched: new Set() } : null;
            const write = (kind, field, value) => {
              testWrites.push([kind, value]); testBankWrites.push([kind, testProfile, value]);
              testBanks.get(testProfile)[field] = value;
            };
            active = {
              setLunaFuryButtonPollingRate: async value => write("rate", "buttonPollingRateHz", value),
              setLunaFuryReceiverLightMode: async value => {
                testWrites.push(["light", value]);
                for (const bank of testBanks.values()) bank.receiverLightMode = value;
              },
              setLunaFuryBottomButtonMode: async value => write("bottom", "bottomButtonMode", value),
              setProfile: async profile => { testProfile = profile; testWrites.push(["profile", profile]); },
              readStatus: async () => {
                const status = { ...latestDeviceStatus, activeProfile: testProfile,
                  ui: { ...latestDeviceStatus.ui, settingsReady: true },
                  lunafury: structuredClone(testBanks.get(testProfile)) };
                return testReader ? await testReader(status) : status;
              },
            };
          }
          export function testPending() { return pendingChanges(); }
          export function testPreview() { return withPendingChanges(latestDeviceStatus); }
          export function testWarnings() { return toasts.filter(toast => toast.kind === "warning"); }
          export function testBank(profile, settings) { testBanks.set(profile, structuredClone(settings)); }
          export function testReadWith(reader) { testReader = reader; }
        `;
      },
    }],
    build: { write: false, minify: false, lib: { entry, formats: ["es"] },
      rollupOptions: { output: { inlineDynamicImports: true } } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const code = outputs.find((item: any) => item.type === "chunk").code;
  controller = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
});

const SETTINGS = { buttonPollingRateHz: 1000, supportedButtonPollingRates: [1000, 2000, 4000, 8000],
  receiverLightMode: 6, bottomButtonMode: 2 };

test("LunaFury controls stage independently and dispatch through the published driver API", async () => {
  controller.testSetup(structuredClone(SETTINGS));
  controller.applyLunaFuryButtonPollingRate(4000);
  controller.applyLunaFuryReceiverLightMode(0);
  controller.applyLunaFuryBottomButtonMode(1);
  assert.deepEqual(controller.testWrites, []);
  const preview = controller.testPreview();
  assert.equal(preview.pollingRateHz, 1000); // USB polling stays independent.
  assert.equal(preview.lunafury.buttonPollingRateHz, 4000);
  assert.equal(preview.lunafury.receiverLightMode, 0);
  assert.equal(preview.lunafury.bottomButtonMode, 1);
  for (const pending of controller.testPending()) await pending.apply();
  assert.deepEqual(controller.testWrites, [["rate", 4000], ["light", 0], ["bottom", 1]]);
});

test("unread controls, other brands and invalid values cannot stage writes", () => {
  for (const [settings, brand] of [[{}, "LunaFury"], [SETTINGS, "Lamzu"]] as const) {
    controller.testSetup(settings, brand);
    controller.applyLunaFuryButtonPollingRate(4000);
    controller.applyLunaFuryReceiverLightMode(0);
    controller.applyLunaFuryBottomButtonMode(1);
    assert.deepEqual(controller.testPending(), []);
  }
  controller.testSetup(SETTINGS);
  controller.applyLunaFuryButtonPollingRate(125);
  controller.applyLunaFuryReceiverLightMode(3);
  controller.applyLunaFuryBottomButtonMode(0);
  assert.deepEqual(controller.testPending(), []);
  controller.testSetup({ ...SETTINGS, supportedButtonPollingRates: [1000] });
  controller.applyLunaFuryButtonPollingRate(8000);
  assert.deepEqual(controller.testPending(), []);
});

test("hardware-only controls stay out of Games and bank edits wait for profile selection", () => {
  controller.testSetup(SETTINGS, "LunaFury", true);
  controller.applyLunaFuryReceiverLightMode(0);
  controller.applyLunaFuryBottomButtonMode(1);
  assert.deepEqual(controller.testPending(), []);
  controller.testSetup(SETTINGS);
  controller.applyProfileSelection(2);
  controller.applyLunaFuryButtonPollingRate(4000);
  controller.applyLunaFuryBottomButtonMode(1);
  assert.deepEqual(controller.testPending().map((pending: any) => pending.key), ["onboard-profile"]);
});

test("LunaFury profile switching rejects staged bank edits in reverse order", () => {
  for (const stage of [
    () => controller.applyLunaFuryButtonPollingRate(4000),
    () => controller.applyLunaFuryBottomButtonMode(1),
    () => controller.applyDpiValue(1600),
  ]) {
    controller.testSetup(SETTINGS);
    stage();
    const keys = controller.testPending().map((pending: any) => pending.key);
    assert.equal(keys.length, 1);
    controller.applyProfileSelection(2);
    assert.deepEqual(controller.testPending().map((pending: any) => pending.key), keys);
    assert.equal(controller.testPreview().activeProfile, 1);
    assert.equal(controller.testWarnings().length, 1);
    assert.ok(controller.testWarnings()[0].title.length > 0);
    assert.deepEqual(controller.testWrites, []);
    controller.revertPendingChanges();
    controller.applyProfileSelection(2);
    assert.deepEqual(controller.testPending().map((pending: any) => pending.key), ["onboard-profile"]);
  }
});

test("profile selection can be revised and preserves independent receiver edits", () => {
  controller.testSetup(SETTINGS);
  controller.applyProfileSelection(2);
  controller.applyProfileSelection(3);
  assert.equal(controller.testPreview().activeProfile, 3);
  assert.equal(controller.testPending().length, 1);
  controller.applyProfileSelection(1);
  assert.deepEqual(controller.testPending(), []);
  controller.applyLunaFuryReceiverLightMode(0);
  controller.applyProfileSelection(2);
  assert.deepEqual(controller.testPending().map((pending: any) => pending.key),
    ["lunafury-receiver-light", "onboard-profile"]);
  controller.applyLunaFuryReceiverLightMode(11);
  assert.equal(controller.testPending().length, 2);

  controller.testSetup(SETTINGS, "Lamzu");
  controller.applyDpiValue(1600);
  controller.applyProfileSelection(2);
  assert.deepEqual(controller.testPending().map((pending: any) => pending.key), ["dpi", "onboard-profile"]);
});

test("LunaFury edits wait for profile read-back and then target the new bank", async () => {
  controller.testSetup(SETTINGS);
  controller.testBank(2, { ...SETTINGS, buttonPollingRateHz: 2000, bottomButtonMode: 1 });
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  controller.testReadWith(async (status: unknown) => { started(); await gate; return status; });
  controller.applyProfileSelection(2);
  const applying = controller.flashPendingChanges();
  await reading;
  try {
    controller.applyLunaFuryButtonPollingRate(4000);
    controller.applyLunaFuryBottomButtonMode(1);
    controller.applyDpiValue(1600);
    assert.deepEqual(controller.testPending().map((pending: any) => pending.key), ["onboard-profile"]);
    assert.deepEqual(controller.testBankWrites, []);
  } finally {
    release();
    await applying;
  }
  assert.equal(controller.testPreview().activeProfile, 2);
  assert.equal(controller.testPreview().lunafury.buttonPollingRateHz, 2000);
  assert.deepEqual(controller.testPending(), []);
  controller.applyLunaFuryButtonPollingRate(4000);
  controller.applyLunaFuryBottomButtonMode(2);
  await controller.flashPendingChanges();
  assert.deepEqual(controller.testBankWrites, [["rate", 2, 4000], ["bottom", 2, 2]]);
});

test("failed LunaFury profile read-back keeps bank edits blocked until a successful retry", async () => {
  for (const revert of [false, true]) {
    controller.testSetup(SETTINGS);
    controller.testReadWith(() => { throw new Error("Profile read-back failed"); });
    controller.applyProfileSelection(2);
    await controller.flashPendingChanges();
    controller.applyLunaFuryButtonPollingRate(4000);
    controller.applyLunaFuryBottomButtonMode(1);
    assert.deepEqual(controller.testPending().map((pending: any) => pending.key), ["onboard-profile"]);
    assert.deepEqual(controller.testBankWrites, []);
    if (revert) {
      controller.revertPendingChanges();
      controller.applyLunaFuryButtonPollingRate(4000);
      controller.applyLunaFuryBottomButtonMode(1);
      controller.applyDpiValue(1600);
      assert.deepEqual(controller.testPending(), []);
      controller.applyProfileSelection(2);
    }
    controller.testReadWith(null);
    await controller.flashPendingChanges();
    assert.deepEqual(controller.testPending(), []);
    assert.equal(controller.testPreview().activeProfile, 2);
    controller.applyLunaFuryBottomButtonMode(1);
    await controller.flashPendingChanges();
    assert.deepEqual(controller.testBankWrites, [["bottom", 2, 1]]);
  }
});
