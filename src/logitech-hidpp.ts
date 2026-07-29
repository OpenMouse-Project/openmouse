const LOGITECH_VENDOR_ID = 0x046d;
const LOGITECH_RECEIVER_PRODUCT_ID = 0xc54d;
const SHORT_REPORT_ID = 0x10;
const LONG_REPORT_ID = 0x11;
const DEVICE_INDEX = 0x01;

const FEATURE = {
  deviceName: 0x0005,
  firmware: 0x0003,
  unifiedBattery: 0x1004,
  extendedDpi: 0x2202,
  extendedReportRate: 0x8061,
  onboardProfiles: 0x8100,
} as const;

const REPORT_RATE_HZ = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

export interface LogitechMouseStatus {
  name: string;
  batteryPercent: number | null;
  batteryState: "Charging" | "Charging slowly" | "Almost full" | "Full" | "Discharging" | "Unknown";
  dpi: number;
  pollingRateHz: number;
  activeProfile: number | null;
  liftOffDistance: "Low" | "Medium" | "High" | null;
  firmware: string[];
}

interface BatteryReading {
  percent: number | null;
  state: LogitechMouseStatus["batteryState"];
}

interface FeatureInfo {
  index: number;
  version: number;
}

interface DpiConfiguration {
  x: number;
  y: number;
  lod: number;
}

export class LogitechHidppClient {
  private dpiOptionsCache: number[] | null = null;
  private reportRateFeatureIndex: number | null = null;
  private livePollingRateHz: number | null = null;
  private readonly rateChangeWaiters: Array<{ rate: number; resolve: () => void; reject: (reason: Error) => void }> = [];
  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (event.reportId !== SHORT_REPORT_ID && event.reportId !== LONG_REPORT_ID) {
      return;
    }

    const report = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
    if (report[0] === DEVICE_INDEX && report[1] === this.reportRateFeatureIndex && report[2] === 0x00 && report[3] === 0x01) {
      const rate = REPORT_RATE_HZ[report[4] ?? -1];
      if (rate) {
        this.livePollingRateHz = rate;
        const matchingRateWaiters = this.rateChangeWaiters.filter((waiter) => waiter.rate === rate);
        this.rateChangeWaiters.splice(0, this.rateChangeWaiters.length, ...this.rateChangeWaiters.filter((waiter) => waiter.rate !== rate));
        matchingRateWaiters.forEach((waiter) => waiter.resolve());
      }
    }
    const matchingIndex = this.waiters.findIndex(
      (waiter) => report[0] === DEVICE_INDEX && report[1] === waiter.featureIndex && report[2] === waiter.functionId,
    );
    if (matchingIndex >= 0) {
      this.waiters.splice(matchingIndex, 1)[0].resolve(report);
      return;
    }

    // HID++ can emit a status notification between a write acknowledgement and
    // the matching read response. Leave the pending request in place and wait.
    if (report[0] === DEVICE_INDEX && report[1] === 0xff) {
      const failedIndex = this.waiters.findIndex(
        (waiter) => report[2] === waiter.featureIndex && report[3] === waiter.functionId,
      );
      if (failedIndex >= 0) {
        this.waiters.splice(failedIndex, 1)[0].reject(new Error("The mouse rejected that setting."));
      }
    }
  };

  private readonly waiters: Array<{
    featureIndex: number;
    functionId: number;
    resolve: (report: Uint8Array) => void;
    reject: (reason: Error) => void;
  }> = [];

  constructor(readonly device: HIDDevice) {}

  static async requestReceiver(): Promise<LogitechHidppClient | null> {
    if (!navigator.hid) {
      throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
    }

    const devices = await navigator.hid.requestDevice({
      filters: [{
        vendorId: LOGITECH_VENDOR_ID,
        productId: LOGITECH_RECEIVER_PRODUCT_ID,
        usagePage: 0xff00,
        usage: 0x0001,
      }],
    });
    const device = devices[0];
    return device ? new LogitechHidppClient(device) : null;
  }

  static async reconnectAuthorizedReceiver(): Promise<LogitechHidppClient | null> {
    if (!navigator.hid) {
      return null;
    }

    const devices = await navigator.hid.getDevices();
    const device = devices.find(
      (candidate) => candidate.vendorId === LOGITECH_VENDOR_ID && candidate.productId === LOGITECH_RECEIVER_PRODUCT_ID,
    );
    return device ? new LogitechHidppClient(device) : null;
  }

  async readStatus(): Promise<LogitechMouseStatus> {
    await this.open();

    const nameFeature = await this.getFeature(FEATURE.deviceName);
    const firmwareFeature = await this.getFeature(FEATURE.firmware);
    const batteryFeature = await this.getFeature(FEATURE.unifiedBattery);
    const dpiFeature = await this.getFeature(FEATURE.extendedDpi);
    const reportRateFeature = await this.getFeature(FEATURE.extendedReportRate);
    const profilesFeature = await this.getFeature(FEATURE.onboardProfiles);

    // HID++ receivers expect one request at a time. Keeping the sequence serial
    // also makes every input report unambiguous to the WebHID event handler.
    const name = await this.readName(nameFeature.index);
    const battery = batteryFeature.index ? await this.readBattery(batteryFeature.index) : { percent: null, state: "Unknown" as const };
    const dpiState = await this.readDpi(dpiFeature.index);
    const pollingRateHz = await this.readPollingRate(reportRateFeature.index);
    const activeProfile = await this.readActiveProfile(profilesFeature.index);
    const firmware = await this.readFirmware(firmwareFeature.index);

    return {
      name,
      batteryPercent: battery.percent,
      batteryState: battery.state,
      dpi: dpiState.dpi,
      liftOffDistance: dpiState.liftOffDistance,
      pollingRateHz,
      activeProfile,
      firmware,
    };
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    if (this.device.opened) {
      await this.device.close();
    }
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    const rateIndex = REPORT_RATE_HZ.indexOf(pollingRateHz as (typeof REPORT_RATE_HZ)[number]);
    if (rateIndex < 0) {
      throw new Error("Unsupported polling rate.");
    }

    await this.ensureHostControl();
    const feature = await this.getFeature(FEATURE.extendedReportRate);
    if (!feature.index) {
      throw new Error("This mouse does not expose report-rate controls.");
    }
    const confirmation = this.waitForRateChange(pollingRateHz);
    await this.request(feature.index, 0x30, rateIndex);
    await confirmation;
    return pollingRateHz;
  }

  async getDpiOptions(): Promise<number[]> {
    if (this.dpiOptionsCache) {
      return this.dpiOptionsCache;
    }
    const feature = await this.getFeature(FEATURE.extendedDpi);
    if (!feature.index) {
      throw new Error("This mouse does not expose extended DPI controls.");
    }

    const bytes: number[] = [];
    for (let page = 0; page < 32; page += 1) {
      const reply = await this.request(feature.index, 0x20, 0x00, 0x00, page);
      bytes.push(...reply.slice(6));
      if (bytes.some((value, index) => index > 0 && bytes[index - 1] === 0 && value === 0)) {
        break;
      }
    }

    const options: number[] = [];
    for (let index = 0; index + 1 < bytes.length; ) {
      const value = (bytes[index] << 8) | bytes[index + 1];
      if (value === 0) break;
      if (value >> 13 === 0b111) {
        const step = value & 0x1fff;
        const last = ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0);
        const first = options.at(-1);
        if (!first || !last || last <= first) {
          throw new Error("The mouse returned an invalid DPI range.");
        }
        for (let dpi = first + step; dpi <= last; dpi += step) options.push(dpi);
        index += 4;
      } else {
        options.push(value);
        index += 2;
      }
    }
    this.dpiOptionsCache = options;
    return options;
  }

  async setDpi(dpi: number): Promise<number> {
    const options = await this.getDpiOptions();
    if (!options.includes(dpi)) {
      throw new Error(`${dpi} DPI is not advertised by this mouse.`);
    }

    await this.ensureHostControl();
    const feature = await this.getFeature(FEATURE.extendedDpi);
    const current = await this.readDpiConfiguration(feature.index);
    await this.requestLong(feature.index, 0x60, [
      0x00,
      dpi >> 8,
      dpi & 0xff,
      dpi >> 8,
      dpi & 0xff,
      current.lod,
    ]);
    const confirmed = await this.readDpiConfiguration(feature.index);
    if (confirmed.x !== dpi) {
      throw new Error(`The mouse kept ${confirmed.x} DPI instead of ${dpi} DPI.`);
    }
    return confirmed.x;
  }

  private async open(): Promise<void> {
    if (!this.device.opened) {
      await this.device.open();
    }
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  private async getFeature(featureId: number): Promise<FeatureInfo> {
    const reply = await this.request(0x00, 0x00, featureId >> 8, featureId & 0xff);
    const feature = { index: reply[3] ?? 0, version: reply[6] ?? 0 };
    if (featureId === FEATURE.extendedReportRate) this.reportRateFeatureIndex = feature.index;
    return feature;
  }

  private async readName(featureIndex: number): Promise<string> {
    const header = await this.request(featureIndex, 0x00);
    const nameLength = header[3] ?? 0;
    const fragments: number[] = [];

    for (let offset = 0; offset < nameLength; offset += 16) {
      const reply = await this.request(featureIndex, 0x10, offset);
      fragments.push(...reply.slice(3, 3 + Math.min(16, nameLength - offset)));
    }

    return new TextDecoder().decode(new Uint8Array(fragments));
  }

  private async readBattery(featureIndex: number): Promise<BatteryReading> {
    const reply = await this.request(featureIndex, 0x10);
    const percentage = reply[3];
    const state = ({
      0x00: "Discharging",
      0x01: "Charging",
      0x02: "Almost full",
      0x03: "Full",
      0x04: "Charging slowly",
    } as const)[reply[5] ?? -1] ?? "Unknown";
    return { percent: percentage && percentage <= 100 ? percentage : null, state };
  }

  private async readDpi(featureIndex: number): Promise<{ dpi: number; liftOffDistance: LogitechMouseStatus["liftOffDistance"] }> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose extended DPI controls.");
    }

    const configuration = await this.readDpiConfiguration(featureIndex);
    const dpi = configuration.x;
    const lod = configuration.lod;
    const liftOffDistance = lod === 0 ? "Low" : lod === 1 ? "Medium" : lod === 2 ? "High" : null;
    return { dpi, liftOffDistance };
  }

  private async readDpiConfiguration(featureIndex: number): Promise<DpiConfiguration> {
    const reply = await this.request(featureIndex, 0x50);
    const x = ((reply[4] ?? 0) << 8) | (reply[5] ?? 0);
    const y = ((reply[8] ?? 0) << 8) | (reply[9] ?? 0);
    return { x, y, lod: reply[12] ?? 0 };
  }

  private async readPollingRate(featureIndex: number): Promise<number> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose extended report-rate controls.");
    }

    const reply = await this.request(featureIndex, 0x20);
    const rate = REPORT_RATE_HZ[reply[3] ?? -1];
    if (!rate) {
      throw new Error("The mouse returned an unknown report-rate value.");
    }
    return this.livePollingRateHz ?? rate;
  }

  private waitForRateChange(rate: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const index = this.rateChangeWaiters.findIndex((waiter) => waiter.reject === reject);
        if (index >= 0) this.rateChangeWaiters.splice(index, 1);
        reject(new Error("The mouse acknowledged the rate write but did not confirm the new active rate."));
      }, 6000);
      this.rateChangeWaiters.push({
        rate,
        resolve: () => {
          window.clearTimeout(timeout);
          resolve();
        },
        reject,
      });
    });
  }

  private async readActiveProfile(featureIndex: number): Promise<number | null> {
    if (!featureIndex) {
      return null;
    }

    const mode = await this.request(featureIndex, 0x20);
    if (mode[3] !== 0x01) {
      return null;
    }

    const active = await this.request(featureIndex, 0x40);
    return ((active[3] ?? 0) << 8) | (active[4] ?? 0);
  }

  private async ensureHostControl(): Promise<void> {
    const profiles = await this.getFeature(FEATURE.onboardProfiles);
    if (!profiles.index) return;
    const mode = await this.request(profiles.index, 0x20);
    if (mode[3] === 0x02) return;
    await this.request(profiles.index, 0x10, 0x02);
    const confirmed = await this.request(profiles.index, 0x20);
    if (confirmed[3] !== 0x02) {
      throw new Error("The mouse did not enter host-control mode.");
    }
  }

  private async readFirmware(featureIndex: number): Promise<string[]> {
    if (!featureIndex) {
      return [];
    }

    const countReply = await this.request(featureIndex, 0x00);
    const count = countReply[3] ?? 0;
    const decoder = new TextDecoder();
    const firmware: string[] = [];

    for (let item = 0; item < count; item += 1) {
      const reply = await this.request(featureIndex, 0x10, item);
      const name = decoder.decode(reply.slice(4, 7)).replace(/\0/g, "");
      const major = (reply[7] ?? 0).toString(16).padStart(2, "0").toUpperCase();
      const minor = (reply[8] ?? 0).toString(16).padStart(2, "0").toUpperCase();
      firmware.push(`${name} ${major}.${minor}`);
    }
    return firmware;
  }

  private async request(featureIndex: number, functionId: number, ...parameters: number[]): Promise<Uint8Array> {
    if (parameters.length > 3) {
      throw new Error("This WebHID client only sends short, read-only HID++ requests.");
    }

    const report = new Uint8Array([
      DEVICE_INDEX,
      featureIndex,
      functionId,
      parameters[0] ?? 0,
      parameters[1] ?? 0,
      parameters[2] ?? 0,
    ]);
    const response = this.waitForResponse(featureIndex, functionId);
    // Keep the timeout rejection observed even when sendReport itself fails
    // (for example, when a browser selected a protected mouse collection).
    // The original sendReport error is then shown by the control panel.
    void response.catch(() => undefined);
    await this.device.sendReport(SHORT_REPORT_ID, report);
    return await response;
  }

  private async requestLong(featureIndex: number, functionId: number, parameters: number[]): Promise<Uint8Array> {
    if (parameters.length > 16) {
      throw new Error("HID++ long requests support at most 16 parameter bytes.");
    }
    const report = new Uint8Array(19);
    report[0] = DEVICE_INDEX;
    report[1] = featureIndex;
    report[2] = functionId;
    report.set(parameters, 3);
    const response = this.waitForResponse(featureIndex, functionId);
    void response.catch(() => undefined);
    await this.device.sendReport(LONG_REPORT_ID, report);
    return await response;
  }

  private waitForResponse(featureIndex: number, functionId: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.reject === reject);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error("The mouse did not answer. Move it or click a button, then try again."));
      }, 6000);

      this.waiters.push({
        featureIndex,
        functionId,
        resolve: (report) => {
          window.clearTimeout(timeout);
          resolve(report);
        },
        reject,
      });
    });
  }
}
