import { ARBITER_PRODUCTS, arbiterLayout, assertArbiterTravelInRange } from "@openmouse/keyboard-protocol/arbiter";
import type { ArbiterKeyTravel, ArbiterLightEffect, ArbiterProduct, ArbiterUserMode } from "@openmouse/keyboard-protocol/arbiter";
import type { ArbiterWorkspace } from "../arbiter-workspace.ts";
import type { KeyboardClient } from "../keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "../keyboard-workspace.ts";
import type { KeyboardIdentityView } from "../types.ts";

/**
 * Preview stand-ins for Arbiter keyboards. Everything here is invented to show
 * the controls: no keyboard was read, and nothing is ever written to a device.
 */
export const ARBITER_PREVIEW_KEYS = ["arbiter-polar-65-pro", "arbiter-polar-65"] as const;
export type ArbiterPreviewKey = typeof ARBITER_PREVIEW_KEYS[number];

const PREVIEWS: Record<ArbiterPreviewKey, { label: string; vendorId: number; productId: number; usagePage: number }> = {
  "arbiter-polar-65-pro": { label: "Polar 65 PRO (preview data)", vendorId: 0x371c, productId: 0xa003, usagePage: 0xff02 },
  "arbiter-polar-65": { label: "Polar 65 (preview data)", vendorId: 0x1a81, productId: 0x2072, usagePage: 0xff02 },
};

export function arbiterPreviewLabel(key: ArbiterPreviewKey): string {
  return PREVIEWS[key].label;
}

function product(key: ArbiterPreviewKey): ArbiterProduct {
  const wanted = PREVIEWS[key];
  const found = ARBITER_PRODUCTS.find((entry) => entry.vendorId === wanted.vendorId && entry.productId === wanted.productId && entry.usagePage === wanted.usagePage);
  if (!found) throw new Error(`No Arbiter catalog entry for preview ${key}.`);
  return found;
}

function workspace(entry: ArbiterProduct): ArbiterWorkspace {
  const layout = arbiterLayout(entry);
  const travel: ArbiterKeyTravel[] = Array.from({ length: entry.travelKeys }, () => ({ make: 10, break: 10 }));
  // A few non-default keys, so the editor shows more than one number.
  layout.matrix.forEach((key, index) => {
    if (["W", "A", "S", "D"].includes(key.name)) travel[index] = { make: 5, break: 3 };
    if (key.name === "Space") travel[index] = { make: 24, break: 12 };
    if (key.name === "Escape") travel[index] = { make: 38, break: 24 };
  });
  const light: ArbiterLightEffect = {
    on: true, effect: 2, brightness: 180, speed: 90, colorIndex: 3,
    colors: [[255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]]
      .map(([red, green, blue]) => ({ red, green, blue })),
  };
  const userMode: ArbiterUserMode | null = entry.superTap
    ? { layoutIndex: 0, mode: 0, checkFlag: 1, flag: 0, alternative: 0, keyIndex: [44, 45] }
    : null;
  return {
    product: entry,
    travel,
    light,
    bindings: layout.layers.slice(0, entry.layers).map((layer) => layer.map((keyCode) => ({ keyCode, param: 0 }))),
    userMode,
  };
}

/** A keyboard client that answers from memory, so every control can be driven. */
export class ArbiterPreviewClient implements KeyboardClient {
  readonly family = "arbiter";
  readonly brand = "Arbiter Studio";
  readonly device: HIDDevice;
  readonly name: string;
  private state: ArbiterWorkspace;

  constructor(key: ArbiterPreviewKey) {
    const entry = product(key);
    this.name = PREVIEWS[key].label;
    this.device = { vendorId: entry.vendorId, productId: entry.productId, productName: this.name, collections: [] } as unknown as HIDDevice;
    this.state = workspace(entry);
  }

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async readIdentity(): Promise<KeyboardIdentityView> {
    return { brand: this.brand, name: this.name, boardId: null, capabilities: null, firmwareVersion: "V0102", appVersion: null, pcbVersion: null, serial: "A1B2C3D4E5F6" };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    const state = this.state;
    switch (command.kind) {
      case "refresh": return { arbiter: state };
      case "arbiterTravel": {
        const travel = state.travel.map((entry) => ({ ...entry }));
        for (const update of command.updates) {
          const key = travel[update.index];
          if (!key) throw new RangeError(`Key ${update.index} is outside the table.`);
          if (update.make !== undefined) { assertArbiterTravelInRange("actuation", update.make); key.make = update.make; }
          if (update.break !== undefined) { assertArbiterTravelInRange("rapidTrigger", update.break); key.break = update.break; }
        }
        this.state = { ...state, travel };
        return { arbiter: this.state };
      }
      case "arbiterLight": this.state = { ...state, light: command.light }; return { arbiter: this.state };
      case "arbiterBindings": {
        const bindings = state.bindings.map((layer) => layer.map((binding) => ({ ...binding })));
        for (const update of command.updates) {
          const binding = bindings[update.layer]?.[update.index];
          if (!binding) throw new RangeError(`Key ${update.index} is outside the table.`);
          binding.keyCode = update.keyCode;
        }
        this.state = { ...state, bindings };
        return { arbiter: this.state };
      }
      case "arbiterUserMode": this.state = { ...state, userMode: command.mode }; return { arbiter: this.state };
      case "arbiterProfile": return {};
      default: throw new Error("This command is not available on Arbiter keyboards.");
    }
  }
}
