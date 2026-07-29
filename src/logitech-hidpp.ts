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
  dpi: number;
  pollingRateHz: number;
  activeProfile: number | null;
  liftOffDistance: "Low" | "Medium" | "High" | null;
  firmware: string[];
}

interface FeatureInfo {
  index: number;
  version: number;
}

export class LogitechHidppClient {
  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (event.reportId !== SHORT_REPORT_ID && event.reportId !== LONG_REPORT_ID) {
      return;
    }

    const report = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
    const next = this.waiters.shift();
    next?.resolve(report);
  };

  private readonly waiters: Array<{
    resolve: (report: Uint8Array) => void;
    reject: (reason: Error) => void;
  }> = [];

  constructor(readonly device: HIDDevice) {}

  static async requestReceiver(): Promise<LogitechHidppClient | null> {
    if (!navigator.hid) {
      throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
    }

    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: LOGITECH_VENDOR_ID, productId: LOGITECH_RECEIVER_PRODUCT_ID }],
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
    const batteryPercent = batteryFeature.index ? await this.readBattery(batteryFeature.index) : null;
    const dpiState = await this.readDpi(dpiFeature.index);
    const pollingRateHz = await this.readPollingRate(reportRateFeature.index);
    const activeProfile = await this.readActiveProfile(profilesFeature.index);
    const firmware = await this.readFirmware(firmwareFeature.index);

    return {
      name,
      batteryPercent,
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

  private async open(): Promise<void> {
    if (!this.device.opened) {
      await this.device.open();
    }
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  private async getFeature(featureId: number): Promise<FeatureInfo> {
    const reply = await this.request(0x00, 0x00, featureId >> 8, featureId & 0xff);
    return { index: reply[3] ?? 0, version: reply[6] ?? 0 };
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

  private async readBattery(featureIndex: number): Promise<number | null> {
    const reply = await this.request(featureIndex, 0x10);
    const percentage = reply[3];
    return percentage && percentage <= 100 ? percentage : null;
  }

  private async readDpi(featureIndex: number): Promise<{ dpi: number; liftOffDistance: LogitechMouseStatus["liftOffDistance"] }> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose extended DPI controls.");
    }

    const reply = await this.request(featureIndex, 0x50);
    const dpi = ((reply[4] ?? 0) << 8) | (reply[5] ?? 0);
    const lod = reply[12];
    const liftOffDistance = lod === 0 ? "Low" : lod === 1 ? "Medium" : lod === 2 ? "High" : null;
    return { dpi, liftOffDistance };
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
    return rate;
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
    await this.device.sendReport(SHORT_REPORT_ID, report);
    return response;
  }

  private waitForResponse(featureIndex: number, functionId: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.reject === reject);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error("The mouse did not answer. Move it or click a button, then try again."));
      }, 2500);

      this.waiters.push({
        resolve: (report) => {
          window.clearTimeout(timeout);
          if (report[0] !== DEVICE_INDEX || report[1] !== featureIndex || report[2] !== functionId) {
            reject(new Error("The receiver returned an unexpected HID++ response."));
            return;
          }
          resolve(report);
        },
        reject,
      });
    });
  }
}
