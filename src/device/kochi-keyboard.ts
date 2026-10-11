import { KochiHidClient } from "@openmouse/keyboard-protocol/drivers/kochi/hid";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardIdentityView } from "./types.ts";

/** HB68 system-mode controls only. Other commands fail before reaching USB. */
export class KochiKeyboardClient implements KeyboardClient {
  readonly family = "kochi";
  readonly brand = "Kochi";
  readonly name = "Hummingbird 68";
  readonly device: HIDDevice;
  private readonly client: KochiHidClient;

  /** Build the adapter over the shared HB68 HID client. */
  constructor(device: HIDDevice) { this.device = device; this.client = new KochiHidClient(device); }
  /** True when the device exposes the HB68 command collection. */
  static isSupported(device: HIDDevice): boolean { return KochiHidClient.isSupported(device); }
  /** Open the HID session; commands require it. */
  open(): Promise<void> { return this.client.open(); }
  /** Close the HID session and reject any pending exchange. */
  close(): Promise<void> { return this.client.close(); }

  /** Read the board identity shown in the keyboard header. */
  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.client.readStatus();
    return {
      brand: status.brand, name: status.name, boardId: null, capabilities: null,
      firmwareVersion: status.firmwareVersion, appVersion: null, pcbVersion: null, serial: null,
    };
  }

  /** Run a workspace command; only refresh and system mode are supported. */
  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    if (command.kind === "refresh") return { systemMode: await this.client.readSystemMode() };
    if (command.kind !== "system") throw new Error("HB68 support currently covers Windows/Mac mode only.");
    if (command.value !== 0 && command.value !== 1) throw new RangeError("Expected Windows or Mac mode.");
    return { systemMode: await this.client.setSystemMode(command.value === 1 ? "mac" : "win") };
  }
}
