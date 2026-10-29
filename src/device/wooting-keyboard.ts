import { WootingHidClient } from "@openmouse/keyboard-protocol/drivers/wooting/hid";
import type { KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import type { KeyboardClient } from "./keyboard-client.ts";
import type { KeyboardCommand, KeyboardWorkspace, WootingRgbView } from "./keyboard-workspace.ts";
import type { KeyboardIdentityView } from "./types.ts";

/** The driver falls back to a hex dump when the serial reply is not text; that is not a serial number. */
function readableSerial(serial: string | null): string | null {
  return serial && !/^[0-9a-f]{2}( [0-9a-f]{2})+$/i.test(serial) ? serial : null;
}

/** Panel adapter: reads status and saves the active profile's default actuation and rapid trigger. */
export class WootingKeyboardClient implements KeyboardClient {
  readonly family = "wooting";
  readonly brand = "Wooting";
  get name(): string { return this.device.productName || "Wooting keyboard"; }
  readonly device: HIDDevice;
  private client: WootingHidClient;
  private initialStatus: KeyboardStatus | null = null;

  constructor(device: HIDDevice) {
    this.device = device;
    this.client = new WootingHidClient(device);
  }

  static isSupported(device: HIDDevice): boolean { return WootingHidClient.isSupported(device); }
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
      serial: readableSerial(status.serial),
    };
  }

  async command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    if (command.kind === "wootingKeyActuation") {
      // Reads the full override block, patches each key and verifies by read-back.
      const keys = typeof command.keys === "number" ? [command.keys] : command.keys;
      for (const key of keys) {
        try {
          await this.client.editPerKeyActuation(key, command.actuationMm, true);
        } catch (error) {
          // A few ARM builds acknowledge 0x15 before 0x31 reflects the write.
          // Reopen and check the target key before reporting a failure.
          this.initialStatus = null;
          const fresh = await this.reopenAndRead().catch(() => null);
          const actual = fresh?.perKeyActuation?.overrides.find((override) => override.key === key)?.actuationMm ?? null;
          const matches = command.actuationMm === null
            ? actual === null
            : actual !== null && Math.round(actual * 100) === Math.round(command.actuationMm * 100);
          if (!matches) {
            const reason = error instanceof Error ? error.message : "Wooting per-key actuation save failed.";
            const readable = actual === null ? "no override" : `${actual.toFixed(2)} mm`;
            throw new Error(`${reason} Profile ${fresh?.activeProfile ?? "?"}, key ${key} reads ${readable}.`);
          }
        }
      }
      this.initialStatus = null;
      return { wooting: await this.reopenAndRead() };
    }
    if (command.kind === "wootingKeyRapidTrigger") {
      // Reads the full group store, patches the keys and verifies by read-back.
      await this.client.editPerKeyRapidTrigger(command.keys, command.target, true);
      this.initialStatus = null;
      return { wooting: await this.reopenAndRead() };
    }
    if (command.kind === "wootingRgbApply") {
      if (command.core) await this.client.writeRgbCore(command.core);
      if (command.colors1) await this.client.writeRgbColors(1, command.colors1, true);
      if (command.colors2) await this.client.writeRgbColors(2, command.colors2, true);
      if (command.save) {
        const active = (await this.client.readStatus()).activeProfile;
        if (active === null) throw new Error("Could not identify the active Wooting profile.");
        await this.client.saveProfile(0x08, active, true);
      }
      this.initialStatus = null;
      const status = await this.reopenAndRead();
      return { wooting: status, wootingRgb: await this.readRgbView() };
    }
    if (command.kind === "wootingProfileSwitch") {
      await this.client.switchProfile(command.slot);
      this.initialStatus = null;
      const status = await this.reopenAndRead();
      return { wooting: status, wootingRgb: await this.readRgbView() };
    }
    if (command.kind === "wootingAkcItem") {
      await this.client.editAkcItem(0, command.keyIndex, command.layer, command.payload, true);
      this.initialStatus = null;
      return { wooting: await this.reopenAndRead() };
    }
    if (command.kind === "wootingAnalog") {
      const { kind: _kind, ...changes } = command;
      // The driver verifies the write by reading the profile back; throws if the board ignored it.
      await this.client.writeAnalogDefaults(changes, true);
      this.initialStatus = null;
      return { wooting: await this.reopenAndRead() };
    }
    if (command.kind !== "refresh") throw new Error("Wooting settings are read-only during driver testing.");
    if (this.initialStatus) {
      const status = this.initialStatus;
      this.initialStatus = null;
      return { wooting: status, wootingRgb: await this.readRgbView() };
    }
    const status = await this.reopenAndRead();
    return { wooting: status, wootingRgb: await this.readRgbView() };
  }

  /** Typed RGB core and both color pages; null when the board does not answer. */
  private async readRgbView(): Promise<WootingRgbView | null> {
    if (typeof this.client.readRgbCore !== "function") return null;
    const [core, colors1, colors2] = await Promise.all([
      this.client.readRgbCore().catch(() => null),
      this.client.readRgbColors(1).catch(() => null),
      this.client.readRgbColors(2).catch(() => null),
    ]);
    return core || colors1 || colors2 ? { core, colors1, colors2 } : null;
  }

  /** The driver caches probe replies per connection. Reopen for a fresh read. */
  private async reopenAndRead(): Promise<KeyboardStatus> {
    await this.client.close();
    this.client = new WootingHidClient(this.device);
    await this.client.open();
    return this.client.readStatus();
  }
}
