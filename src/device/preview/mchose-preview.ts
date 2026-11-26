import {
  MCHOSE_ACE68_LAYOUT,
  MCHOSE_ACTION_TYPE,
  MCHOSE_LAYER_COUNT,
  MCHOSE_PRODUCTS,
  applyMchoseKeyTravelUpdate,
  decodeMchoseKeyTravel,
  decodeMchoseDks,
} from "@openmouse/keyboard-protocol/mchose";
import type { MchoseAction, MchoseKeyTravel } from "@openmouse/keyboard-protocol/mchose";
import type { MchoseWorkspace } from "../mchose-workspace.ts";
import type { KeyboardClient } from "../keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "../keyboard-workspace.ts";
import type { KeyboardIdentityView } from "../types.ts";

/**
 * Preview stand-in for the MCHOSE Ace 68 Air. Everything here is invented to
 * show the controls: no keyboard was read, and nothing is ever written to a device.
 */
export const MCHOSE_PREVIEW_LABEL = "Ace 68 Air III (preview data)";

function travelTable(): MchoseKeyTravel[] {
  // Factory-looking records: 1.20 mm actuation, rapid trigger off.
  const base = decodeMchoseKeyTravel([0xa0, 0x00, 119, 0x00, 0x09, 0x00, 0x09, 0x00]);
  const travel = Array.from({ length: 128 }, () => ({ ...base }));
  for (const key of MCHOSE_ACE68_LAYOUT) {
    if (["W", "A", "S", "D"].includes(key.label)) travel[key.index] = { ...base, keyMode: 1, actuation: 30, rapidTriggerPress: 10, rapidTriggerRelease: 13, pressDeadzone: 15, releaseDeadzone: 15 };
    if (key.label === "Caps") travel[key.index] = { ...base, actuation: 250 };
  }
  return travel;
}

/** Each key sends its own usage on the base layers; Fn layers start empty. */
function keymap(): MchoseAction[][] {
  const base: MchoseAction[] = Array.from({ length: 128 }, () => ({ type: 0, code1: 0, code2: 0 }));
  for (const key of MCHOSE_ACE68_LAYOUT) {
    base[key.index] = key.usage === 0xff ? { type: MCHOSE_ACTION_TYPE.special, code1: 0xff, code2: 1 }
      : key.usage >= 0xe0 ? { type: MCHOSE_ACTION_TYPE.key, code1: 1 << (key.usage - 0xe0), code2: 0 }
        : { type: MCHOSE_ACTION_TYPE.key, code1: 0, code2: key.usage };
  }
  // The Mac layers swap Win and Alt, as on the keyboard.
  const mac = base.map((a) => (a.type === MCHOSE_ACTION_TYPE.key && (a.code1 & 0xcc) ? { ...a, code1: a.code1 & 0x44 ? a.code1 << 1 : a.code1 >> 1 } : { ...a }));
  return Array.from({ length: MCHOSE_LAYER_COUNT }, (_, layer) => (layer % 2 === 1 ? base.map(() => ({ type: 0, code1: 0, code2: 0 })) : layer ? mac : base.map((a) => ({ ...a }))));
}

const emptyTables = () => ({
  dks: Array.from({ length: 32 }, () => decodeMchoseDks(new Array(24).fill(0))),
  modTap: Array.from({ length: 32 }, () => ({ tap: { type: 0, code1: 0, code2: 0 }, hold: { type: 0, code1: 0, code2: 0 } })),
  toggle: Array.from({ length: 32 }, () => ({ type: 0, code1: 0, code2: 0 })),
});

/** A keyboard client that answers from memory, so every control can be driven. */
export class MchosePreviewClient implements KeyboardClient {
  readonly family = "mchose";
  readonly brand = "MCHOSE";
  readonly device: HIDDevice;
  readonly name = MCHOSE_PREVIEW_LABEL;
  private state: MchoseWorkspace;

  constructor() {
    const product = MCHOSE_PRODUCTS[0]!;
    this.device = { vendorId: 0x41e4, productId: product.productId, productName: this.name, collections: [] } as unknown as HIDDevice;
    const defaults = keymap();
    this.state = {
      product,
      info: { firmwareVersion: "116", buildDate: "Nov 8 2025,16:25:57", chip: "GL8KH-PRO" },
      profile: 0,
      profileCount: 3,
      profileNames: ["Everyday", null, null, null],
      layout: MCHOSE_ACE68_LAYOUT,
      performance: {
        layerMode: 0, pollingRaw: 1, pollingHz: 8000, scanRateRaw: 0, lockWin: false, lockAltTab: false, lockAltF4: false,
        tachyonMode: false, bottomRapidTrigger: true, debounceLevel: 0, sleepTime: 12,
      },
      settings: {
        macMode: false, lockWin: false, lockAltTab: false, lockAltF4: false, scanRateRaw: 0, tachyonMode: false,
        bottomRapidTrigger: true, travelCheck: true, debounce: false, rtSmart: 5, sleepTime: 12, sleepEnabled: true,
      },
      lighting: {
        main: { effect: 6, brightness: 80, speed: 2, direction: 0, rainbow: true, color: { r: 0, g: 200, b: 160 } },
        side: { effect: 2, brightness: 100, speed: 2, rainbow: false, color: { r: 255, g: 255, b: 255 } },
      },
      travel: travelTable(),
      keymap: defaults,
      defaults: keymap(),
      advanced: emptyTables(),
      macros: Array.from({ length: 16 }, (_, n) => (n === 0
        ? { mode: 1, steps: [{ kind: "key" as const, code: 0x0b, down: true, delayMs: 20 }, { kind: "key" as const, code: 0x0b, down: false, delayMs: 0 }] }
        : { mode: 0, steps: [] })),
      colors: Array.from({ length: 128 }, () => ({ r: 0, g: 0, b: 0 })),
    };
  }

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async readIdentity(): Promise<KeyboardIdentityView> {
    return { brand: this.brand, name: this.name, boardId: null, capabilities: null, firmwareVersion: "116", appVersion: null, pcbVersion: null, serial: null };
  }

  private patch(update: Partial<MchoseWorkspace>): Partial<KeyboardWorkspace> {
    this.state = { ...this.state, ...update };
    return { mchose: this.state };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    const state = this.state;
    switch (command.kind) {
      case "refresh": return { mchose: state };
      case "mchoseTravel": {
        const travel = state.travel.slice();
        for (const update of command.updates) {
          const key = travel[update.index];
          if (!key) throw new RangeError(`Key ${update.index} is outside the table.`);
          travel[update.index] = applyMchoseKeyTravelUpdate(key, update);
        }
        return this.patch({ travel });
      }
      case "mchosePolling": return this.patch({ performance: state.performance && { ...state.performance, pollingHz: command.hz } });
      case "mchoseWinLock": return this.patch({ settings: state.settings && { ...state.settings, lockWin: command.locked } });
      case "mchoseSettings": return this.patch({ settings: command.settings });
      case "mchoseLighting": return this.patch({ lighting: command.lighting });
      case "mchoseKeyColors": {
        const colors = (state.colors ?? []).slice();
        for (const { index, color } of command.updates) colors[index] = color;
        return this.patch({ colors });
      }
      case "mchoseKeymap": {
        const keymap: MchoseAction[][] = state.keymap.map((layer) => layer.slice());
        for (const { index, action } of command.updates) keymap[command.layer]![index] = action;
        return this.patch({ keymap });
      }
      case "mchoseMacros": return this.patch({ macros: command.macros });
      case "mchoseAdvanced": {
        const type = command.binding.kind === "dks" ? MCHOSE_ACTION_TYPE.dks : command.binding.kind === "modTap" ? MCHOSE_ACTION_TYPE.modTap : MCHOSE_ACTION_TYPE.toggle;
        const advanced = { dks: [...state.advanced!.dks], modTap: [...state.advanced!.modTap], toggle: [...state.advanced!.toggle] };
        const used = new Set(state.keymap.flat().filter((a) => a.type === type).map((a) => a.code1));
        const current = state.keymap[command.layer]![command.index]!;
        const slot = current.type === type ? current.code1 : [...Array(32).keys()].find((n) => !used.has(n)) ?? 0;
        let code2 = 0;
        if (command.binding.kind === "dks") advanced.dks[slot] = command.binding.dks;
        if (command.binding.kind === "toggle") advanced.toggle[slot] = command.binding.action;
        if (command.binding.kind === "modTap") { advanced.modTap[slot] = command.binding.entry; code2 = Math.round(command.binding.holdMs / 10); }
        const keymap: MchoseAction[][] = state.keymap.map((layer) => layer.slice());
        keymap[command.layer]![command.index] = { type, code1: slot, code2 };
        return this.patch({ advanced, keymap });
      }
      case "mchosePair": {
        const type = command.pair === "socd" ? MCHOSE_ACTION_TYPE.socd : MCHOSE_ACTION_TYPE.snapTap;
        const keymap: MchoseAction[][] = state.keymap.map((layer) => layer.slice());
        const used = new Set(state.keymap.flat().filter((a) => a.type >= MCHOSE_ACTION_TYPE.modTap && a.type <= MCHOSE_ACTION_TYPE.layerTap).map((a) => a.code1));
        const free = [...Array(32).keys()].filter((n) => !used.has(n));
        keymap[command.layer]![command.first] = { type, code1: free[0] ?? 0, code2: command.second };
        keymap[command.layer]![command.second] = { type, code1: free[1] ?? 1, code2: command.first };
        const travel = state.travel.slice();
        if (command.pair === "socd") {
          const p = command.priority ?? 0;
          travel[command.first] = { ...travel[command.first]!, priority: p };
          travel[command.second] = { ...travel[command.second]!, priority: p === 1 ? 2 : p === 2 ? 1 : p };
        }
        return this.patch({ keymap, travel });
      }
      case "mchoseAdvancedClear": {
        const keymap: MchoseAction[][] = state.keymap.map((layer) => layer.slice());
        keymap[command.layer]![command.index] = { ...state.defaults[command.layer]![command.index]! };
        return this.patch({ keymap });
      }
      case "mchoseProfile": return this.patch({ profile: command.profile });
      case "mchoseReset": {
        // The preview has no factory image; it goes back to the data it started with.
        const fresh = new MchosePreviewClient().state;
        return this.patch(command.scope === "all" ? { ...fresh } : { ...fresh, profile: state.profile, profileNames: state.profileNames.map((name, n) => (n === state.profile ? null : name)), macros: state.macros });
      }
      case "mchoseImport": {
        const { file } = command;
        const profileNames = state.profileNames.slice();
        if (file.name) profileNames[state.profile] = file.name;
        return this.patch({
          settings: file.settings, lighting: file.lighting, colors: file.colors, advanced: file.advanced, profileNames,
          travel: state.travel.map((key, index) => (state.layout.some((entry) => entry.index === index) ? { ...file.travel[index]! } : key)),
          keymap: file.keymap.map((layer) => [...layer]),
        });
      }
      case "mchoseProfileName": {
        const profileNames = state.profileNames.slice();
        profileNames[command.profile] = command.name || null;
        return this.patch({ profileNames });
      }
      case "mchoseCalibrate": return {};
      default: throw new Error("This command is not available on MCHOSE keyboards.");
    }
  }
}
