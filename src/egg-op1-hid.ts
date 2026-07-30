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
  filterFlags: 22,
  lod: 25,
  angleSnapping: 26,
  rippleControl: 27,
  motionSync: 28,
  cpiLevels: 30,
  firstCpiSplit: 51,
  firstCpiX: 52,
  firstCpiY: 54,
  firstButton: 77,
} as const;

const POLLING_RATES = [1000, 2000, 4000, 8000] as const;
const FILTER = {
  slamclick: 0x01,
  motionJitter: 0x10,
} as const;
const BUTTON_CONFIG_SIZE = 7;
const SPDT = {
  "Off": 0x08,
  "GX Safe": 0xf0,
  "GX Speed": 0xf1,
} as const;
export type EggSpdtMode = keyof typeof SPDT;
export const EGG_BUTTON_NAMES = ["Left", "Right", "Middle", "Forward", "Back"] as const;
export type EggButtonIndex = 0 | 1 | 2 | 3 | 4;
export const EGG_BUTTON_MAPPINGS = [
  "Left Click", "Right Click", "Middle Click", "Back", "Forward",
  "Scroll Up", "Scroll Down", "CPI Cycle", "Disabled",
] as const;
export type EggButtonMapping = (typeof EGG_BUTTON_MAPPINGS)[number];

export class EggOp1HidClient {
  private receivedReportDelta: number | null = null;

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
    const cpiLevels = Math.min(Math.max(config[OFFSET.cpiLevels], 1), 4);
    if (!this.getDpiOptions().includes(dpi)) throw new Error(`The mouse reported an unsupported ${dpi} CPI value.`);
    return {
      brand: "Endgame Gear",
      name: SUPPORTED_PRODUCTS.get(this.device.productId) ?? this.device.productName ?? "Endgame Gear OP1 8K",
      batteryPercent: null,
      batteryState: "Unknown",
      dpi,
      pollingRateHz: this.decodePollingRate(config[OFFSET.pollingDivider]),
      activeProfile: null,
      connectionType: "Wired",
      connectionDetail: `Wired USB · PID 0x${this.device.productId.toString(16).toUpperCase()}`,
      motionSync: config[OFFSET.motionSync] !== 0,
      angleSnapping: config[OFFSET.angleSnapping] !== 0,
      rippleControl: config[OFFSET.rippleControl] !== 0,
      slamclickFilter: (config[OFFSET.filterFlags] & FILTER.slamclick) !== 0,
      motionJitterFilter: (config[OFFSET.filterFlags] & FILTER.motionJitter) !== 0,
      leftSpdtMode: this.decodeSpdtMode(config[OFFSET.firstButton]),
      rightSpdtMode: this.decodeSpdtMode(config[OFFSET.firstButton + BUTTON_CONFIG_SIZE]),
      eggCpiLevels: cpiLevels,
      eggCpiStages: Array.from({ length: 4 }, (_, level) => {
        const offset = OFFSET.firstCpiSplit + level * 5;
        return { x: this.readUint16LE(config, offset + 1), y: this.readUint16LE(config, offset + 3) };
      }),
      eggPollingDivider: config[OFFSET.pollingDivider],
      eggMulticlickFilters: EGG_BUTTON_NAMES.map((_, index) => {
        const value = config[OFFSET.firstButton + index * BUTTON_CONFIG_SIZE];
        return value >= 0xf0 ? 8 : value;
      }),
      eggButtonMappings: EGG_BUTTON_NAMES.map((_, index) =>
        this.decodeButtonMapping(config, index as EggButtonIndex)),
      liftOffDistance: config[OFFSET.lod] === 1 ? "Medium" : "High",
      firmware: firmware ? [`Firmware ${firmware}`] : ["Firmware unavailable"],
    };
  }

  async setDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) throw new Error("OP1 8K CPI must be between 50 and 26,000 in 50 CPI steps.");
    await this.updateConfig((config) => {
      const activeLevels = Math.min(Math.max(config[OFFSET.cpiLevels], 1), 4);
      for (let level = 0; level < activeLevels; level += 1) {
        const levelOffset = OFFSET.firstCpiSplit + level * 5;
        config[levelOffset] = 0;
        this.writeUint16LE(config, levelOffset + 1, dpi);
        this.writeUint16LE(config, levelOffset + 3, dpi);
      }
    });
    const confirmedConfig = await this.readConfig();
    const activeLevels = Math.min(Math.max(confirmedConfig[OFFSET.cpiLevels], 1), 4);
    const confirmedValues = Array.from({ length: activeLevels }, (_, level) =>
      this.readUint16LE(confirmedConfig, OFFSET.firstCpiX + level * 5));
    if (confirmedValues.some((value) => value !== dpi)) {
      throw new Error(`The mouse kept CPI stages at ${confirmedValues.join(", ")} instead of ${dpi} CPI.`);
    }
    return dpi;
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

  async setSlamclickFilter(enabled: boolean): Promise<void> {
    await this.setFilterFlag(FILTER.slamclick, enabled, "slamclick filter");
  }

  async setMotionJitterFilter(enabled: boolean): Promise<void> {
    await this.setFilterFlag(FILTER.motionJitter, enabled, "motion-jitter filter");
  }

  async setSpdtMode(button: "left" | "right", mode: EggSpdtMode): Promise<void> {
    const offset = OFFSET.firstButton + (button === "right" ? BUTTON_CONFIG_SIZE : 0);
    await this.updateConfig((config) => { config[offset] = SPDT[mode]; });
    const confirmed = this.decodeSpdtMode((await this.readConfig())[offset]);
    if (confirmed !== mode) throw new Error(`The mouse kept the ${button} button in ${confirmed} mode instead of ${mode}.`);
  }

  async setCpiLevels(levels: number): Promise<void> {
    if (!Number.isInteger(levels) || levels < 1 || levels > 4) throw new Error("The OP1/XM2 supports one to four CPI stages.");
    await this.updateConfig((config) => { config[OFFSET.cpiLevels] = levels; });
    if ((await this.readConfig())[OFFSET.cpiLevels] !== levels) throw new Error("The mouse did not confirm the CPI stage count.");
  }

  async setCpiStage(level: number, x: number, y: number): Promise<void> {
    if (!Number.isInteger(level) || level < 0 || level > 3) throw new Error("Invalid CPI stage.");
    if (![x, y].every((value) => this.getDpiOptions().includes(value))) {
      throw new Error("CPI must be between 50 and 26,000 in 50 CPI steps.");
    }
    const offset = OFFSET.firstCpiSplit + level * 5;
    await this.updateConfig((config) => {
      config[offset] = x === y ? 0 : 1;
      this.writeUint16LE(config, offset + 1, x);
      this.writeUint16LE(config, offset + 3, y);
    });
    const confirmed = await this.readConfig();
    if (this.readUint16LE(confirmed, offset + 1) !== x || this.readUint16LE(confirmed, offset + 3) !== y) {
      throw new Error(`The mouse did not confirm CPI stage ${level + 1}.`);
    }
  }

  async setCustomPollingDivider(divider: number): Promise<void> {
    if (!Number.isInteger(divider) || divider < 1 || divider > 255) throw new Error("Polling divider must be an integer from 1 to 255.");
    await this.updateConfig((config) => { config[OFFSET.pollingDivider] = divider; });
    if ((await this.readConfig())[OFFSET.pollingDivider] !== divider) throw new Error("The mouse did not confirm the custom polling divider.");
  }

  async setMulticlickFilter(button: EggButtonIndex, value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 0 || value > 25) throw new Error("Multiclick filtering must be from 0 to 25.");
    const offset = OFFSET.firstButton + button * BUTTON_CONFIG_SIZE;
    const config = await this.readConfig();
    if (button < 2 && config[offset] >= 0xf0) throw new Error(`Turn GX mode off for the ${EGG_BUTTON_NAMES[button]} button first.`);
    config[offset] = value;
    await this.writeConfig(config);
    if ((await this.readConfig())[offset] !== value) throw new Error(`The mouse did not confirm the ${EGG_BUTTON_NAMES[button]} multiclick value.`);
  }

  async setButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): Promise<void> {
    const offset = OFFSET.firstButton + button * BUTTON_CONFIG_SIZE + 1;
    const encoded = this.encodeButtonMapping(mapping);
    await this.updateConfig((config) => {
      config.fill(0, offset, offset + 6);
      config[offset] = encoded.type;
      config[offset + 1] = encoded.value;
    });
    const confirmed = this.decodeButtonMapping(await this.readConfig(), button);
    if (confirmed !== mapping) throw new Error(`The mouse kept the ${EGG_BUTTON_NAMES[button]} mapping as ${confirmed}.`);
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  private async setBoolean(offset: number, enabled: boolean, label: string): Promise<void> {
    await this.updateConfig((config) => { config[offset] = enabled ? 1 : 0; });
    if (((await this.readConfig())[offset] !== 0) !== enabled) throw new Error(`The mouse did not confirm ${label}.`);
  }

  private async setFilterFlag(flag: number, enabled: boolean, label: string): Promise<void> {
    await this.updateConfig((config) => {
      config[OFFSET.filterFlags] = enabled
        ? config[OFFSET.filterFlags] | flag
        : config[OFFSET.filterFlags] & ~flag;
    });
    const confirmed = ((await this.readConfig())[OFFSET.filterFlags] & flag) !== 0;
    if (confirmed !== enabled) throw new Error(`The mouse did not confirm the ${label}.`);
  }

  private decodeSpdtMode(value: number): EggSpdtMode {
    if (value === SPDT["GX Safe"]) return "GX Safe";
    if (value === SPDT["GX Speed"]) return "GX Speed";
    return "Off";
  }

  private decodeButtonMapping(config: Uint8Array, button: EggButtonIndex): string {
    const offset = OFFSET.firstButton + button * BUTTON_CONFIG_SIZE + 1;
    const type = config[offset];
    const value = config[offset + 1];
    if (type === 0) {
      return ({ 1: "Left Click", 2: "Right Click", 4: "Middle Click", 8: "Back", 16: "Forward" } as Record<number, EggButtonMapping>)[value]
        ?? `Unsupported mouse action 0x${value.toString(16)}`;
    }
    if (type === 1) return value === 0xff ? "Scroll Down" : value === 1 ? "Scroll Up" : `Unsupported scroll action ${value}`;
    if (type === 9) return "CPI Cycle";
    if (type === 0xff) return "Disabled";
    return `Unsupported mapping type 0x${type.toString(16)}`;
  }

  private encodeButtonMapping(mapping: EggButtonMapping): { type: number; value: number } {
    const mouse = {
      "Left Click": 1, "Right Click": 2, "Middle Click": 4, "Back": 8, "Forward": 16,
    } as const;
    if (mapping in mouse) return { type: 0, value: mouse[mapping as keyof typeof mouse] };
    if (mapping === "Scroll Up") return { type: 1, value: 1 };
    if (mapping === "Scroll Down") return { type: 1, value: 0xff };
    if (mapping === "CPI Cycle") return { type: 9, value: 0 };
    return { type: 0xff, value: 0 };
  }

  private async updateConfig(change: (config: Uint8Array) => void): Promise<void> {
    const config = await this.readConfig();
    change(config);
    await this.writeConfig(config);
  }

  private async writeConfig(config: Uint8Array): Promise<void> {
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
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (attempt > 0) await this.delay(25);
      const response = this.copyDataView(await this.device.receiveFeatureReport(REPORT.read));
      try {
        return this.decodeConfigResponse(response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("The EGG configuration response was invalid.");
      }
    }
    throw lastError ?? new Error("The EGG mouse did not return its configuration.");
  }

  private async readFirmware(): Promise<string> {
    await this.open();
    const command = new Uint8Array(COMMAND_SIZE);
    command[0] = REPORT.read;
    command[1] = COMMAND.firmware;
    await this.device.sendFeatureReport(REPORT.read, command.slice(1));
    const response = this.copyDataView(await this.device.receiveFeatureReport(REPORT.read));
    const data = this.alignFeatureResponse(response, COMMAND_SIZE, this.receivedReportDelta ?? 0);
    const major = data[17];
    const minor = data[18];
    return major === undefined || minor === undefined ? "" : `${minor.toString(16)}.${major.toString(16)}`;
  }

  private decodeConfigResponse(response: Uint8Array): Uint8Array {
    const candidates = Array.from({ length: 65 }, (_, index) => index - 32).map((delta) => ({
      bytes: this.alignFeatureResponse(response, CONFIG_SIZE, delta),
      delta,
    }));
    const ranked = candidates
      .map((candidate) => ({ ...candidate, score: this.configScore(candidate.bytes) }))
      .sort((left, right) => right.score - left.score);
    const selected = ranked[0];
    if (selected.score < 7) {
      const details = ranked.slice(0, 3).map(({ bytes, delta, score }) =>
        `delta ${delta}: score ${score}, divider ${bytes[OFFSET.pollingDivider]}, levels ${bytes[OFFSET.cpiLevels]}, LOD ${bytes[OFFSET.lod]}, CPI ${this.readUint16LE(bytes, OFFSET.firstCpiX)}`,
      ).join("; ");
      const nonzero = [...response.entries()]
        .filter(([, value]) => value !== 0)
        .slice(0, 16)
        .map(([index, value]) => `${index}=0x${value.toString(16).padStart(2, "0")}`)
        .join(", ");
      throw new Error(`The EGG configuration response could not be decoded (${response.byteLength} bytes; ${details}; first nonzero bytes: ${nonzero || "none"}).`);
    }
    this.receivedReportDelta = selected.delta;
    return selected.bytes;
  }

  private configScore(config: Uint8Array): number {
    let score = 0;
    const divider = config[OFFSET.pollingDivider];
    const levels = config[OFFSET.cpiLevels];
    const lod = config[OFFSET.lod];
    const dpi = this.readUint16LE(config, OFFSET.firstCpiX);
    if (divider >= 1 && divider <= 80) score += 2;
    if (levels >= 1 && levels <= 4) score += 2;
    if (lod === 1 || lod === 2) score += 2;
    if (dpi >= 50 && dpi <= 26000 && dpi % 50 === 0) score += 2;
    if (config[OFFSET.angleSnapping] <= 1) score += 1;
    if (config[OFFSET.rippleControl] <= 1) score += 1;
    if (config[OFFSET.motionSync] <= 1) score += 1;
    return score;
  }

  private alignFeatureResponse(response: Uint8Array, size: number, delta: number): Uint8Array {
    const result = new Uint8Array(size);
    for (let configIndex = 0; configIndex < size; configIndex += 1) {
      const responseIndex = configIndex + delta;
      if (responseIndex >= 0 && responseIndex < response.byteLength) result[configIndex] = response[responseIndex];
    }
    return result;
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  private decodePollingRate(divider: number): number {
    if (!divider) throw new Error("The mouse reported an invalid polling-rate divider.");
    return 8000 / divider;
  }

  private readUint16LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  private writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = value >> 8;
  }
}
