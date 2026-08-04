import type { MouseStatus } from "../mouse-types";
import { VENDOR_ID } from "../vendors";

const CONFIG_REPORT_ID = 0x08;
const CONFIG_PACKET_LENGTH = 16;
const PRODUCT_IDS = new Set([0xf520, 0xf523, 0xf5bb, 0xf522]);
const TERRA_PRO_CID = 14;
const DPI_MAX = 42000;
const POLLING_RATES = [125, 250, 500, 1000, 2000, 4000, 8000] as const;
const SLEEP_OPTIONS = [1, 3, 6, 12, 30, 60, 180] as const;

const COMMAND = {
  encryptionData: 0x01,
  deviceOnline: 0x03,
  batteryLevel: 0x04,
  writeFlashData: 0x07,
  readFlashData: 0x08,
  getCurrentConfig: 0x0e,
  readVersionId: 0x12,
  getDongleVersion: 0x1d,
  getRssi: 0x2b,
} as const;

const FLASH = {
  reportRate: 0,
  currentDpi: 4,
  liftOffDistance: 10,
  dpiValues: 12,
  debounceTime: 169,
  motionSync: 171,
  sleepTime: 173,
  angleSnapping: 175,
  rippleControl: 177,
  performanceState: 181,
  performanceTime: 183,
} as const;

const TYPE_MAX_POLL: Record<number, number> = {
  0: 1000,
  1: 4000,
  2: 1000,
  3: 8000,
  4: 2000,
  5: 8000,
};

export interface TeevolutionDeviceInfo {
  cid: number;
  mid: number;
  type: number;
  dongleType: number;
  connection: "Wired" | "Wireless";
  maximumPollingRateHz: number;
}

export class TeevolutionHidClient {
  private deviceInfo: TeevolutionDeviceInfo | null = null;
  private responseWaiter: {
    command: number;
    resolve: (bytes: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    if (event.reportId === CONFIG_REPORT_ID && bytes[0] === this.responseWaiter?.command) {
      const waiter = this.responseWaiter;
      this.responseWaiter = null;
      waiter.resolve(bytes);
    }
  };

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID.teevolution
      && PRODUCT_IDS.has(device.productId)
      && device.collections.some((collection) =>
        collection.inputReports.length === 1
        && collection.outputReports.length === 1
        && collection.inputReports[0]?.reportId === CONFIG_REPORT_ID
        && collection.outputReports[0]?.reportId === CONFIG_REPORT_ID);
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  describeCollections(): string {
    return this.device.collections.map((collection) => {
      const inputIds = collection.inputReports.map((report) => report.reportId);
      const outputIds = collection.outputReports.map((report) => report.reportId);
      const featureIds = collection.featureReports.map((report) => report.reportId);
      return [
        `usage 0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)}`,
        `in [${inputIds.join(", ") || "none"}]`,
        `out [${outputIds.join(", ") || "none"}]`,
        `feature [${featureIds.join(", ") || "none"}]`,
      ].join(" · ");
    }).join(" | ") || "No HID collections reported";
  }

  async readDeviceInfo(): Promise<TeevolutionDeviceInfo> {
    await this.open();
    const challenge = new Uint8Array(8);
    crypto.getRandomValues(challenge);
    challenge.fill(0, 4);
    const response = await this.query(COMMAND.encryptionData, challenge);
    this.assertAccepted(response, "identification");
    const type = response[11] ?? 0xff;
    this.deviceInfo = {
      cid: response[9] ?? 0,
      mid: response[10] ?? 0,
      type,
      dongleType: response[12] ?? 0,
      connection: type === 2 || type === 3 ? "Wired" : "Wireless",
      maximumPollingRateHz: TYPE_MAX_POLL[type] ?? 1000,
    };
    return this.deviceInfo;
  }

  async readStatus(): Promise<MouseStatus> {
    const info = this.deviceInfo ?? await this.readDeviceInfo();
    return await this.withDeviceControl(async () => {
      const flash = await this.readFlash(FLASH.reportRate, FLASH.performanceTime + 2);
      const battery = await this.query(COMMAND.batteryLevel);
      const deviceVersion = await this.query(COMMAND.readVersionId);
      const dongleVersion = await this.query(COMMAND.getDongleVersion).catch(() => null);
      const profile = await this.query(COMMAND.getCurrentConfig).catch(() => null);
      const rssi = await this.query(COMMAND.getRssi).catch(() => null);
      const currentDpi = Math.min(flash[FLASH.currentDpi] ?? 0, 7);
      const dpi = this.decodeDpi(flash.slice(FLASH.dpiValues + currentDpi * 4, FLASH.dpiValues + currentDpi * 4 + 4));
      const lodValue = flash[FLASH.liftOffDistance];
      const pollingRateHz = this.decodePollingRate(flash[FLASH.reportRate] ?? 1);
      return {
        brand: "Teevolution",
        name: this.displayName(info),
        ui: {
          defaultDisplayName: "Terra Pro",
          hideUnsupportedPollingRates: true,
        },
        batteryPercent: (battery[5] ?? 0xff) <= 100 ? battery[5]! : null,
        batteryState: battery[6] === 1 ? "Charging" : "Discharging",
        dpi,
        pollingRateHz,
        supportedPollingRates: POLLING_RATES.filter((rate) => rate <= info.maximumPollingRateHz),
        activeProfile: profile && profile[1] === 0 ? (profile[5] ?? 0) + 1 : null,
        connectionType: info.connection,
        connectionDetail: `CID ${info.cid} · MID ${info.mid} · Type ${info.type}`,
        signalStrength: rssi && rssi[1] === 0 ? Math.min(rssi[5] ?? 0, 4) : null,
        debounceMs: flash[FLASH.debounceTime] ?? null,
        motionSync: flash[FLASH.motionSync] === 1,
        sleepTimeout: flash[FLASH.sleepTime] ?? null,
        angleSnapping: flash[FLASH.angleSnapping] === 1,
        rippleControl: flash[FLASH.rippleControl] === 1,
        performanceMode: flash[FLASH.performanceState] === 1,
        liftOffDistance: lodValue === 3 ? "Low" : lodValue === 1 ? "Medium" : lodValue === 2 ? "High" : null,
        firmware: [
          this.decodeVersionOptional("Mouse", deviceVersion) ?? "Mouse firmware unavailable",
          this.decodeVersionOptional("Dongle", dongleVersion) ?? "Dongle firmware unavailable",
        ],
      };
    });
  }

  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = 50; dpi <= 30000; dpi += 50) options.push(dpi);
    for (let dpi = 30100; dpi <= DPI_MAX; dpi += 100) options.push(dpi);
    return options;
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    const encoded = pollingRateHz <= 1000 ? 1000 / pollingRateHz : pollingRateHz / 2000 * 16;
    if (!Number.isInteger(encoded) || !(POLLING_RATES as readonly number[]).includes(pollingRateHz)) {
      throw new Error("Unsupported Teevolution polling rate.");
    }
    const info = this.deviceInfo ?? await this.readDeviceInfo();
    if (pollingRateHz > info.maximumPollingRateHz) {
      throw new Error(`This connection supports at most ${info.maximumPollingRateHz} Hz.`);
    }
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(FLASH.reportRate, encoded);
      const confirmed = this.decodePollingRate((await this.readFlash(FLASH.reportRate, 2))[0] ?? 1);
      if (confirmed !== pollingRateHz) throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
      return confirmed;
    });
  }

  async setDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) throw new Error(`${dpi} DPI is not supported by the Terra Pro.`);
    return await this.withDeviceControl(async () => {
      const currentDpi = (await this.readFlash(FLASH.currentDpi, 2))[0] ?? 0;
      const address = FLASH.dpiValues + Math.min(currentDpi, 7) * 4;
      await this.writeFlash(address, this.encodeDpi(dpi));
      const confirmed = this.decodeDpi(await this.readFlash(address, 4));
      if (confirmed !== dpi) throw new Error(`The mouse kept ${confirmed} DPI instead of ${dpi} DPI.`);
      return confirmed;
    });
  }

  async setLiftOffDistance(liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]>): Promise<NonNullable<MouseStatus["liftOffDistance"]>> {
    const encoded = ({ Low: 3, Medium: 1, High: 2 } as const)[liftOffDistance];
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(FLASH.liftOffDistance, encoded);
      const confirmedValue = (await this.readFlash(FLASH.liftOffDistance, 2))[0];
      const confirmed = confirmedValue === 3 ? "Low" : confirmedValue === 1 ? "Medium" : confirmedValue === 2 ? "High" : null;
      if (confirmed !== liftOffDistance) throw new Error(`The mouse kept ${confirmed ?? "an unknown LOD"} instead of ${liftOffDistance}.`);
      return confirmed;
    });
  }

  async setMotionSync(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(FLASH.motionSync, enabled, "Motion Sync");
  }

  async setAngleSnapping(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(FLASH.angleSnapping, enabled, "angle snapping");
  }

  async setRippleControl(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(FLASH.rippleControl, enabled, "ripple control");
  }

  async setPerformanceMode(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(FLASH.performanceState, enabled, "performance mode");
  }

  async setDebounceTime(debounceMs: number): Promise<number> {
    if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 20) {
      throw new Error("This Teevolution model supports a debounce time from 0 to 20 ms.");
    }
    return await this.setVerifiedByte(FLASH.debounceTime, debounceMs, "debounce time");
  }

  async setSleepTimeout(timeout: number): Promise<number> {
    if (!(SLEEP_OPTIONS as readonly number[]).includes(timeout)) {
      throw new Error("Unsupported Teevolution sleep timeout.");
    }
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(FLASH.sleepTime, timeout);
      await this.writeCheckedByte(FLASH.performanceTime, timeout);
      const sleepConfirmed = (await this.readFlash(FLASH.sleepTime, 2))[0];
      const performanceConfirmed = (await this.readFlash(FLASH.performanceTime, 2))[0];
      if (sleepConfirmed !== timeout || performanceConfirmed !== timeout) {
        throw new Error("The mouse did not confirm the requested sleep timeout.");
      }
      return sleepConfirmed!;
    });
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.responseWaiter?.reject(new Error("The Teevolution device was closed."));
    this.responseWaiter = null;
    if (this.device.opened) await this.device.close();
  }

  private displayName(info: TeevolutionDeviceInfo): string {
    if (info.cid === TERRA_PRO_CID) return this.device.productName || "Terra Pro";
    return this.device.productName || "Teevolution Mouse";
  }

  private async withDeviceControl<T>(operation: () => Promise<T>): Promise<T> {
    await this.setDeviceOnline(true);
    try {
      return await operation();
    } finally {
      await this.setDeviceOnline(false).catch(() => undefined);
    }
  }

  private async setDeviceOnline(enabled: boolean): Promise<void> {
    let response: Uint8Array | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const packet = this.createPacket(COMMAND.deviceOnline);
      packet[5] = enabled ? 1 : 0;
      packet[15] = this.packetChecksum(packet);
      response = await this.exchange(packet);
      this.assertAccepted(response, enabled ? "host-control entry" : "host-control exit");
      if (response[9] !== 1) break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    }
    if (!response || response[9] === 1) throw new Error("The Teevolution receiver stayed busy.");
    if (enabled && response[5] !== 1) throw new Error("The Teevolution mouse is offline. Move it or click a button, then retry.");
  }

  private async readFlash(address: number, length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += 10) {
      const count = Math.min(10, length - offset);
      const packet = this.createPacket(COMMAND.readFlashData);
      const currentAddress = address + offset;
      packet[2] = currentAddress >> 8;
      packet[3] = currentAddress & 0xff;
      packet[4] = count;
      packet[15] = this.packetChecksum(packet);
      const response = await this.exchange(packet);
      this.assertAccepted(response, "configuration read");
      result.set(response.slice(5, 5 + count), offset);
    }
    return result;
  }

  private async writeCheckedByte(address: number, value: number): Promise<void> {
    await this.writeFlash(address, new Uint8Array([value, (0x55 - value) & 0xff]));
  }

  private async setVerifiedByte(address: number, value: number, label: string): Promise<number> {
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(address, value);
      const confirmed = (await this.readFlash(address, 2))[0];
      if (confirmed !== value) throw new Error(`The mouse did not confirm the requested ${label}.`);
      return confirmed!;
    });
  }

  private async setVerifiedBoolean(address: number, enabled: boolean, label: string): Promise<boolean> {
    return (await this.setVerifiedByte(address, enabled ? 1 : 0, label)) === 1;
  }

  private async writeFlash(address: number, data: Uint8Array): Promise<void> {
    for (let offset = 0; offset < data.length; offset += 10) {
      const chunk = data.slice(offset, offset + 10);
      const packet = this.createPacket(COMMAND.writeFlashData);
      const currentAddress = address + offset;
      packet[2] = currentAddress >> 8;
      packet[3] = currentAddress & 0xff;
      packet[4] = chunk.length;
      packet.set(chunk, 5);
      packet[15] = this.packetChecksum(packet);
      this.assertAccepted(await this.exchange(packet), "configuration write");
    }
  }

  private async query(command: number, parameters = new Uint8Array()): Promise<Uint8Array> {
    if (parameters.length > 10) throw new Error("Teevolution queries support at most 10 parameter bytes.");
    const packet = this.createPacket(command);
    packet[4] = parameters.length;
    packet.set(parameters, 5);
    packet[15] = this.packetChecksum(packet);
    return await this.exchange(packet);
  }

  private async exchange(packet: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    if (this.responseWaiter) throw new Error("Another Teevolution request is already in progress.");
    const command = packet[0]!;
    let timeout = 0;
    let rejectResponse: ((reason: Error) => void) | null = null;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      rejectResponse = reject;
      timeout = window.setTimeout(() => {
        this.responseWaiter = null;
        reject(new Error(`The Teevolution mouse did not answer command 0x${command.toString(16).padStart(2, "0")}.`));
      }, 1200);
      this.responseWaiter = {
        command,
        resolve: (bytes) => {
          window.clearTimeout(timeout);
          resolve(bytes);
        },
        reject: (reason) => {
          window.clearTimeout(timeout);
          reject(reason);
        },
      };
    });
    void response.catch(() => undefined);
    try {
      await this.device.sendReport(CONFIG_REPORT_ID, packet);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      (rejectResponse as ((reason: Error) => void) | null)?.(new Error(`Chrome could not write Teevolution report 8. ${detail}`));
      this.responseWaiter = null;
    }
    return await response;
  }

  private createPacket(command: number): Uint8Array<ArrayBuffer> {
    const packet = new Uint8Array(CONFIG_PACKET_LENGTH);
    packet[0] = command;
    return packet;
  }

  private packetChecksum(packet: Uint8Array): number {
    let sum = 0;
    for (let index = 0; index < packet.length - 1; index += 1) sum += packet[index]!;
    return (0x55 - (sum & 0xff) - CONFIG_REPORT_ID) & 0xff;
  }

  private dataChecksum(data: Uint8Array): number {
    let sum = 0;
    for (const value of data) sum += value;
    return (0x55 - (sum & 0xff)) & 0xff;
  }

  private decodePollingRate(encoded: number): number {
    return encoded >= 16 ? encoded / 16 * 2000 : 1000 / encoded;
  }

  /** PAW3950 Compx packing used by Teevolink (step 50, high range via dpiEx 0x11). */
  private decodeDpi(data: Uint8Array): number {
    const flags = data[2] ?? 0;
    const raw = (data[0] ?? 0) + (((flags & 0x0c) >> 2) << 8);
    const dpiEx = flags & 0x03;
    let dpi = (raw + 1) * 50;
    if ((dpiEx & 0x01) !== 0) dpi *= 2;
    if ((dpiEx & 0x02) !== 0) dpi *= 2;
    return dpi;
  }

  private encodeDpi(dpi: number): Uint8Array {
    let dpiEx = 0;
    let scaled = dpi;
    if (dpi >= 30100) {
      dpiEx = 0x11;
      scaled = dpi / 2;
    }
    const raw = scaled / 50 - 1;
    if (!Number.isInteger(raw) || raw < 0) throw new Error(`${dpi} DPI cannot be encoded for the Terra Pro.`);
    const high = raw >> 8;
    const result = new Uint8Array(4);
    result[0] = raw & 0xff;
    result[1] = raw & 0xff;
    result[2] = (high << 2) | (high << 6) | dpiEx | (dpiEx << 4);
    result[3] = this.dataChecksum(result.slice(0, 3));
    return result;
  }

  private decodeVersion(label: string, response: Uint8Array): string {
    this.assertAccepted(response, `${label.toLowerCase()} firmware read`);
    return `${label} v${response[5] ?? 0}.${(response[6] ?? 0).toString(16).padStart(2, "0")}`;
  }

  private decodeVersionOptional(label: string, response: Uint8Array | null): string | null {
    if (!response || response[1] !== 0) return null;
    return this.decodeVersion(label, response);
  }

  private assertAccepted(response: Uint8Array, operation: string): void {
    if (response[1] !== 0) throw new Error(`The Teevolution receiver rejected the ${operation} (status ${response[1]}).`);
  }
}
