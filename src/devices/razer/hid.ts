import type { MouseStatus } from "../mouse-types.ts";
import { VENDOR_ID } from "../vendors.ts";
import {
  RAZER_READ,
  RAZER_REPORT_ID,
  RAZER_STATUS,
  RAZER_TRANSACTION_ID,
  RAZER_TRANSACTION_ID_LEGACY,
  RazerProtocolError,
  decodeBatteryPercent,
  decodeCharging,
  decodeDpi,
  decodeExtendedPollingRate,
  decodeFirmwareVersion,
  decodeLegacyPollingRate,
  decodeRazerResponse,
  decodeSerial,
  encodeRazerRequest,
  razerSetDpiCommand,
  razerSetExtendedPollingCommand,
  razerSetLegacyPollingCommand,
  type RazerCommand,
} from "./protocol.ts";

interface RazerProduct {
  model: string;
  wireless: boolean;
  pollingRates: readonly number[];
  /** Sensor ceiling, per axis. */
  maxDpi: number;
  /** Razer's per-generation transaction id; a mismatch means no reply at all. */
  transactionId: number;
  /** Battery commands only exist on models that have one. */
  hasBattery: boolean;
  /** Also accept a vendor-defined collection as the control interface. */
  vendorControlInterface?: boolean;
}

// The cable tops out at 1000 Hz on this model, which is also the ceiling the
// legacy polling command can encode. HyperPolling rates need the receiver.
const RATES_WIRED: readonly number[] = [125, 500, 1000];
const RATES_RECEIVER: readonly number[] = [125, 500, 1000, 2000, 4000, 8000];

// The DeathAdder Essential's officially published maximum, and the ceiling the
// vendor software offers.
const DEATHADDER_ESSENTIAL = {
  wireless: false,
  pollingRates: RATES_WIRED,
  maxDpi: 6400,
  transactionId: RAZER_TRANSACTION_ID_LEGACY,
  hasBattery: false,
  vendorControlInterface: true,
} as const;

const VIPER_V3_PRO = {
  maxDpi: 35000,
  transactionId: RAZER_TRANSACTION_ID,
  hasBattery: true,
} as const;

const PRODUCTS: ReadonlyMap<number, RazerProduct> = new Map([
  [0x00c0, { model: "Viper V3 Pro", wireless: false, pollingRates: RATES_WIRED, ...VIPER_V3_PRO }],
  [0x00c1, { model: "Viper V3 Pro", wireless: true, pollingRates: RATES_RECEIVER, ...VIPER_V3_PRO }],
  [0x006e, { model: "DeathAdder Essential", ...DEATHADDER_ESSENTIAL }],
  [0x0071, { model: "DeathAdder Essential White Edition", ...DEATHADDER_ESSENTIAL }],
  [0x0098, { model: "DeathAdder Essential (2021)", ...DEATHADDER_ESSENTIAL }],
]);

// The sensor takes any whole DPI from here up to the model's ceiling, per axis.
const DPI_MIN = 100;
const RESPONSE_DELAY_MS = 100;
const RESPONSE_ATTEMPTS = 6;

/**
 * Razer exposes its control channel on the interface whose only collection is
 * Generic Desktop Mouse. Every other interface either belongs to a different
 * function or is a protected collection the browser will not talk to.
 */
function isMouseControlInterface(device: HIDDevice): boolean {
  const [collection, ...rest] = device.collections;
  return rest.length === 0 && collection?.usagePage === 0x01 && collection?.usage === 0x02;
}

/**
 * Older Razer mice carry the configuration channel on a vendor-defined
 * interface instead, and which one varies by hardware revision. Accepting both
 * shapes means the picker can offer either without the driver refusing it.
 */
function hasVendorCollection(device: HIDDevice): boolean {
  return device.collections.some((collection) => (collection.usagePage ?? 0) >= 0xff00);
}

export class RazerHidClient {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly staticReads = new Map<string, Promise<Uint8Array | null>>();

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    const product = PRODUCTS.get(device.productId);
    if (device.vendorId !== VENDOR_ID.razer || !product) return false;
    return isMouseControlInterface(device)
      || (product.vendorControlInterface === true && hasVendorCollection(device));
  }

  private profile(): RazerProduct | undefined {
    return PRODUCTS.get(this.device.productId);
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    this.staticReads.clear();
    if (this.device.opened) await this.device.close();
  }

  displayName(): string {
    const known = this.profile();
    return known ? `Razer ${known.model}` : this.device.productName || "Razer";
  }

  isWireless(): boolean {
    return this.profile()?.wireless ?? false;
  }

  maxDpi(): number {
    return this.profile()?.maxDpi ?? 35000;
  }

  getSupportedPollingRates(): number[] {
    return [...(this.profile()?.pollingRates ?? RATES_WIRED)];
  }

  /** Every whole value, because the control validates entries against this list. */
  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_MIN; dpi <= this.maxDpi(); dpi += 1) options.push(dpi);
    return options;
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const wireless = this.isWireless();
    const firmware = await this.once("firmware", () => this.request(RAZER_READ.firmware));
    if (!firmware) throw new Error("The mouse did not report a firmware version.");
    const serial = await this.once("serial", () => this.request(RAZER_READ.serial).catch(() => null));
    // A mouse with no cell answers the battery commands as unsupported, which
    // would abort the whole read, so skip them rather than catching the error.
    const battery = this.profile()?.hasBattery === false ? null : await this.readBattery();
    const dpi = decodeDpi(await this.request(RAZER_READ.dpi));
    const pollingRateHz = await this.readPollingRateHz();
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
        forceShowBattery: battery ? true : undefined,
        defaultDisplayName: this.profile()?.model,
      },
      batteryPercent: battery?.percent ?? null,
      batteryState: battery?.state ?? "Unknown",
      dpi: dpi.x,
      dpiY: dpi.y,
      supportsSeparateDpiAxes: true,
      pollingRateHz,
      supportedPollingRates: this.getSupportedPollingRates(),
      activeProfile: null,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: wireless ? "HyperSpeed receiver" : "Wired USB",
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
    const confirmed = decodeDpi(await this.request(RAZER_READ.dpi));
    if (confirmed.x !== dpi || confirmed.y !== dpiY) {
      throw new Error(`The mouse kept ${confirmed.x.toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
    }
    return confirmed.x;
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    if (!this.getSupportedPollingRates().includes(pollingRateHz)) {
      throw new Error(`This mouse does not support ${pollingRateHz.toLocaleString()} Hz on this connection.`);
    }
    await this.request(this.isWireless()
      ? razerSetExtendedPollingCommand(pollingRateHz)
      : razerSetLegacyPollingCommand(pollingRateHz));
    const confirmed = await this.readPollingRateHz();
    if (confirmed !== pollingRateHz) {
      throw new Error(`The mouse kept ${confirmed.toLocaleString()} Hz instead of ${pollingRateHz.toLocaleString()} Hz.`);
    }
    return confirmed;
  }

  private async readBattery(): Promise<{ percent: number; state: MouseStatus["batteryState"] }> {
    const level = await this.request(RAZER_READ.battery);
    const charging = decodeCharging(await this.request(RAZER_READ.charging));
    return { percent: decodeBatteryPercent(level), state: charging ? "Charging" : "Discharging" };
  }

  /**
   * Wired answers only the legacy command and the receiver only the extended
   * one, so ask for the expected one first and keep the other as a fallback.
   * Asking in the wrong order costs a failed exchange on every refresh.
   */
  private async readPollingRateHz(): Promise<number> {
    const extended = [RAZER_READ.pollingRateExtended, decodeExtendedPollingRate] as const;
    const legacy = [RAZER_READ.pollingRate, decodeLegacyPollingRate] as const;
    for (const [command, decode] of this.isWireless() ? [extended, legacy] : [legacy, extended]) {
      const reply = await this.request(command).catch(() => null);
      if (reply) return decode(reply);
    }
    throw new Error("The mouse did not report a polling rate.");
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
    const transactionId = this.profile()?.transactionId ?? RAZER_TRANSACTION_ID;
    await this.device.sendFeatureReport(RAZER_REPORT_ID, encodeRazerRequest(command, transactionId));
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
