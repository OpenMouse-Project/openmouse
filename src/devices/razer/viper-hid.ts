import type { MouseStatus } from "../mouse-types.ts";
import { VENDOR_ID } from "../vendors.ts";
import {
  RAZER_READ,
  RAZER_REPORT_ID,
  RAZER_STATUS,
  RazerProtocolError,
  decodeDpi,
  decodeFirmwareVersion,
  decodeLegacyPollingRate,
  decodeRazerResponse,
  decodeSerial,
  encodeRazerRequest,
  razerSetDpiCommand,
  razerSetLegacyPollingCommand,
  type RazerCommand,
} from "./protocol.ts";

export const VIPER_PRODUCT_ID = 0x0078;

/**
 * Transaction id used by openrazer's legacy group (Viper / Viper Ultimate);
 * kept separate from `0x1f`, verified on the newer Viper V3 Pro firmware.
 */
export const VIPER_TRANSACTION_ID = 0xff;

// Openrazer reads DPI with the no-store byte and writes with the storage byte.
export const VIPER_DPI_READ: RazerCommand = {
  commandClass: 0x04,
  commandId: 0x85,
  dataSize: 0x07,
  args: [0x00],
};

// Wired-only, so the legacy polling command (a divisor of 1000) covers every rate.
const RATES_WIRED: readonly number[] = [125, 500, 1000];
const DPI_MIN = 100;
const DPI_MAX = 8500;
const RESPONSE_DELAY_MS = 100;
const RESPONSE_ATTEMPTS = 6;

/**
 * Razer exposes its control channel on the interface whose only collection is
 * Generic Desktop Mouse. Every other interface either belongs to a different
 * function or is a protected collection the browser will not talk to.
 */
function isControlInterface(device: HIDDevice): boolean {
  const [collection, ...rest] = device.collections;
  return rest.length === 0 && collection?.usagePage === 0x01 && collection?.usage === 0x02;
}

export class RazerViperHidClient {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly staticReads = new Map<string, Promise<Uint8Array | null>>();

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID.razer
      && device.productId === VIPER_PRODUCT_ID
      && isControlInterface(device);
  }

  async open(): Promise<void> {
    // On Linux "Failed to open the device" means the hidraw node for 1532:0078
    // is root-owned or the razermouse kernel driver claimed the interface.
    // Fix: udev rule granting plugdev access to that vendor/product, then
    // `sudo rmmod razermouse`.
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    this.staticReads.clear();
    if (this.device.opened) await this.device.close();
  }

  displayName(): string {
    return this.device.productName || "Razer Viper";
  }

  isWireless(): boolean {
    return false;
  }

  maxDpi(): number {
    return DPI_MAX;
  }

  getSupportedPollingRates(): number[] {
    return [...RATES_WIRED];
  }

  /** Every whole value, because the control validates entries against this list. */
  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_MIN; dpi <= this.maxDpi(); dpi += 1) options.push(dpi);
    return options;
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const firmware = await this.once("firmware", () => this.request(RAZER_READ.firmware));
    if (!firmware) throw new Error("The mouse did not report a firmware version.");
    const serial = await this.once("serial", () => this.request(RAZER_READ.serial).catch(() => null));
    const dpi = decodeDpi(await this.request(VIPER_DPI_READ));
    const pollingRateHz = decodeLegacyPollingRate(await this.request(RAZER_READ.pollingRate));
    return {
      brand: "Razer",
      name: this.displayName(),
      ui: {
        family: "razer",
        settingsReady: true,
        valuesVerified: true,
        hideUnsupportedPollingRates: true,
        // No lift-off or sensor-processing command is confirmed, so neither
        // control is offered rather than offered and left inert.
        hideProcessingCard: true,
        defaultDisplayName: "Viper",
      },
      // Wired-only model: openrazer exposes no battery attribute, so neither
      // the level nor the charging query is sent.
      batteryPercent: null,
      batteryState: "Unknown",
      dpi: dpi.x,
      dpiY: dpi.y,
      supportsSeparateDpiAxes: true,
      pollingRateHz,
      supportedPollingRates: this.getSupportedPollingRates(),
      activeProfile: null,
      connectionType: "Wired",
      connectionDetail: "Wired USB",
      unitId: serial ? decodeSerial(serial) : null,
      liftOffDistance: null,
      supportedLiftOffDistances: [],
      firmware: [`Mouse ${decodeFirmwareVersion(firmware)}`],
    };
  }

  async setDpi(dpi: number, dpiY: number = dpi): Promise<number> {
    const ceiling = this.maxDpi();
    for (const value of [dpi, dpiY]) {
      if (!Number.isInteger(value) || value < DPI_MIN || value > ceiling) {
        throw new Error(`DPI must be a whole number between ${DPI_MIN} and ${ceiling.toLocaleString()}.`);
      }
    }
    await this.request(razerSetDpiCommand(dpi, dpiY));
    const confirmed = decodeDpi(await this.request(VIPER_DPI_READ));
    if (confirmed.x !== dpi || confirmed.y !== dpiY) {
      throw new Error(`The mouse kept ${confirmed.x.toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
    }
    return confirmed.x;
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    if (!this.getSupportedPollingRates().includes(pollingRateHz)) {
      throw new Error(`This mouse does not support ${pollingRateHz.toLocaleString()} Hz on this connection.`);
    }
    await this.request(razerSetLegacyPollingCommand(pollingRateHz));
    const confirmed = decodeLegacyPollingRate(await this.request(RAZER_READ.pollingRate));
    if (confirmed !== pollingRateHz) {
      throw new Error(`The mouse kept ${confirmed.toLocaleString()} Hz instead of ${pollingRateHz.toLocaleString()} Hz.`);
    }
    return confirmed;
  }

  private once(key: string, read: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
    const pending = this.staticReads.get(key);
    if (pending) return pending;
    const started = read();
    this.staticReads.set(key, started);
    started.catch(() => this.staticReads.delete(key));
    return started;
  }

  private async request(command: RazerCommand): Promise<Uint8Array> {
    const run = this.queue.then(() => this.exchange(command), () => this.exchange(command));
    this.queue = run.catch(() => undefined);
    return await run;
  }

  private async exchange(command: RazerCommand): Promise<Uint8Array> {
    await this.open();
    await this.device.sendFeatureReport(RAZER_REPORT_ID, encodeRazerRequest(command, VIPER_TRANSACTION_ID));
    for (let attempt = 0; attempt < RESPONSE_ATTEMPTS; attempt += 1) {
      await this.delay(RESPONSE_DELAY_MS);
      const reply = this.copyDataView(await this.device.receiveFeatureReport(RAZER_REPORT_ID));
      try {
        return decodeRazerResponse(reply, command);
      } catch (error) {
        if (error instanceof RazerProtocolError && error.status === RAZER_STATUS.busy) continue;
        throw error;
      }
    }
    throw new Error("The mouse stayed busy — it may be asleep or out of range.");
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
