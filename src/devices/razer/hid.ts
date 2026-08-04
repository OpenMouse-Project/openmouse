import type { MouseStatus } from "../mouse-types";
import { VENDOR_ID } from "../vendors";
import {
  RAZER_READ,
  RAZER_REPORT_ID,
  RAZER_STATUS,
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
} from "./protocol";

interface RazerProduct {
  model: string;
  wireless: boolean;
  pollingRates: readonly number[];
}

// The cable tops out at 1000 Hz on this model, which is also the ceiling the
// legacy polling command can encode. HyperPolling rates need the receiver.
const RATES_WIRED: readonly number[] = [125, 500, 1000];
const RATES_RECEIVER: readonly number[] = [125, 500, 1000, 2000, 4000, 8000];

const PRODUCTS: ReadonlyMap<number, RazerProduct> = new Map([
  [0x00c0, { model: "Viper V3 Pro", wireless: false, pollingRates: RATES_WIRED }],
  [0x00c1, { model: "Viper V3 Pro", wireless: true, pollingRates: RATES_RECEIVER }],
]);

// The sensor takes any whole DPI in this range, per axis, and the vendor
// software exposes the same bounds.
const DPI_MIN = 100;
const DPI_MAX = 35000;
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

export class RazerHidClient {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly staticReads = new Map<string, Promise<Uint8Array | null>>();

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID.razer
      && PRODUCTS.has(device.productId)
      && isControlInterface(device);
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
    return DPI_MAX;
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
    const battery = await this.request(RAZER_READ.battery);
    const charging = decodeCharging(await this.request(RAZER_READ.charging));
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
        forceShowBattery: true,
        defaultDisplayName: this.profile()?.model,
      },
      batteryPercent: decodeBatteryPercent(battery),
      batteryState: charging ? "Charging" : "Discharging",
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
    await this.device.sendFeatureReport(RAZER_REPORT_ID, encodeRazerRequest(command));
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
