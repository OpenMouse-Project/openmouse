import { RazerKeyboardHidClient } from "@openmouse/keyboard-protocol/drivers/razer/hid";
import type { KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import {
  RAZER_GAME_MODE_LED_SUPPORT,
  RAZER_KEYBOARD_PRODUCTS,
  RAZER_POLLING_RATE_EXTENDED,
  RAZER_POLLING_RATE_STANDARD,
  type RazerMatrixEffect,
} from "@openmouse/keyboard-protocol/razer";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView, KeyboardPollingView } from "./types.ts";

export type RazerKeyboardCommand =
  | { kind: "razerRefresh" }
  | { kind: "razerBrightness"; value: number }
  | { kind: "razerEffect"; effect: RazerMatrixEffect }
  | { kind: "razerGameMode"; enabled: boolean };

function pollingView(status: KeyboardStatus): KeyboardPollingView {
  const state = status.razer;
  const rates = state?.pollingStyle === "extended"
    ? RAZER_POLLING_RATE_EXTENDED
    : state?.pollingStyle === "standard" ? RAZER_POLLING_RATE_STANDARD : null;
  return { currentHz: state?.pollingRateHz ?? null, supportedHz: rates ? [...rates.keys()].sort((a, b) => a - b) : [] };
}

export class RazerKeyboardClient implements KeyboardClient {
  readonly family = "razer" as const;
  readonly brand = "Razer";
  readonly name: string;
  readonly device: HIDDevice;
  private readonly client: RazerKeyboardHidClient;

  constructor(device: HIDDevice) {
    this.device = device;
    this.client = new RazerKeyboardHidClient(device);
    this.name = RAZER_KEYBOARD_PRODUCTS.get(device.productId)?.name ?? device.productName;
  }

  static isSupported(device: HIDDevice): boolean { return RazerKeyboardHidClient.isSupported(device); }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.client.readStatus();
    return {
      brand: status.brand, name: status.name, boardId: null, capabilities: null,
      firmwareVersion: status.firmwareVersion, appVersion: null, pcbVersion: null, serial: status.serial,
    };
  }

  async readPolling(): Promise<KeyboardPollingView> {
    return pollingView(await this.client.readStatus());
  }

  async setPollingRate(hz: number): Promise<KeyboardPollingView> {
    await this.client.setPollingRate(hz);
    return this.readPolling();
  }

  private async readGameMode(): Promise<boolean | null> {
    if (!RAZER_GAME_MODE_LED_SUPPORT.has(this.device.productId)) return null;
    try { return await this.client.readGameModeLed(); }
    catch { return null; }
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    switch (command.kind) {
      case "refresh":
      case "razerRefresh": {
        const vendorStatus = await this.client.readStatus();
        return { vendorStatus, razerGameModeLed: await this.readGameMode() };
      }
      case "razerBrightness": {
        await this.client.setBrightness(command.value);
        return { vendorStatus: await this.client.readStatus() };
      }
      case "razerEffect":
        await this.client.setMatrixEffect(command.effect);
        return {}; // Matrix effect has no readback. Never present the requested effect as active.
      case "razerGameMode": {
        const razerGameModeLed = await this.client.setGameModeLed(command.enabled);
        return { razerGameModeLed };
      }
      default:
        throw new Error("This Razer keyboard does not support that command.");
    }
  }
}
