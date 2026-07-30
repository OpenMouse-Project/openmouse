import type { MouseStatus } from "./mouse-types";

const EGG_VENDOR_ID = 0x3367;
const SUPPORTED_PRODUCTS = new Map<number, string>([
  [0x1964, "Endgame Gear OP1 8K"],
  [0x1966, "Endgame Gear XM2 8K"],
  [0x1976, "Endgame Gear OP1 8K Purple Frost"],
  [0x1978, "Endgame Gear OP1 8K v2"],
]);

const CONFIG_SIZE = 1041;
const COMMAND_SIZE = 64;
const REPORT = {
  read: 0xa1,
  write: 0xa0,
} as const;
const COMMAND = {
  firmware: 0x02,
  write: 0x11,
  read: 0x12,
} as const;
const OFFSET = {
  pollingDivider: 21,
  lod: 25,
  angleSnapping: 26,
  rippleControl: 27,
  motionSync: 28,
  cpiLevels: 30,
  firstCpiSplit: 51,
  firstCpiX: 52,
  firstCpiY: 54,
} as const;

const POLLING_RATES = [1000, 2000, 4000, 8000] as const;

export class EggOp1HidClient {
  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === EGG_VENDOR_ID
      && SUPPORTED_PRODUCTS.has(device.productId)
      && device.collections.some((collection) => this.collectionHasFeatureReport(collection, REPORT.read));
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
    for (let dpi = 50; dpi <= 26000; dpi += 50) values.push(dpi);
    return values;
  }

  async readStatus(): Promise<MouseStatus> {
    // Feature-report requests share one endpoint and must not overlap.
    const config = await this.readConfig();
    const firmware = await this.readFirmware();
    const dpi = this.readUint16LE(config, OFFSET.firstCpiX);
    if (!this.getDpiOptions().includes(dpi)) throw new Error(`The mouse reported an unsupported ${dpi} CPI value.`);
    return {
      brand: "Endgame Gear",
      name: SUPPORTED_PRODUCTS.get(this.device.productId) ?? this.device.productName ?? "Endgame Gear OP1 8K",
      batteryPercent: null,
      batteryState: "Unknown",
      dpi,
      pollingRateHz: this.decodePollingRate(config[OFFSET.pollingDivider]),
      activeProfile: null,
      connectionDetail: `Wired USB · PID 0x${this.device.productId.toString(16).toUpperCase()}`,
      motionSync: config[OFFSET.motionSync] !== 0,
      angleSnapping: config[OFFSET.angleSnapping] !== 0,
      rippleControl: config[OFFSET.rippleControl] !== 0,
      liftOffDistance: config[OFFSET.lod] === 1 ? "Medium" : "High",
      firmware: firmware ? [`Firmware ${firmware}`] : ["Firmware unavailable"],
    };
  }

  async setDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) throw new Error("OP1 8K CPI must be between 50 and 26,000 in 50 CPI steps.");
    await this.updateConfig((config) => {
      config[OFFSET.firstCpiSplit] = 0;
      this.writeUint16LE(config, OFFSET.firstCpiX, dpi);
      this.writeUint16LE(config, OFFSET.firstCpiY, dpi);
    });
    const confirmed = this.readUint16LE(await this.readConfig(), OFFSET.firstCpiX);
    if (confirmed !== dpi) throw new Error(`The mouse kept ${confirmed} CPI instead of ${dpi} CPI.`);
    return confirmed;
  }

  async setPollingRate(rate: number): Promise<number> {
    if (!POLLING_RATES.includes(rate as (typeof POLLING_RATES)[number])) throw new Error("Unsupported OP1 8K polling rate.");
    const divider = 8000 / rate;
    await this.updateConfig((config) => {
      config[OFFSET.pollingDivider] = divider;
      if (this.device.productId === 0x1966 && rate === 8000) config[OFFSET.motionSync] = 0;
    });
    const confirmed = this.decodePollingRate((await this.readConfig())[OFFSET.pollingDivider]);
    if (confirmed !== rate) throw new Error(`The mouse kept ${confirmed} Hz instead of ${rate} Hz.`);
    return confirmed;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    if (value === "Low") throw new Error("The OP1 8K supports 1 mm or 2 mm lift-off distance.");
    const encoded = value === "Medium" ? 1 : 2;
    await this.updateConfig((config) => { config[OFFSET.lod] = encoded; });
    if ((await this.readConfig())[OFFSET.lod] !== encoded) throw new Error("The mouse did not confirm the requested lift-off distance.");
  }

  async setMotionSync(enabled: boolean): Promise<void> {
    if (enabled && this.device.productId === 0x1966) {
      const config = await this.readConfig();
      if (this.decodePollingRate(config[OFFSET.pollingDivider]) === 8000) {
        throw new Error("The XM2 8K firmware does not support Motion Sync at 8,000 Hz.");
      }
    }
    await this.setBoolean(OFFSET.motionSync, enabled, "Motion Sync");
  }

  async setAngleSnapping(enabled: boolean): Promise<void> {
    await this.setBoolean(OFFSET.angleSnapping, enabled, "angle snapping");
  }

  async setRippleControl(enabled: boolean): Promise<void> {
    await this.setBoolean(OFFSET.rippleControl, enabled, "ripple control");
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  private async setBoolean(offset: number, enabled: boolean, label: string): Promise<void> {
    await this.updateConfig((config) => { config[offset] = enabled ? 1 : 0; });
    if (((await this.readConfig())[offset] !== 0) !== enabled) throw new Error(`The mouse did not confirm ${label}.`);
  }

  private async updateConfig(change: (config: Uint8Array) => void): Promise<void> {
    const config = await this.readConfig();
    change(config);
    config[0] = REPORT.write;
    config[1] = COMMAND.write;
    await this.device.sendFeatureReport(REPORT.write, config.slice(1));
  }

  private async readConfig(): Promise<Uint8Array> {
    await this.open();
    const command = new Uint8Array(COMMAND_SIZE);
    command[0] = REPORT.read;
    command[1] = COMMAND.read;
    await this.device.sendFeatureReport(REPORT.read, command.slice(1));
    const response = this.copyDataView(await this.device.receiveFeatureReport(REPORT.read));
    const config = this.normalizeFeatureReport(REPORT.read, response, CONFIG_SIZE);
    const divider = config[OFFSET.pollingDivider];
    const cpiLevels = config[OFFSET.cpiLevels];
    if (!divider || cpiLevels < 1 || cpiLevels > 4) throw new Error("The selected EGG HID interface returned an invalid configuration.");
    return config;
  }

  private async readFirmware(): Promise<string> {
    await this.open();
    const command = new Uint8Array(COMMAND_SIZE);
    command[0] = REPORT.read;
    command[1] = COMMAND.firmware;
    await this.device.sendFeatureReport(REPORT.read, command.slice(1));
    const response = this.copyDataView(await this.device.receiveFeatureReport(REPORT.read));
    const data = this.normalizeFeatureReport(REPORT.read, response, COMMAND_SIZE);
    const major = data[17];
    const minor = data[18];
    return major === undefined || minor === undefined ? "" : `${minor.toString(16)}.${major.toString(16)}`;
  }

  private normalizeFeatureReport(reportId: number, response: Uint8Array, size: number): Uint8Array {
    const result = new Uint8Array(size);
    if (response[0] === reportId) result.set(response.slice(0, size));
    else {
      result[0] = reportId;
      result.set(response.slice(0, size - 1), 1);
    }
    return result;
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private decodePollingRate(divider: number): number {
    if (!divider) throw new Error("The mouse reported an invalid polling-rate divider.");
    return Math.round(8000 / divider);
  }

  private readUint16LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  private writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = value >> 8;
  }
}
