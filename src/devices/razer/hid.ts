import type { MouseStatus } from "../mouse-types.ts";
import { VENDOR_ID } from "../vendors.ts";
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
  decodeLowPowerThreshold,
  decodeRazerResponse,
  decodeSerial,
  decodeSleepTimeout,
  encodeRazerRequest,
  razerSetDpiCommand,
  razerSetExtendedPollingCommand,
  razerSetLegacyPollingCommand,
  razerSetLowPowerThresholdCommand,
  razerSetSleepTimeoutCommand,
  type RazerCommand,
} from "./protocol.ts";

interface RazerProduct {
  model: string;
  wireless: boolean;
  pollingRates: readonly number[];
  // Defaults to DPI_MAX when omitted
  maxDpi?: number;
}

// The cable tops out at 1000 Hz on this model, which is also the ceiling the
// legacy polling command can encode. HyperPolling rates need the receiver.
const RATES_WIRED: readonly number[] = [125, 500, 1000];
const RATES_RECEIVER: readonly number[] = [125, 500, 1000, 2000, 4000, 8000];

const PRODUCTS: ReadonlyMap<number, RazerProduct> = new Map([
  // Stock receiver, not 8K HyperPolling.
  [0x00a5, { model: "Viper V2 Pro", wireless: false, pollingRates: RATES_WIRED, maxDpi: 30000 }],
  [0x00a6, { model: "Viper V2 Pro", wireless: true, pollingRates: RATES_WIRED, maxDpi: 30000 }],

  [0x00c0, { model: "Viper V3 Pro", wireless: false, pollingRates: RATES_WIRED }],
  [0x00c1, { model: "Viper V3 Pro", wireless: true, pollingRates: RATES_RECEIVER }],
]);

// The sensor takes any whole DPI in this range, per axis, and the vendor
// software exposes the same bounds.
const DPI_MIN = 100;
const DPI_MAX = 35000;
const RESPONSE_DELAY_MS = 100;
const RESPONSE_ATTEMPTS = 6;

// The vendor software slides from 1 to 15 minutes, so those are the bounds this
// model is meant to hold. The firmware itself accepts less — 30 s round-tripped
// exactly, below even the 60 s floor OpenRazer documents — but nothing offers
// that, so it is not offered here either.
const SLEEP_MIN_SECONDS = 60;
const SLEEP_MAX_SECONDS = 900;
const SLEEP_STEP_SECONDS = 60;
// One entry per minute, matching the vendor slider exactly rather than sampling
// it, so no offered value is an interpolation.
const SLEEP_OPTIONS: readonly number[] = Array.from(
  { length: SLEEP_MAX_SECONDS / SLEEP_STEP_SECONDS },
  (_, index) => (index + 1) * SLEEP_STEP_SECONDS,
);

// Synapse slides this from 5 to 100 percent. The value is stored on the battery
// reads' 0–255 scale, so the offered percentages are what round-trip cleanly
// through it rather than every whole percent.
const LOW_POWER_MIN_PERCENT = 5;
const LOW_POWER_MAX_PERCENT = 100;
const LOW_POWER_STEP_PERCENT = 5;
const LOW_POWER_OPTIONS: readonly number[] = Array.from(
  { length: (LOW_POWER_MAX_PERCENT - LOW_POWER_MIN_PERCENT) / LOW_POWER_STEP_PERCENT + 1 },
  (_, index) => LOW_POWER_MIN_PERCENT + index * LOW_POWER_STEP_PERCENT,
);
// Synapse states low power mode is unavailable at 2000 Hz and above, and greys
// the slider out there. The setting still reads, so this bounds the control
// rather than the command.
const LOW_POWER_MAX_POLLING_HZ = 1000;

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

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

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
    return this.profile()?.maxDpi ?? DPI_MAX;
  }

  getSupportedPollingRates(): number[] {
    return [...(this.profile()?.pollingRates ?? RATES_WIRED)];
  }

  /** Seconds, matching what the panel labels and what `setSleepTimeout` takes. */
  getSleepOptions(): number[] {
    return [...SLEEP_OPTIONS];
  }

  /** Whole percentages, matching the vendor slider. */
  getLowPowerOptions(): number[] {
    return [...LOW_POWER_OPTIONS];
  }

  /** The rate above which the vendor software refuses to arm low power mode. */
  getLowPowerPollingCeiling(): number {
    return LOW_POWER_MAX_POLLING_HZ;
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
    // Both transports answer this, unlike polling. A transport that ever stops
    // reports no timeout and hides the control rather than failing the whole
    // read, which would take DPI and battery down with it.
    const sleep = await this.request(RAZER_READ.sleepTimeout).catch(() => null);
    const lowPower = await this.request(RAZER_READ.lowPowerThreshold).catch(() => null);
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
        // Nothing reports link quality on this model, and the section this card
        // shares with sleep is opened below, so it would otherwise appear as a
        // permanent "signal is unavailable" placeholder.
        hideSignalCard: true,
        // Auto sleep is the only card this driver puts in that section, so the
        // section opens only when the mouse actually answered the sleep read.
        showAdvancedSection: sleep !== null,
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
      sleepTimeout: sleep ? decodeSleepTimeout(sleep) : null,
      lowBatteryWarning: lowPower ? decodeLowPowerThreshold(lowPower) : null,
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

  async setSleepTimeout(seconds: number): Promise<number> {
    if (!Number.isInteger(seconds) || seconds < SLEEP_MIN_SECONDS || seconds > SLEEP_MAX_SECONDS) {
      const minutes = SLEEP_MAX_SECONDS / SLEEP_STEP_SECONDS;
      throw new Error(`Auto sleep must be between 1 and ${minutes} minutes.`);
    }
    await this.request(razerSetSleepTimeoutCommand(seconds));
    const confirmed = decodeSleepTimeout(await this.request(RAZER_READ.sleepTimeout));
    if (confirmed !== seconds) {
      throw new Error(`The mouse kept ${confirmed} seconds instead of ${seconds}.`);
    }
    return confirmed;
  }

  async setLowPowerThreshold(percent: number): Promise<number> {
    // A range rather than the offered list: the panel adds the mouse's own value
    // when it sits off the five-point step, and that value must stay writable.
    if (!Number.isInteger(percent) || percent < LOW_POWER_MIN_PERCENT || percent > LOW_POWER_MAX_PERCENT) {
      throw new Error(`Low power mode must be between ${LOW_POWER_MIN_PERCENT}% and ${LOW_POWER_MAX_PERCENT}%.`);
    }
    // Asked of the mouse, not the panel. Staging a polling change repaints the
    // control as disabled without withdrawing a threshold already queued behind
    // it, so the disabled select cannot be what enforces this.
    const pollingRateHz = await this.readPollingRateHz();
    if (pollingRateHz > LOW_POWER_MAX_POLLING_HZ) {
      throw new Error(
        `Low power mode is unavailable at ${pollingRateHz.toLocaleString()} Hz.`
        + ` Set the polling rate to ${LOW_POWER_MAX_POLLING_HZ.toLocaleString()} Hz or lower first.`,
      );
    }
    await this.request(razerSetLowPowerThresholdCommand(percent));
    const confirmed = decodeLowPowerThreshold(await this.request(RAZER_READ.lowPowerThreshold));
    if (confirmed !== percent) {
      throw new Error(`The mouse kept ${confirmed}% instead of ${percent}%.`);
    }
    return confirmed;
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
