import type { MouseStatus } from "../mouse-types.ts";
import type { PulsarDeviceInfo } from "./pulsar-hid.ts";

const VENDOR_ID = 0x3710;
const PRO_DONGLE_PRODUCT_ID = 0x5405;
const REPORT_ID = 0;
const REPORT_LENGTH = 63;

const COMMAND = {
  dongleVersion: 0xa0,
  rssi: 0xa4,
  dpi: 0xb1,
  polling: 0xb2,
  lod: 0xb3,
  battery: 0xb4,
  motionSync: 0xb5,
  ripple: 0xb6,
  angleSnap: 0xb7,
  angleTune: 0xb8,
  wheelAcceleration: 0xb9,
  lowBattery: 0xbe,
  mouseVersion: 0xbf,
  remoteLed: 0xc0,
  dpiLed: 0xc1,
  powerSaving: 0xc2,
  saveAllow: 0xc3,
  turboMode: 0xc4,
  debounce: 0xc5,
  profile: 0xc6,
} as const;

export class PulsarProHidClient {
  private commandQueue: Promise<void> = Promise.resolve();
  private waiter: {
    command: number;
    resolve: (data: Uint8Array) => void;
    reject: (error: Error) => void;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const data = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
    if (data[0] !== this.waiter?.command) return;
    const waiter = this.waiter;
    this.waiter = null;
    waiter.resolve(data);
  };

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID
      && device.productId === PRO_DONGLE_PRODUCT_ID
      && device.collections.some((collection) =>
        collection.usagePage === 1
        && collection.usage === 0
        && collection.inputReports.some((report) => report.reportId === REPORT_ID)
        && collection.outputReports.some((report) => report.reportId === REPORT_ID));
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  describeCollections(): string {
    return "Pulsar Pro 64-byte report-0 interface";
  }

  async readDeviceInfo(): Promise<PulsarDeviceInfo> {
    await this.open();
    return {
      cid: 0,
      mid: 0,
      type: 3,
      dongleType: 5,
      connection: "Wireless",
      maximumPollingRateHz: 8000,
    };
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const battery = await this.query(COMMAND.battery);
    const dpi = await this.query(COMMAND.dpi);
    const polling = await this.query(COMMAND.polling);
    const lod = await this.query(COMMAND.lod);
    const motion = await this.queryOptional(COMMAND.motionSync);
    const ripple = await this.queryOptional(COMMAND.ripple);
    const angle = await this.queryOptional(COMMAND.angleSnap);
    const angleTune = await this.queryOptional(COMMAND.angleTune);
    const wheelAcceleration = await this.queryOptional(COMMAND.wheelAcceleration);
    const lowBattery = await this.queryOptional(COMMAND.lowBattery);
    const remoteLed1 = await this.queryParametersOptional(COMMAND.remoteLed, new Uint8Array([0, 0]));
    const remoteLed2 = await this.queryParametersOptional(COMMAND.remoteLed, new Uint8Array([1, 0]));
    const dpiLed = await this.queryOptional(COMMAND.dpiLed);
    const turbo = await this.queryOptional(COMMAND.turboMode, 1500);
    const debounce = await this.queryOptional(COMMAND.debounce, 1500);
    const sleep = await this.queryOptional(COMMAND.powerSaving, 1500);
    const profile = await this.queryOptional(COMMAND.profile, 1500);
    const mouseVersion = await this.queryOptional(COMMAND.mouseVersion);
    const dongleVersion = await this.queryOptional(COMMAND.dongleVersion);
    const rssi = await this.queryOptional(COMMAND.rssi);
    const dpiIndex = Math.min(dpi[3] ?? 0, 7);
    const dpiOffset = 4 + dpiIndex * 4;
    const sleepMs = sleep ? this.readUint32LE(sleep, 2) : 0;
    return {
      brand: "Pulsar",
      name: this.device.productName || "Pulsar Pro Mouse",
      batteryPercent: battery[0] === COMMAND.battery ? Math.min(battery[1] ?? 0, 100) : null,
      batteryState: battery[6] === 1 ? "Charging" : "Discharging",
      dpi: this.readUint16LE(dpi, dpiOffset),
      pollingRateHz: this.readUint16LE(polling, 2),
      activeProfile: profile ? (profile[2] ?? 0) + 1 : null,
      connectionDetail: "PID 0x5405 · Pulsar Pro protocol · Wireless",
      signalStrength: this.signalLevel(rssi?.[1]),
      debounceMs: debounce?.[2] ?? null,
      motionSync: motion ? motion[2] === 1 : null,
      sleepTimeout: sleep ? this.sleepCode(sleepMs) : null,
      angleSnapping: angle ? angle[2] === 1 : null,
      angleTuning: angleTune ? new Int8Array([angleTune[2]])[0] : null,
      wheelAcceleration: wheelAcceleration ? wheelAcceleration[2] === 1 : null,
      lowBatteryWarning: lowBattery?.[2] ?? null,
      remoteLedMode1: remoteLed1?.[3] ?? null,
      remoteLedMode2: remoteLed2?.[3] ?? null,
      dpiLedMode: dpiLed?.[2] ?? null,
      dpiLedBrightness: dpiLed?.[3] ?? null,
      dpiLedSpeed: dpiLed?.[4] ?? null,
      rippleControl: ripple ? ripple[2] === 1 : null,
      performanceMode: turbo ? turbo[2] === 1 : null,
      liftOffDistance: lod[2] === 1 ? "Low" : lod[2] === 2 ? "Medium" : lod[2] === 3 ? "High" : null,
      firmware: [
        mouseVersion ? this.formatVersion("Mouse", mouseVersion) : "Mouse firmware unavailable",
        dongleVersion ? this.formatVersion("Dongle", dongleVersion) : "Dongle firmware unavailable",
      ],
    };
  }

  getDpiOptions(): number[] {
    const values: number[] = [];
    for (let dpi = 50; dpi <= 32000; dpi += 50) values.push(dpi);
    return values;
  }

  async setDpi(value: number): Promise<number> {
    if (!this.getDpiOptions().includes(value)) throw new Error("Unsupported Pulsar Pro DPI value.");
    const current = await this.query(COMMAND.dpi);
    const stageCount = Math.min(current[2] ?? 0, 6);
    const activeStage = Math.min(current[3] ?? 0, Math.max(stageCount - 1, 0));
    if (stageCount < 1) throw new Error("The Pulsar Pro mouse reported no DPI stages.");
    const stages = current.slice(4, 4 + stageCount * 4);
    const offset = activeStage * 4;
    stages[offset] = value & 0xff;
    stages[offset + 1] = value >> 8;
    stages[offset + 2] = value & 0xff;
    stages[offset + 3] = value >> 8;
    await this.command(COMMAND.dpi, new Uint8Array([1, stageCount, activeStage, ...stages]));
    await this.applySettings();
    const confirmed = await this.query(COMMAND.dpi);
    const confirmedOffset = 4 + activeStage * 4;
    const confirmedValue = this.readUint16LE(confirmed, confirmedOffset);
    if (confirmedValue !== value) throw new Error(`The mouse kept ${confirmedValue} DPI instead of ${value} DPI.`);
    return confirmedValue;
  }

  async setPollingRate(value: number): Promise<number> {
    await this.setValue(COMMAND.polling, new Uint8Array([value & 0xff, value >> 8]));
    const confirmed = this.readUint16LE(await this.query(COMMAND.polling), 2);
    if (confirmed !== value) throw new Error(`The mouse kept ${confirmed} Hz instead of ${value} Hz.`);
    return confirmed;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<NonNullable<MouseStatus["liftOffDistance"]>> {
    const encoded = ({ Low: 1, Medium: 2, High: 3 } as const)[value];
    await this.setValue(COMMAND.lod, new Uint8Array([encoded]));
    if ((await this.query(COMMAND.lod))[2] !== encoded) throw new Error("The mouse did not confirm the requested lift-off distance.");
    return value;
  }

  async setMotionSync(enabled: boolean): Promise<boolean> { return await this.setBoolean(COMMAND.motionSync, enabled); }
  async setAngleSnapping(enabled: boolean): Promise<boolean> { return await this.setBoolean(COMMAND.angleSnap, enabled); }
  async setRippleControl(enabled: boolean): Promise<boolean> { return await this.setBoolean(COMMAND.ripple, enabled); }
  async setPerformanceMode(enabled: boolean): Promise<boolean> { return await this.setBoolean(COMMAND.turboMode, enabled); }
  async setWheelAcceleration(enabled: boolean): Promise<boolean> { return await this.setBoolean(COMMAND.wheelAcceleration, enabled); }

  async setAngleTuning(value: number): Promise<number> {
    if (!Number.isInteger(value) || value < -30 || value > 30) throw new Error("Angle tuning must be between -30° and 30°.");
    await this.setValue(COMMAND.angleTune, new Uint8Array([value & 0xff]));
    const confirmed = new Int8Array([(await this.query(COMMAND.angleTune))[2]])[0];
    if (confirmed !== value) throw new Error(`The mouse kept ${confirmed}° instead of ${value}°.`);
    return confirmed;
  }

  async setProfile(profile: number): Promise<number> {
    if (!Number.isInteger(profile) || profile < 1 || profile > 6) throw new Error("Choose a profile from 1 to 6.");
    await this.setValue(COMMAND.profile, new Uint8Array([profile - 1]));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    const confirmed = (await this.query(COMMAND.profile))[2] + 1;
    if (confirmed !== profile) throw new Error(`The mouse stayed on profile ${confirmed}.`);
    return confirmed;
  }

  async setLowBatteryWarning(value: number): Promise<number> {
    if (!Number.isInteger(value) || value < 0 || value > 30) throw new Error("Low-battery warning must be between 0% and 30%.");
    await this.setValue(COMMAND.lowBattery, new Uint8Array([value]));
    const confirmed = (await this.query(COMMAND.lowBattery))[2];
    if (confirmed !== value) throw new Error(`The receiver kept its warning at ${confirmed}%.`);
    return confirmed;
  }

  async setRemoteLedMode(channel: 0 | 1, mode: number): Promise<number> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 4) throw new Error("Unsupported remote LED mode.");
    await this.command(COMMAND.remoteLed, new Uint8Array([channel, 1, mode]));
    await this.applySettings();
    const confirmed = (await this.command(COMMAND.remoteLed, new Uint8Array([channel, 0])))[3];
    if (confirmed !== mode) throw new Error(`Remote LED ${channel + 1} kept mode ${confirmed}.`);
    return confirmed;
  }

  async setDpiLed(mode: number, brightness: number, speed: number): Promise<void> {
    if (![mode, brightness, speed].every(Number.isInteger) || mode < 0 || mode > 4 || brightness < 0 || brightness > 255 || speed < 0 || speed > 20) {
      throw new Error("Invalid DPI LED setting.");
    }
    await this.command(COMMAND.dpiLed, new Uint8Array([1, mode, brightness, speed]));
    await this.applySettings();
    const confirmed = await this.query(COMMAND.dpiLed);
    if (confirmed[2] !== mode || confirmed[3] !== brightness || confirmed[4] !== speed) {
      throw new Error("The receiver did not confirm the DPI LED settings.");
    }
  }

  async setDebounceTime(value: number): Promise<number> {
    await this.setValue(COMMAND.debounce, new Uint8Array([value]));
    return (await this.query(COMMAND.debounce))[2];
  }

  async setSleepTimeout(code: number): Promise<number> {
    const milliseconds = ({ 1: 10000, 3: 30000, 6: 60000, 12: 120000, 30: 300000, 60: 600000, 180: 1800000 } as Record<number, number>)[code];
    if (!milliseconds) throw new Error("Unsupported Pulsar Pro sleep timeout.");
    await this.setValue(COMMAND.powerSaving, this.uint32LE(milliseconds));
    return this.sleepCode(this.readUint32LE(await this.query(COMMAND.powerSaving), 2)) ?? code;
  }

  async setDongleLed(): Promise<boolean> {
    throw new Error("This Pro receiver uses separate remote LED modes.");
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.waiter?.reject(new Error("The Pulsar Pro receiver was closed."));
    this.waiter = null;
    if (this.device.opened) await this.device.close();
  }

  private async setBoolean(command: number, enabled: boolean): Promise<boolean> {
    await this.setValue(command, new Uint8Array([enabled ? 1 : 0]));
    return (await this.query(command))[2] === 1;
  }

  private async setValue(command: number, value: Uint8Array): Promise<void> {
    await this.command(command, new Uint8Array([1, ...value]));
    await this.applySettings();
  }

  private async query(command: number): Promise<Uint8Array> {
    return await this.command(command, new Uint8Array([0]));
  }

  private async queryOptional(command: number, timeoutMs = 500): Promise<Uint8Array | null> {
    return await this.command(command, new Uint8Array([0]), timeoutMs).catch(() => null);
  }

  private async queryParametersOptional(command: number, parameters: Uint8Array, timeoutMs = 500): Promise<Uint8Array | null> {
    return await this.command(command, parameters, timeoutMs).catch(() => null);
  }

  private async applySettings(): Promise<void> {
    await this.command(COMMAND.saveAllow, new Uint8Array([1]));
  }

  private async command(command: number, parameters: Uint8Array, timeoutMs = 1500): Promise<Uint8Array> {
    const previous = this.commandQueue;
    let releaseQueue = (): void => undefined;
    this.commandQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await this.exchange(command, parameters, timeoutMs);
        if (response[0] !== 0xa7) return response;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
      throw new Error(`The Pulsar Pro receiver stayed busy on command 0x${command.toString(16)}.`);
    } finally {
      releaseQueue();
    }
  }

  private async exchange(command: number, parameters: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    if (this.waiter) throw new Error("Another Pulsar Pro request is already in progress.");
    const packet = new Uint8Array(REPORT_LENGTH);
    packet[0] = command;
    packet.set(parameters.slice(0, REPORT_LENGTH - 1), 1);
    const response = new Promise<Uint8Array>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.waiter = null;
        reject(new Error(`The Pulsar Pro receiver did not answer command 0x${command.toString(16)}.`));
      }, timeoutMs);
      this.waiter = {
        command,
        resolve: (data) => {
          window.clearTimeout(timeout);
          resolve(data);
        },
        reject,
      };
    });
    try {
      await this.device.sendReport(REPORT_ID, packet);
    } catch (error) {
      this.waiter = null;
      throw error;
    }
    return await response;
  }

  private readUint16LE(data: Uint8Array, offset: number): number {
    return (data[offset] ?? 0) | (data[offset + 1] ?? 0) << 8;
  }

  private readUint32LE(data: Uint8Array, offset: number): number {
    return ((data[offset] ?? 0) | (data[offset + 1] ?? 0) << 8 | (data[offset + 2] ?? 0) << 16 | (data[offset + 3] ?? 0) << 24) >>> 0;
  }

  private uint32LE(value: number): Uint8Array {
    return new Uint8Array([value, value >>> 8, value >>> 16, value >>> 24]);
  }

  private sleepCode(milliseconds: number): number | null {
    return ({ 10000: 1, 30000: 3, 60000: 6, 120000: 12, 300000: 30, 600000: 60, 1800000: 180 } as Record<number, number>)[milliseconds] ?? null;
  }

  private signalLevel(raw: number | undefined): number | null {
    if (raw === undefined) return null;
    const signed = raw > 127 ? raw - 256 : raw;
    if (signed >= -45) return 4;
    if (signed >= -60) return 3;
    if (signed >= -75) return 2;
    if (signed >= -90) return 1;
    return 0;
  }

  private formatVersion(label: string, response: Uint8Array): string {
    return `${label} v${response[1] ?? 0}.${response[2] ?? 0}.${response[3] ?? 0}`;
  }
}
