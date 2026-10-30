import { ArbiterKeyboardHidClient } from "@openmouse/keyboard-protocol/drivers/arbiter/hid";
import type { KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import type { ArbiterProduct } from "@openmouse/keyboard-protocol/arbiter";
import type { ArbiterWorkspace } from "./arbiter-workspace.ts";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView } from "./types.ts";

/**
 * Panel-side wrapper around the Arbiter Studio HID driver. Every write is
 * confirmed by the driver's read-back. The driver marks the session unusable
 * after a timeout or a refused command, so a failure other than a rejected
 * argument leaves this client `faulted` and the panel asks for a reconnect.
 */
export class ArbiterKeyboardClient implements KeyboardClient {
  readonly family = "arbiter";
  readonly brand = "Arbiter Studio";
  readonly device: HIDDevice;
  faulted = false;
  private readonly client: ArbiterKeyboardHidClient;
  private readonly product: ArbiterProduct | undefined;
  private status: KeyboardStatus | null = null;

  constructor(device: HIDDevice) {
    this.device = device;
    this.client = new ArbiterKeyboardHidClient(device);
    this.product = ArbiterKeyboardHidClient.productFor(device);
  }

  get name(): string { return this.product?.name ?? (this.device.productName || "Arbiter keyboard"); }

  static isSupported(device: HIDDevice): boolean { return ArbiterKeyboardHidClient.isSupported(device); }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.guard(() => this.client.readStatus());
    this.status = status;
    return {
      brand: status.brand, name: status.name, boardId: null, capabilities: null,
      firmwareVersion: status.firmwareVersion, appVersion: null, pcbVersion: null, serial: status.serial,
    };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    const product = this.product;
    if (!product) throw new Error("This is not a supported Arbiter keyboard.");
    return this.guard(async () => {
      switch (command.kind) {
        case "refresh": {
          // The identity read already walked every table; reuse it on connect, re-read on a manual refresh.
          const status = this.status ?? await this.client.readStatus();
          this.status = null;
          const state = status.arbiter;
          if (!state) throw new Error("The keyboard returned no Arbiter state.");
          const bindings = await this.client.readKeyBindings();
          return { arbiter: workspace(product, state.travel ?? [], state.light, bindings, state.userMode) };
        }
        case "arbiterTravel": {
          const travel = await this.client.setKeyTravel(command.updates);
          return { arbiter: this.patch({ travel }) };
        }
        case "arbiterLight":
          return { arbiter: this.patch({ light: await this.client.setLightEffect(command.light) }) };
        case "arbiterBindings":
          return { arbiter: this.patch({ bindings: await this.client.setKeyBindings(command.updates) }) };
        case "arbiterProfile":
          // Acknowledged only: the keyboard has no command that reports the active profile.
          await this.client.setBoardProfile(command.profile);
          return {};
        case "arbiterUserMode":
          return { arbiter: this.patch({ userMode: await this.client.setUserMode(command.mode) }) };
        default:
          throw new Error("This command is not available on Arbiter keyboards.");
      }
    });
  }

  private current: ArbiterWorkspace | null = null;

  private patch(update: Partial<ArbiterWorkspace>): ArbiterWorkspace {
    if (!this.current) throw new Error("Read the keyboard before changing it.");
    this.current = { ...this.current, ...update };
    return this.current;
  }

  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      if (result && typeof result === "object" && "arbiter" in result && result.arbiter) {
        this.current = result.arbiter as ArbiterWorkspace;
      }
      return result;
    } catch (error) {
      // A rejected argument never reaches the keyboard; anything else may have desynchronised the session.
      if (!(error instanceof RangeError)) this.faulted = true;
      throw error;
    }
  }
}

function workspace(
  product: ArbiterProduct,
  travel: ArbiterWorkspace["travel"],
  light: ArbiterWorkspace["light"],
  bindings: ArbiterWorkspace["bindings"],
  userMode: ArbiterWorkspace["userMode"],
): ArbiterWorkspace {
  return { product, travel, light, bindings, userMode };
}
