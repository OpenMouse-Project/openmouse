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
  type RazerCommand,
} from "./protocol";

interface RazerProduct {
  model: string;
  wireless: boolean;
}

const PRODUCTS: ReadonlyMap<number, RazerProduct> = new Map([
  [0x00c0, { model: "Viper V3 Pro", wireless: false }],
  [0x00c1, { model: "Viper V3 Pro", wireless: true }],
]);

const DPI_STEP = 50;
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

  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_STEP; dpi <= this.maxDpi(); dpi += DPI_STEP) options.push(dpi);
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
        // Reads are verified; no write command has been confirmed yet.
        settingsReady: false,
        forceShowBattery: true,
        defaultDisplayName: this.profile()?.model,
      },
      batteryPercent: decodeBatteryPercent(battery),
      batteryState: charging ? "Charging" : "Discharging",
      dpi: dpi.x,
      dpiY: dpi.y,
      pollingRateHz,
      activeProfile: null,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: wireless ? "HyperSpeed receiver" : "Wired USB",
      unitId: serial ? decodeSerial(serial) : null,
      liftOffDistance: null,
      firmware: [`Mouse ${decodeFirmwareVersion(firmware)}`],
    };
  }

  /** Wireless answers only the extended command, wired only the legacy one. */
  private async readPollingRateHz(): Promise<number> {
    const extended = await this.request(RAZER_READ.pollingRateExtended).catch(() => null);
    if (extended) return decodeExtendedPollingRate(extended);
    const legacy = await this.request(RAZER_READ.pollingRate).catch(() => null);
    if (legacy) return decodeLegacyPollingRate(legacy);
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
