import type { MouseStatus } from "../mouse-types.ts";
import { openRazerDevice } from "./hid-open.ts";
import {
  RAZER_V4_POLLING_CODES as POLLING_CODES,
  RAZER_V4_PRODUCTS as VIPER_V4_PRO_PRODUCTS,
  RAZER_V4_REPORT_ID as REPORT_ID,
  RAZER_V4_REPORT_LENGTH as REPORT_LENGTH,
  buildRazerV4Report,
  decodeRazerV4DpiState,
  decodeRazerV4PollingCode,
  razerV4Crc,
  type RazerV4DpiState as DpiState,
} from "@openmouse/protocol/razer-v4";

export const RAZER_VENDOR_ID = 0x1532;
export { VIPER_V4_PRO_PRODUCTS };

const RESPONSE_ATTEMPTS = 16;
const RESPONSE_DELAY_MS = 35;

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export class RazerViperV4ProHidClient {
  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    const [collection] = device.collections;
    const hasControlCollection = device.collections.length === 1
      && (collection?.usagePage === 0x01 || collection?.usagePage === 0x0c)
      && collection.featureReports.some((report) => report.reportId === REPORT_ID);
    return device.vendorId === RAZER_VENDOR_ID
      && VIPER_V4_PRO_PRODUCTS.has(device.productId)
      && hasControlCollection;
  }

  async open(): Promise<void> {
    await openRazerDevice(this.device);
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = 100; dpi <= 50000; dpi += 50) options.push(dpi);
    return options;
  }

  getSleepOptions(): readonly number[] { return [60, 300, 600, 900]; }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    // Feature reports share one control endpoint. Keep every request/response
    // pair in order so a busy response cannot be mistaken for another read.
    const dpi = await this.readDpi();
    const polling = await this.command(0x00, 0xc0, 2, new Uint8Array([1]));
    const battery = await this.command(0x07, 0x80, 2, new Uint8Array([0, 0]));
    const charging = await this.command(0x07, 0x84, 2, new Uint8Array([0, 0]));
    const sleepTimeout = await this.command(0x07, 0x83, 2);
    const lowPower = await this.command(0x07, 0x81, 1);
    const current = dpi.stages[dpi.activeStage]!;
    const wireless = VIPER_V4_PRO_PRODUCTS.get(this.device.productId)?.wireless ?? false;
    return {
      brand: "Razer",
      name: "Razer Viper V4 Pro",
      ui: { family: "razer-viper-v4-pro", hideUnsupportedPollingRates: true, hideProcessingCard: true, forceShowBattery: true },
      batteryPercent: Math.round(((battery[1] ?? 0) * 100) / 255),
      batteryState: (charging[1] ?? 0) === 1 ? "Charging" : "Discharging",
      dpi: current.x,
      dpiY: current.y,
      supportsSeparateDpiAxes: true,
      pollingRateHz: decodeRazerV4PollingCode(polling[1]),
      supportedPollingRates: [...POLLING_CODES.keys()],
      activeProfile: dpi.activeStage + 1,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: wireless ? "HyperSpeed receiver" : "Wired USB",
      sleepTimeout: readU16BE(sleepTimeout, 0),
      lowBatteryWarning: Math.round(((lowPower[0] ?? 0) * 100) / 255),
      liftOffDistance: null,
      firmware: [],
    };
  }

  async setDpi(dpi: number, dpiY = dpi): Promise<number> {
    if (!this.getDpiOptions().includes(dpi) || !this.getDpiOptions().includes(dpiY)) throw new Error("Viper V4 Pro DPI must be 100–50,000 in 50-DPI increments.");
    const state = await this.readDpi();
    state.stages[state.activeStage] = { x: dpi, y: dpiY };
    await this.writeDpi(state);
    const confirmed = await this.readDpi();
    const current = confirmed.stages[confirmed.activeStage]!;
    if (current.x !== dpi || current.y !== dpiY) throw new Error("The Viper V4 Pro did not confirm the requested DPI.");
    return current.x;
  }

  async setPollingRate(rate: number): Promise<number> {
    const code = POLLING_CODES.get(rate);
    if (code === undefined) throw new Error("Unsupported Viper V4 Pro polling rate.");
    await this.command(0x00, 0x40, 2, new Uint8Array([1, code]));
    // Changing rate briefly reconfigures the wireless link.
    await sleep(150);
    const confirmed = decodeRazerV4PollingCode((await this.command(0x00, 0xc0, 2, new Uint8Array([1])))[1]);
    if (confirmed !== rate) throw new Error(`The Viper V4 Pro kept ${confirmed} Hz instead of ${rate} Hz.`);
    return confirmed;
  }

  async setSleepTimeout(seconds: number): Promise<number> {
    if (!this.getSleepOptions().includes(seconds)) throw new Error("Viper V4 Pro sleep timeout must be 1, 5, 10, or 15 minutes.");
    await this.command(0x07, 0x03, 2, new Uint8Array([seconds >> 8, seconds & 0xff]));
    const confirmed = readU16BE(await this.command(0x07, 0x83, 2), 0);
    if (confirmed !== seconds) throw new Error(`The Viper V4 Pro kept a ${confirmed}-second sleep timeout.`);
    return confirmed;
  }

  // These settings have no verified V4 Pro command yet. Keeping the methods on
  // the common client surface lets the generic UI remain type-safe while hiding
  // unsupported controls via the status values above.
  async setLiftOffDistance(): Promise<never> { throw new Error("Lift-off distance is not mapped for the Viper V4 Pro yet."); }
  async setDebounceTime(): Promise<never> { throw new Error("Debounce tuning is not mapped for the Viper V4 Pro yet."); }
  async setMotionSync(): Promise<never> { throw new Error("Motion Sync is not mapped for the Viper V4 Pro yet."); }
  async setAngleSnapping(): Promise<never> { throw new Error("Angle snapping is not mapped for the Viper V4 Pro yet."); }
  async setRippleControl(): Promise<never> { throw new Error("Ripple control is not mapped for the Viper V4 Pro yet."); }

  private async readDpi(): Promise<DpiState> {
    return decodeRazerV4DpiState(await this.command(0x04, 0x86, 80));
  }

  private async writeDpi(state: DpiState): Promise<void> {
    const args = new Uint8Array(3 + state.stages.length * 7);
    args[0] = 1;
    args[1] = state.activeStage + 1;
    args[2] = state.stages.length;
    state.stages.forEach((stage, index) => {
      const offset = 3 + index * 7;
      args[offset] = index;
      args[offset + 1] = stage.x >> 8;
      args[offset + 2] = stage.x & 0xff;
      args[offset + 3] = stage.y >> 8;
      args[offset + 4] = stage.y & 0xff;
    });
    await this.command(0x04, 0x06, args.length, args);
  }

  private async command(commandClass: number, commandId: number, dataSize: number, args: Uint8Array = new Uint8Array()): Promise<Uint8Array> {
    await this.open();
    const request = buildRazerV4Report(commandClass, commandId, dataSize, args);
    await this.device.sendFeatureReport(REPORT_ID, request.buffer as ArrayBuffer);
    for (let attempt = 0; attempt < RESPONSE_ATTEMPTS; attempt += 1) {
      const view = await this.device.receiveFeatureReport(REPORT_ID);
      const response = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
      if (response.byteLength !== REPORT_LENGTH || response[88] !== razerV4Crc(response)) throw new Error("The Viper V4 Pro returned an invalid Razer control report.");
      if (response[0] === 0x02) {
        if (response[6] !== commandClass || response[7] !== commandId) {
          throw new Error("The Viper V4 Pro returned a response for a different command.");
        }
        return response.slice(8, 8 + (response[5] ?? 0));
      }
      if (response[0] !== 0x01) throw new Error(`The Viper V4 Pro rejected command ${commandClass.toString(16)}/${commandId.toString(16)} (status 0x${response[0]?.toString(16)}).`);
      await sleep(RESPONSE_DELAY_MS);
    }
    throw new Error("The Viper V4 Pro remained busy. Wait a moment and retry.");
  }
}
