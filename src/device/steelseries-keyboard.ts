import { SteelSeriesKeyboardHidClient } from "@openmouse/keyboard-protocol/drivers/steelseries/hid";
import type { KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import type { SteelSeriesApexProfile, SteelSeriesReleaseMode } from "@openmouse/keyboard-protocol/steelseries";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView } from "./types.ts";

export type SteelSeriesKeyboardCommand =
  | { kind: "steelseriesRefresh" }
  | { kind: "steelseriesActuation"; usages: readonly number[]; tenthsMm: number }
  | { kind: "steelseriesRelease"; usages: readonly number[]; mode: SteelSeriesReleaseMode }
  | { kind: "steelseriesSensitivity"; usages: readonly number[]; value: number }
  | { kind: "steelseriesRapidTap"; enabled: boolean }
  | { kind: "steelseriesColor"; red: number; green: number; blue: number }
  | { kind: "steelseriesSave"; slot: number };

/** The on-board profile is a persisted snapshot; live edits come from setter results. */
export class SteelSeriesKeyboardClient implements KeyboardClient {
  readonly family = "steelseries" as const;
  readonly brand = "SteelSeries";
  readonly device: HIDDevice;
  private readonly client: SteelSeriesKeyboardHidClient;
  private status: KeyboardStatus | null = null;
  private identityStatusPending = false;

  constructor(device: HIDDevice) {
    this.device = device;
    this.client = new SteelSeriesKeyboardHidClient(device);
  }

  get name(): string { return this.device.productName || "SteelSeries keyboard"; }
  static isSupported(device: HIDDevice): boolean { return SteelSeriesKeyboardHidClient.isSupported(device); }
  open(): Promise<void> { return this.client.open(); }
  close(): Promise<void> { return this.client.close(); }

  async readIdentity(): Promise<KeyboardIdentityView> {
    const status = await this.client.readStatus();
    this.status = status;
    this.identityStatusPending = true;
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

  private async currentStatus(): Promise<KeyboardStatus> {
    return this.status ?? (this.status = await this.client.readStatus());
  }

  private async withProfile(profile: SteelSeriesApexProfile): Promise<Partial<KeyboardWorkspace>> {
    const status = await this.currentStatus();
    if (!status.steelseries) throw new Error("SteelSeries profile status is unavailable.");
    this.status = { ...status, steelseries: { ...status.steelseries, profile } };
    this.identityStatusPending = false;
    return { vendorStatus: this.status };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    switch (command.kind) {
      case "refresh":
      case "steelseriesRefresh": {
        // Reading flash here would overwrite the driver's live profile cache.
        if (this.status?.steelseries?.profile?.live) return { vendorStatus: this.status };
        if (this.identityStatusPending) {
          this.identityStatusPending = false;
          return { vendorStatus: await this.currentStatus() };
        }
        this.status = await this.client.readStatus();
        return { vendorStatus: this.status };
      }
      case "steelseriesActuation":
        await this.currentStatus();
        return this.withProfile(await this.client.setActuation(command.usages, command.tenthsMm));
      case "steelseriesRelease":
        await this.currentStatus();
        return this.withProfile(await this.client.setReleaseMode(command.usages, command.mode));
      case "steelseriesSensitivity":
        await this.currentStatus();
        return this.withProfile(await this.client.setRapidTriggerSensitivity(command.usages, command.value));
      case "steelseriesRapidTap": {
        const status = await this.currentStatus();
        await this.client.setRapidTap(command.enabled);
        const profile = status.steelseries?.profile;
        if (!profile) return {};
        return this.withProfile({ ...profile, live: true, rapidTapEnabled: command.enabled });
      }
      case "steelseriesColor":
        // Direct lighting has no read-back. Do not display the requested colour as a device value.
        await this.client.setSolidLighting(command.red, command.green, command.blue);
        return {};
      case "steelseriesSave": {
        // saveProfile() refuses a slot that differs from the cached profile,
        // so load the destination first: the persisted write then targets the
        // slot the user picked and live edits apply to it.
        await this.client.readAnalogProfile(command.slot);
        return this.withProfile(await this.client.saveProfile());
      }
      default:
        throw new Error("This command is only for SteelSeries keyboards.");
    }
  }
}
