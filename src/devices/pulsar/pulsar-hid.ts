import type { MouseStatus } from "../mouse-types.ts";
import {
  PULSAR_COMMAND as COMMAND,
  PULSAR_CONFIG_PACKET_LENGTH as CONFIG_PACKET_LENGTH,
  PULSAR_CONFIG_REPORT_ID as CONFIG_REPORT_ID,
  PULSAR_FLASH as FLASH,
  PULSAR_VENDOR_ID,
  pulsarDecodeDpi,
  pulsarDecodePollingRate,
  pulsarDpiOptions,
  pulsarEncodeDpi,
  pulsarEncodePollingRate,
  pulsarPacketChecksum,
} from "@openmouse/protocol/pulsar";

export interface PulsarReport {
  timestamp: number;
  reportId: number;
  bytes: number[];
}

export interface PulsarDeviceInfo {
  cid: number;
  mid: number;
  type: number;
  dongleType: number;
  connection: "Wired" | "Wireless";
  maximumPollingRateHz: number;
}

export class PulsarHidClient {
  private deviceInfo: PulsarDeviceInfo | null = null;
  private reportListener: ((report: PulsarReport) => void) | null = null;
  private responseWaiter: {
    command: number;
    resolve: (bytes: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    this.reportListener?.({ timestamp: Date.now(), reportId: event.reportId, bytes: [...bytes] });
    if (event.reportId === CONFIG_REPORT_ID && bytes[0] === this.responseWaiter?.command) {
      const waiter = this.responseWaiter;
      this.responseWaiter = null;
      waiter.resolve(bytes);
    }
  };

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === PULSAR_VENDOR_ID
      && device.collections.some((collection) =>
        collection.inputReports.length === 1
        && collection.outputReports.length === 1
        && collection.inputReports[0].reportId === CONFIG_REPORT_ID
        && collection.outputReports[0].reportId === CONFIG_REPORT_ID);
  }

  async open(onReport?: (report: PulsarReport) => void): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.reportListener = onReport ?? this.reportListener;
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

  async readDeviceInfo(): Promise<PulsarDeviceInfo> {
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
      maximumPollingRateHz: ({ 0: 1000, 1: 4000, 2: 1000, 3: 8000, 4: 2000, 5: 8000 } as Record<number, number>)[type] ?? 1000,
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
      const dongleLed = [0, 3].includes(info.dongleType)
        ? await this.readDongleLed().catch(() => null)
        : null;
      const rssi = await this.query(COMMAND.getRssi).catch(() => null);
      const currentDpi = Math.min(flash[FLASH.currentDpi] ?? 0, 7);
      const dpi = pulsarDecodeDpi(flash.slice(FLASH.dpiValues + currentDpi * 4, FLASH.dpiValues + currentDpi * 4 + 4));
      const lodValue = flash[FLASH.liftOffDistance];
      return {
        brand: "Pulsar",
        name: info.cid === 0x57 && info.mid === 0x04 ? "Pulsar X2 CrazyLight" : (this.device.productName || "Pulsar Mouse"),
        batteryPercent: battery[5] <= 100 ? battery[5] : null,
        batteryState: battery[6] === 1 ? "Charging" : "Discharging",
        dpi,
        pollingRateHz: pulsarDecodePollingRate(flash[FLASH.reportRate]),
        activeProfile: profile && profile[1] === 0 ? (profile[5] ?? 0) + 1 : null,
        connectionDetail: `CID 0x${info.cid.toString(16).toUpperCase().padStart(2, "0")} · MID 0x${info.mid.toString(16).toUpperCase().padStart(2, "0")} · Dongle type ${info.dongleType}`,
        dongleLedEnabled: dongleLed?.enabled ?? null,
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
    return pulsarDpiOptions();
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    const encoded = pulsarEncodePollingRate(pollingRateHz);
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(FLASH.reportRate, encoded);
      const confirmed = pulsarDecodePollingRate((await this.readFlash(FLASH.reportRate, 2))[0]);
      if (confirmed !== pollingRateHz) throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
      return confirmed;
    });
  }

  async setDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) throw new Error(`${dpi} DPI is not supported by this Pulsar sensor.`);
    return await this.withDeviceControl(async () => {
      const currentDpi = (await this.readFlash(FLASH.currentDpi, 2))[0] ?? 0;
      const address = FLASH.dpiValues + Math.min(currentDpi, 7) * 4;
      await this.writeFlash(address, pulsarEncodeDpi(dpi));
      const confirmed = pulsarDecodeDpi(await this.readFlash(address, 4));
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

  async setDongleLed(enabled: boolean): Promise<boolean> {
    const info = this.deviceInfo ?? await this.readDeviceInfo();
    if (![0, 3].includes(info.dongleType)) {
      throw new Error(`Receiver LED control is not mapped for dongle type ${info.dongleType}.`);
    }
    return await this.withDeviceControl(async () => {
      const current = await this.readDongleLed();
      const payload = new Uint8Array(10);
      payload[0] = enabled ? 1 : 0;
      payload.set(current.colors.flat(), 1);
      this.assertAccepted(await this.query(COMMAND.setDongleRgb, payload), "dongle LED write");
      const confirmed = await this.readDongleLed();
      if (confirmed.enabled !== enabled) throw new Error("The receiver did not confirm the requested LED state.");
      return confirmed.enabled;
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
    if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 15) {
      throw new Error("This Pulsar model supports a debounce time from 0 to 15 ms.");
    }
    return await this.setVerifiedByte(FLASH.debounceTime, debounceMs, "debounce time");
  }

  async setSleepTimeout(timeout: number): Promise<number> {
    if (![1, 3, 6, 12, 30, 60, 180].includes(timeout)) {
      throw new Error("Unsupported Pulsar sleep timeout.");
    }
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(FLASH.sleepTime, timeout);
      await this.writeCheckedByte(FLASH.performanceTime, timeout);
      const sleepConfirmed = (await this.readFlash(FLASH.sleepTime, 2))[0];
      const performanceConfirmed = (await this.readFlash(FLASH.performanceTime, 2))[0];
      if (sleepConfirmed !== timeout || performanceConfirmed !== timeout) {
        throw new Error("The mouse did not confirm the requested sleep timeout.");
      }
      return sleepConfirmed;
    });
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.reportListener = null;
    this.responseWaiter?.reject(new Error("The Pulsar device was closed."));
    this.responseWaiter = null;
    if (this.device.opened) await this.device.close();
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
      packet[15] = pulsarPacketChecksum(packet);
      response = await this.exchange(packet);
      this.assertAccepted(response, enabled ? "host-control entry" : "host-control exit");
      if (response[9] !== 1) break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    }
    if (!response || response[9] === 1) throw new Error("The Pulsar receiver stayed busy.");
    if (enabled && response[5] !== 1) throw new Error("The Pulsar mouse is offline. Move it or click a button, then retry.");
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
      packet[15] = pulsarPacketChecksum(packet);
      const response = await this.exchange(packet);
      this.assertAccepted(response, "configuration read");
      result.set(response.slice(5, 5 + count), offset);
    }
    return result;
  }

  private async readDongleLed(): Promise<{ enabled: boolean; colors: [number[], number[], number[]] }> {
    const response = await this.query(COMMAND.getDongleRgb);
    this.assertAccepted(response, "dongle LED read");
    return {
      enabled: response[5] !== 0,
      colors: [
        [...response.slice(6, 9)],
        [...response.slice(9, 12)],
        [...response.slice(12, 15)],
      ],
    };
  }

  private async writeCheckedByte(address: number, value: number): Promise<void> {
    await this.writeFlash(address, new Uint8Array([value, (0x55 - value) & 0xff]));
  }

  private async setVerifiedByte(address: number, value: number, label: string): Promise<number> {
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(address, value);
      const confirmed = (await this.readFlash(address, 2))[0];
      if (confirmed !== value) throw new Error(`The mouse did not confirm the requested ${label}.`);
      return confirmed;
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
      packet[15] = pulsarPacketChecksum(packet);
      this.assertAccepted(await this.exchange(packet), "configuration write");
    }
  }

  private async query(command: number, parameters = new Uint8Array()): Promise<Uint8Array> {
    if (parameters.length > 10) throw new Error("Pulsar queries support at most 10 parameter bytes.");
    const packet = this.createPacket(command);
    packet[4] = parameters.length;
    packet.set(parameters, 5);
    packet[15] = pulsarPacketChecksum(packet);
    return await this.exchange(packet);
  }

  private async exchange(packet: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    if (this.responseWaiter) throw new Error("Another Pulsar request is already in progress.");
    const command = packet[0];
    let timeout = 0;
    let rejectResponse: ((reason: Error) => void) | null = null;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      rejectResponse = reject;
      timeout = window.setTimeout(() => {
        this.responseWaiter = null;
        reject(new Error(`The Pulsar mouse did not answer command 0x${command.toString(16).padStart(2, "0")}.`));
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
      (rejectResponse as ((reason: Error) => void) | null)?.(new Error(`Chrome could not write Pulsar report 8. ${detail}`));
      this.responseWaiter = null;
    }
    return await response;
  }

  private createPacket(command: number): Uint8Array<ArrayBuffer> {
    const packet = new Uint8Array(CONFIG_PACKET_LENGTH);
    packet[0] = command;
    return packet;
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
    if (response[1] !== 0) throw new Error(`The Pulsar receiver rejected the ${operation} (status ${response[1]}).`);
  }
}
