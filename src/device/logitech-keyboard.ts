import { LogitechKeyboardHidClient } from "@openmouse/keyboard-protocol/drivers/logitech/hid";
import type { KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import { logitechRgbMode, type LogitechRgbMode } from "@openmouse/keyboard-protocol/logitech";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView, KeyboardPollingView } from "./types.ts";

export type LogitechKeyboardCommand =
  | { kind: "logitechRefresh" }
  | { kind: "logitechPolling"; hz: number }
  | { kind: "logitechBrightness"; value: number }
  | { kind: "logitechRapidTrigger"; enabled: boolean }
  | { kind: "logitechKeyPriority"; enabled: boolean }
  | { kind: "logitechRgbEffect"; mode: LogitechRgbMode }
  | { kind: "logitechSolidColor"; red: number; green: number; blue: number };

/** Keyboard-only HID++ adapter. Unreadable and unadvertised controls remain unavailable. */
export class LogitechKeyboardClient implements KeyboardClient {
  readonly family = "logitech";
  readonly brand = "Logitech";
  readonly device: HIDDevice;
  private readonly client: LogitechKeyboardHidClient;
  private initialStatus: KeyboardStatus | null = null;

  constructor(device: HIDDevice) {
    this.device = device;
    this.client = new LogitechKeyboardHidClient(device);
  }

  get name(): string { return this.device.productName || "Logitech keyboard"; }
  static isSupported(device: HIDDevice): boolean { return LogitechKeyboardHidClient.isSupported(device); }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.client.readStatus();
    this.initialStatus = status;
    return {
      brand: status.brand,
      name: status.name,
      boardId: null,
      capabilities: null,
      firmwareVersion: status.firmwareVersion,
      appVersion: null,
      pcbVersion: null,
      serial: status.serial,
    };
  }

  async readPolling(): Promise<KeyboardPollingView> {
    const status = this.initialStatus ?? await this.client.readStatus();
    const state = status.logitech;
    return { currentHz: state?.pollingRateHz ?? null, supportedHz: [...(state?.supportedPollingRates ?? [])] };
  }

  async setPollingRate(hz: number): Promise<KeyboardPollingView> {
    const state = (this.initialStatus ?? await this.client.readStatus()).logitech;
    if (!state?.supportedPollingRates.includes(hz) || state.pollingRateHz === null) {
      throw new Error("This Logitech keyboard did not advertise the requested polling rate.");
    }
    await this.client.setPollingRate(hz);
    this.initialStatus = null;
    return this.readPolling();
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    if (command.kind === "logitechRefresh" || command.kind === "refresh") {
      const status = this.initialStatus ?? await this.client.readStatus();
      this.initialStatus = null;
      return { vendorStatus: status };
    }
    if (!command.kind.startsWith("logitech")) throw new Error("Unsupported Logitech keyboard command.");
    // The workspace command union narrows to LogitechKeyboardCommand after the brand guard.
    const action = command as LogitechKeyboardCommand;
    const state = (this.initialStatus ?? await this.client.readStatus()).logitech;
    if (!state) throw new Error("The Logitech keyboard did not report its capabilities.");
    switch (action.kind) {
      case "logitechPolling":
        if (state.pollingRateHz === null || !state.supportedPollingRates.includes(action.hz)) throw new Error("Polling rate is not available on this keyboard.");
        await this.client.setPollingRate(action.hz);
        break;
      case "logitechBrightness":
        if (!state.brightness) throw new Error("Brightness is not available on this keyboard.");
        await this.client.setBrightness(action.value);
        break;
      case "logitechRapidTrigger":
        if (state.analog?.rapidTrigger === null || state.analog?.rapidTrigger === undefined) throw new Error("Rapid trigger is not available on this keyboard.");
        await this.client.setAnalogRapidTrigger(action.enabled);
        break;
      case "logitechKeyPriority":
        if (state.analog?.keyPriority === null || state.analog?.keyPriority === undefined) throw new Error("Key priority is not available on this keyboard.");
        await this.client.setAnalogKeyPriority(action.enabled);
        break;
      case "logitechRgbEffect":
        if (!state.lighting?.rgbZones.length || !state.lighting.rgbZones.every(zone => zone.effects.some(effect => logitechRgbMode(effect.id) === action.mode))) {
          throw new Error("The RGB effect is not advertised by every keyboard cluster.");
        }
        // HID++ 0x8071 has no active-effect read-back; do not synthesize a selected mode.
        await this.client.setRgbEffect(action.mode);
        break;
      case "logitechSolidColor":
        if (!state.lighting?.zones.length) throw new Error("Per-key lighting is not available on this keyboard.");
        // 0x8081 acknowledges the frame, but does not expose the current colour.
        await this.client.setSolidColor(action.red, action.green, action.blue);
        break;
    }
    this.initialStatus = null;
    return { vendorStatus: await this.client.readStatus() };
  }
}
