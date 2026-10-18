import assert from "node:assert/strict";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

let controller: any;

before(async () => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { search: "" },
    matchMedia: () => ({ matches: false }), setTimeout, clearTimeout };
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
          export function testSetup(settings, brand = "LunaFury", draft = false) {
            clearPendingChanges(); testWrites.length = 0;
            latestDeviceStatus = { brand, name: "Test mouse", dpi: 800, pollingRateHz: 1000,
              batteryPercent: null, batteryState: "Unknown", firmware: [], lunafury: settings };
            matchesBaseline = null; settingInProgress = false;
            interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES, instantFlash: false };
            gameProfileDraft = draft ? { touched: new Set() } : null;
            active = {
              setLunaFuryButtonPollingRate: async value => { testWrites.push(["rate", value]); },
              setLunaFuryReceiverLightMode: async value => { testWrites.push(["light", value]); },
              setLunaFuryBottomButtonMode: async value => { testWrites.push(["bottom", value]); },
            };
          }
          export function testPending() { return pendingChanges(); }
          export function testPreview() { return withPendingChanges(latestDeviceStatus); }
          export function testProfileSwitch() {
            stagePendingChange({ key: "onboard-profile", label: "", command: "", progress: "", apply: async () => {} });
          }
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
  controller.testProfileSwitch();
  controller.applyLunaFuryButtonPollingRate(4000);
  controller.applyLunaFuryBottomButtonMode(1);
  assert.deepEqual(controller.testPending().map((pending: any) => pending.key), ["onboard-profile"]);
});
