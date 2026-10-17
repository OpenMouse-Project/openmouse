import { KochiHidClient } from "@openmouse/keyboard-protocol/drivers/kochi/hid";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardIdentityView } from "./types.ts";

export class KochiKeyboardClient implements KeyboardClient {
  readonly family = "kochi";
  readonly brand = "Kochi";
  readonly name = "Hummingbird 68";
  readonly device: HIDDevice;
  private readonly client: KochiHidClient;

  constructor(device: HIDDevice) { this.device = device; this.client = new KochiHidClient(device); }
  static isSupported(device: HIDDevice): boolean { return KochiHidClient.isSupported(device); }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.client.readStatus();
    return {
      brand: status.brand, name: status.name, boardId: null, capabilities: null,
      firmwareVersion: status.firmwareVersion, appVersion: null, pcbVersion: null, serial: null,
    };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    if (command.kind === "refresh") return { systemMode: await this.client.readSystemMode() };
    if (command.kind !== "system") throw new Error("HB68 support currently covers Windows/Mac mode only.");
    if (command.value !== 0 && command.value !== 1) throw new RangeError("Expected Windows or Mac mode.");
    return { systemMode: await this.client.setSystemMode(command.value === 1 ? "mac" : "win") };
  }
}
