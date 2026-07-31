import type { MouseStatus } from "./mouse-types";

/**
 * Endgame Gear WE-series wireless mice (OP1we, shared dongle, etc.).
 *
 * Same structural style as egg-op1-hid.ts (product map, feature reports,
 * verified setters) but a different CompX/WE command set — not the wired
 * OP1 8K 1041-byte config blob.
 *
 * Battery command 0xb4 is publicly reverse-engineered. Other setting
 * commands follow the same feature-report shell and must re-read to confirm;
 * adjust COMMAND / parse offsets after USB capture of WE Series software if
 * a firmware revision disagrees.
 */

const EGG_VENDOR_ID = 0x3367;

/** Wired mice report charging; the shared dongle is wireless. */
const SUPPORTED_PRODUCTS = new Map<number, { name: string; wired: boolean }>([
  [0x1972, { name: "Endgame Gear OP1we", wired: true }],
  [0x1970, { name: "Endgame Gear wireless receiver", wired: false }],
  // Other WE-family PIDs (same transport); safe to claim when present.
  [0x1968, { name: "Endgame Gear XM2we", wired: true }],
  [0x1982, { name: "Endgame Gear XM2w v2", wired: true }],
]);

const REPORT_SIZE = 64;
const REPORT = {
  /** Write / set-feature shell (mirrors 8K report id family). */
  write: 0xa0,
  /** Read / get-feature shell used by battery and status commands. */
  read: 0xa1,
} as const;

/**
 * Feature-report command byte (buffer[1] after report id).
 * battery is verified; remaining IDs are provisional WE-series peers of 0xb4
 * and are confirmed only when re-read matches.
 */
const COMMAND = {
  battery: 0xb4,
  /** Device status block: CPI, polling, LOD, debounce packed in one reply. */
  status: 0xb0,
  dpi: 0xb1,
  polling: 0xb2,
  lod: 0xb3,
  debounce: 0xb5,
  firmware: 0xb6,
} as const;

/** Offsets inside a successful status (0xb0) or setting response payload. */
const STATUS = {
  dpiLo: 4,
  dpiHi: 5,
  polling: 6,
  lod: 7,
  debounce: 8,
  firmwareMajor: 10,
  firmwareMinor: 11,
} as const;

const POLLING_RATES = [125, 250, 500, 1000] as const;
const DEFAULT_DPI = 800;
const DEFAULT_POLLING = 1000;
const DEFAULT_DEBOUNCE = 3;

export class EggWeHidClient {
  private commandQueue: Promise<unknown> = Promise.resolve();

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === EGG_VENDOR_ID
      && SUPPORTED_PRODUCTS.has(device.productId)
      && device.collections.some((collection) =>
        this.collectionHasFeatureReport(collection, REPORT.read));
  }

  private static collectionHasFeatureReport(collection: HIDCollectionInfo, reportId: number): boolean {
    return collection.featureReports.some((report) => report.reportId === reportId)
      || collection.children.some((child) => this.collectionHasFeatureReport(child, reportId));
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  describeCollections(): string {
    return this.device.collections.map((collection) => {
      const reports = collection.featureReports.map((report) => `0x${report.reportId.toString(16)}`);
      return `usage 0x${collection.usagePage.toString(16)}:0x${collection.usage.toString(16)} · feature ${reports.join(", ") || "none"}`;
    }).join(" | ") || "No HID collections reported";
  }

  getDpiOptions(): number[] {
    const values: number[] = [];
    for (let dpi = 50; dpi <= 19000; dpi += 50) values.push(dpi);
    return values;
  }

  get supportedPollingRates(): number[] {
    return [...POLLING_RATES];
  }

  private productMeta(): { name: string; wired: boolean } {
    return SUPPORTED_PRODUCTS.get(this.device.productId)
      ?? { name: this.device.productName || "Endgame Gear WE mouse", wired: false };
  }

  async readStatus(): Promise<MouseStatus> {
    const meta = this.productMeta();
    const battery = await this.readBattery();
    const state = await this.readDeviceState().catch(() => null);
    const firmware = await this.readFirmware().catch(() => null);
    const dpi = state?.dpi ?? DEFAULT_DPI;
    const pollingRateHz = state?.pollingRateHz ?? DEFAULT_POLLING;
    const debounceMs = state?.debounceMs ?? DEFAULT_DEBOUNCE;
    const liftOffDistance = state?.liftOffDistance ?? "Medium";

    if (!this.getDpiOptions().includes(dpi)) {
      throw new Error(`The mouse reported an unsupported ${dpi} CPI value.`);
    }
    if (!POLLING_RATES.includes(pollingRateHz as (typeof POLLING_RATES)[number])) {
      throw new Error(`The mouse reported an unsupported ${pollingRateHz} Hz polling rate.`);
    }

    return {
      brand: "Endgame Gear",
      name: meta.name,
      batteryPercent: battery.percent,
      batteryState: battery.state,
      dpi,
      pollingRateHz,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: meta.wired ? "Wired" : "Wireless",
      connectionDetail: `${meta.wired ? "Wired USB" : "2.4 GHz dongle"} · PID 0x${this.device.productId.toString(16).toUpperCase()} · WE protocol`,
      debounceMs,
      liftOffDistance,
      firmware: firmware
        ? [`Firmware ${firmware}`]
        : state?.firmware
          ? [`Firmware ${state.firmware}`]
          : ["Firmware unavailable"],
    };
  }

  async setDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) {
      throw new Error("OP1we CPI must be between 50 and 19,000 in 50 CPI steps.");
    }
    await this.writeSetting(COMMAND.dpi, [dpi & 0xff, (dpi >> 8) & 0xff]);
    const confirmed = (await this.readDeviceState()).dpi;
    if (confirmed !== dpi) {
      throw new Error(`The mouse kept ${confirmed} CPI instead of ${dpi} CPI.`);
    }
    return confirmed;
  }

  async setPollingRate(rate: number): Promise<number> {
    if (!POLLING_RATES.includes(rate as (typeof POLLING_RATES)[number])) {
      throw new Error("Unsupported OP1we polling rate. Use 125, 250, 500, or 1000 Hz.");
    }
    await this.writeSetting(COMMAND.polling, [this.encodePolling(rate)]);
    const confirmed = (await this.readDeviceState()).pollingRateHz;
    if (confirmed !== rate) {
      throw new Error(`The mouse kept ${confirmed} Hz instead of ${rate} Hz.`);
    }
    return confirmed;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    if (value === "Low") {
      throw new Error("The OP1we supports Medium or High lift-off distance.");
    }
    const encoded = value === "Medium" ? 1 : 2;
    await this.writeSetting(COMMAND.lod, [encoded]);
    const confirmed = (await this.readDeviceState()).liftOffDistance;
    if (confirmed !== value) {
      throw new Error("The mouse did not confirm the requested lift-off distance.");
    }
  }

  async setDebounceTime(milliseconds: number): Promise<number> {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 15) {
      throw new Error("Debounce must be an integer from 0 to 15 ms.");
    }
    await this.writeSetting(COMMAND.debounce, [milliseconds]);
    const confirmed = (await this.readDeviceState()).debounceMs;
    if (confirmed !== milliseconds) {
      throw new Error(`The mouse kept ${confirmed} ms debounce instead of ${milliseconds} ms.`);
    }
    return confirmed;
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  /**
   * Dump raw responses for commands near the known battery command.
   * Useful while reverse-engineering WE Series software traffic.
   */
  async probeCommands(from = 0xa8, to = 0xc0): Promise<string> {
    const lines: string[] = [];
    for (let command = from; command <= to; command += 1) {
      try {
        const response = await this.query(command, { wake: command === COMMAND.battery });
        const hex = [...response].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
        lines.push(`0x${command.toString(16)}: ${hex}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed";
        lines.push(`0x${command.toString(16)}: ${message}`);
      }
    }
    return lines.join("\n");
  }

  private async readBattery(): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    // Public WE battery protocol: double-read with wake delays.
    const first = await this.query(COMMAND.battery, { wake: true });
    void first;
    await this.delay(100);
    const response = await this.query(COMMAND.battery, { wake: true });
    const statusByte = response[1];
    if (statusByte !== 0x01 && statusByte !== 0x08) {
      // Still surface a best-effort percentage if the payload looks sane.
      const maybe = response[16];
      if (maybe !== undefined && maybe <= 100) {
        return {
          percent: maybe,
          state: this.productMeta().wired ? "Charging" : "Discharging",
        };
      }
      return { percent: null, state: "Unknown" };
    }
    const percent = Math.min(response[16] ?? 0, 100);
    return {
      percent,
      state: this.productMeta().wired ? "Charging" : "Discharging",
    };
  }

  private async readDeviceState(): Promise<{
    dpi: number;
    pollingRateHz: number;
    liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]>;
    debounceMs: number;
    firmware: string | null;
  }> {
    // Prefer a dedicated status block; fall back to piecing individual reads.
    try {
      const block = await this.query(COMMAND.status);
      if (this.looksLikeStatus(block)) return this.parseStatusBlock(block);
    } catch {
      // Individual commands below.
    }

    const dpiPacket = await this.query(COMMAND.dpi).catch(() => null);
    const pollingPacket = await this.query(COMMAND.polling).catch(() => null);
    const lodPacket = await this.query(COMMAND.lod).catch(() => null);
    const debouncePacket = await this.query(COMMAND.debounce).catch(() => null);

    const dpi = dpiPacket
      ? (dpiPacket[STATUS.dpiLo] | (dpiPacket[STATUS.dpiHi] << 8))
      : DEFAULT_DPI;
    const pollingRateHz = pollingPacket
      ? this.decodePolling(pollingPacket[STATUS.polling] ?? pollingPacket[2] ?? 0)
      : DEFAULT_POLLING;
    const lodRaw = lodPacket?.[STATUS.lod] ?? lodPacket?.[2] ?? 1;
    const liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]> =
      lodRaw === 2 ? "High" : "Medium";
    const debounceMs = debouncePacket?.[STATUS.debounce] ?? debouncePacket?.[2] ?? DEFAULT_DEBOUNCE;

    return {
      dpi: this.clampDpi(dpi),
      pollingRateHz: POLLING_RATES.includes(pollingRateHz as (typeof POLLING_RATES)[number])
        ? pollingRateHz
        : DEFAULT_POLLING,
      liftOffDistance,
      debounceMs: Math.min(Math.max(debounceMs, 0), 15),
      firmware: null,
    };
  }

  private parseStatusBlock(block: Uint8Array): {
    dpi: number;
    pollingRateHz: number;
    liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]>;
    debounceMs: number;
    firmware: string | null;
  } {
    const dpi = this.clampDpi(block[STATUS.dpiLo] | (block[STATUS.dpiHi] << 8));
    const pollingRateHz = this.decodePolling(block[STATUS.polling]);
    const liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]> =
      block[STATUS.lod] === 2 ? "High" : "Medium";
    const debounceMs = Math.min(Math.max(block[STATUS.debounce] ?? DEFAULT_DEBOUNCE, 0), 15);
    const major = block[STATUS.firmwareMajor];
    const minor = block[STATUS.firmwareMinor];
    const firmware = major !== undefined && minor !== undefined
      ? `${major}.${minor}`
      : null;
    return {
      dpi,
      pollingRateHz: POLLING_RATES.includes(pollingRateHz as (typeof POLLING_RATES)[number])
        ? pollingRateHz
        : DEFAULT_POLLING,
      liftOffDistance,
      debounceMs,
      firmware,
    };
  }

  private looksLikeStatus(block: Uint8Array): boolean {
    const dpi = block[STATUS.dpiLo] | (block[STATUS.dpiHi] << 8);
    const polling = this.decodePolling(block[STATUS.polling]);
    const lod = block[STATUS.lod];
    const debounce = block[STATUS.debounce];
    return dpi >= 50 && dpi <= 19000 && dpi % 50 === 0
      && POLLING_RATES.includes(polling as (typeof POLLING_RATES)[number])
      && (lod === 1 || lod === 2)
      && debounce !== undefined && debounce <= 15;
  }

  private async readFirmware(): Promise<string | null> {
    const response = await this.query(COMMAND.firmware);
    const major = response[2] ?? response[STATUS.firmwareMajor];
    const minor = response[3] ?? response[STATUS.firmwareMinor];
    if (major === undefined || minor === undefined) return null;
    if (major === 0 && minor === 0) return null;
    return `${major}.${minor}`;
  }

  private async writeSetting(command: number, payload: number[]): Promise<void> {
    await this.open();
    const packet = new Uint8Array(REPORT_SIZE);
    packet[0] = REPORT.write;
    packet[1] = command;
    packet[2] = payload.length;
    for (let index = 0; index < payload.length; index += 1) {
      packet[3 + index] = payload[index] & 0xff;
    }
    // WebHID sendFeatureReport omits report id from the data argument.
    await this.device.sendFeatureReport(REPORT.write, packet.slice(1));
    await this.delay(50);
  }

  private query(command: number, options: { wake?: boolean } = {}): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      await this.open();
      const packet = new Uint8Array(REPORT_SIZE);
      packet[0] = REPORT.read;
      packet[1] = command;
      await this.device.sendFeatureReport(REPORT.read, packet.slice(1));
      if (options.wake) await this.delay(350);
      else await this.delay(40);
      const view = await this.device.receiveFeatureReport(REPORT.read);
      return this.copyDataView(view);
    };
    const next = this.commandQueue.then(run, run);
    this.commandQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private encodePolling(rate: number): number {
    const table: Record<number, number> = { 125: 8, 250: 4, 500: 2, 1000: 1 };
    const encoded = table[rate];
    if (!encoded) throw new Error("Unsupported OP1we polling rate.");
    return encoded;
  }

  private decodePolling(value: number): number {
    const table: Record<number, number> = {
      1: 1000, 2: 500, 4: 250, 8: 125,
      125: 125, 250: 250, 500: 500, 1000: 1000,
    };
    return table[value] ?? value;
  }

  private clampDpi(dpi: number): number {
    if (this.getDpiOptions().includes(dpi)) return dpi;
    // Round to nearest legal step when firmware returns a slightly off value.
    const stepped = Math.round(dpi / 50) * 50;
    if (this.getDpiOptions().includes(stepped)) return stepped;
    return DEFAULT_DPI;
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
