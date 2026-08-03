import type { MouseStatus } from "./mouse-types";
import {
  batteryPercentFromMillivolts,
  createLamzuPacket,
  decodeLamzuDpi,
  decodeLamzuLod,
  decodeLamzuPollingRate,
  dpiOptionsForLamzu,
  encodeLamzuDpi,
  encodeLamzuLod,
  encodeLamzuPollingRate,
  finalizeLamzuPacket,
  LAMZU_COMMAND,
  LAMZU_FLASH,
  LAMZU_MAX_RESOLUTION_STAGES,
  LAMZU_REPORT_ID,
  lamzuDataChecksum,
  parseBatteryMillivolts,
} from "./lamzu-protocol";
import {
  LAMZU_MAX_POLLING_HZ,
  LAMZU_PRODUCTS,
  VENDOR_ID,
} from "./vendors";

export class LamzuHidClient {
  private responseWaiter: {
    command: number;
    resolve: (bytes: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (event.reportId !== LAMZU_REPORT_ID || !this.responseWaiter) return;
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    if (bytes[0] !== this.responseWaiter.command) return;
    const waiter = this.responseWaiter;
    this.responseWaiter = null;
    waiter.resolve(bytes);
  };

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID.lamzu
      && device.collections.some((collection) =>
        collection.inputReports.some((report) => report.reportId === LAMZU_REPORT_ID)
        && collection.outputReports.some((report) => report.reportId === LAMZU_REPORT_ID));
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  displayName(): string {
    const known = LAMZU_PRODUCTS.get(this.device.productId);
    if (known) return `Lamzu ${known.name}`;
    const product = this.device.productName?.trim();
    if (product) {
      return /lamzu/i.test(product) ? product : `Lamzu ${product}`;
    }
    return "Lamzu Mouse";
  }

  maxPollingRateHz(): number {
    return LAMZU_MAX_POLLING_HZ.get(this.device.productId) ?? 8000;
  }

  connectionType(): "Wired" | "Wireless" {
    return LAMZU_PRODUCTS.get(this.device.productId)?.wireless === false ? "Wired" : "Wireless";
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const flash = await this.readFlash(LAMZU_FLASH.pollRate, LAMZU_FLASH.peakPerformanceTime + 2);
    const batteryResponse = await this.query(LAMZU_COMMAND.batteryVoltage).catch(() => null);
    const profileResponse = await this.query(LAMZU_COMMAND.readActiveProfile).catch(() => null);
    const versionResponse = await this.query(LAMZU_COMMAND.readVersionId).catch(() => null);

    const stageIndex = Math.min(flash[LAMZU_FLASH.resolutionIndex] ?? 0, LAMZU_MAX_RESOLUTION_STAGES - 1);
    const dpi = decodeLamzuDpi(
      flash.slice(
        LAMZU_FLASH.resolutions + stageIndex * 4,
        LAMZU_FLASH.resolutions + stageIndex * 4 + 3,
      ),
    );
    const pollingEncoded = flash[LAMZU_FLASH.pollRate] ?? 1;
    const pollingRateHz = decodeLamzuPollingRate(pollingEncoded) ?? 1000;
    const lod = decodeLamzuLod(flash[LAMZU_FLASH.liftOffDistance] ?? 0);
    const batteryMv = batteryResponse ? parseBatteryMillivolts(batteryResponse) : null;
    const maxHz = this.maxPollingRateHz();
    const supportedPollingRates = [125, 250, 500, 1000, 2000, 4000, 8000].filter((hz) => hz <= maxHz);

    return {
      brand: "Lamzu",
      name: this.displayName(),
      ui: {
        family: "lamzu",
        hideLodLow: true,
        hideUnsupportedPollingRates: true,
        forceShowBattery: this.connectionType() === "Wireless",
        pollingNote: maxHz >= 8000
          ? "Maya receivers support up to 8,000 Hz when the paired dongle allows it."
          : maxHz >= 4000
            ? "This Lamzu receiver supports up to 4,000 Hz."
            : "This Lamzu connection supports up to 1,000 Hz.",
        defaultDisplayName: this.displayName(),
      },
      batteryPercent: batteryMv === null ? null : batteryPercentFromMillivolts(batteryMv),
      batteryVoltageMv: batteryMv,
      batteryState: "Discharging",
      dpi,
      pollingRateHz,
      supportedPollingRates,
      activeProfile: profileResponse && profileResponse[1] === 0
        ? (profileResponse[5] ?? 0) + 1
        : null,
      connectionType: this.connectionType(),
      connectionDetail: `VID 0x${this.device.vendorId.toString(16)} · PID 0x${this.device.productId.toString(16).padStart(4, "0")}`,
      debounceMs: flash[LAMZU_FLASH.debounceMs] ?? null,
      motionSync: flash[LAMZU_FLASH.motionSync] === 1,
      sleepTimeout: flash[LAMZU_FLASH.sleepTime] ?? null,
      angleSnapping: flash[LAMZU_FLASH.angleSnapping] === 1,
      rippleControl: flash[LAMZU_FLASH.rippleControl] === 1,
      performanceMode: flash[LAMZU_FLASH.peakPerformance] === 1,
      liftOffDistance: lod,
      firmware: [
        this.decodeVersionOptional(versionResponse) ?? "Firmware version unavailable",
      ],
    };
  }

  getDpiOptions(): number[] {
    return dpiOptionsForLamzu();
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    const encoded = encodeLamzuPollingRate(pollingRateHz);
    if (encoded === null || pollingRateHz > this.maxPollingRateHz()) {
      throw new Error("Unsupported Lamzu polling rate.");
    }
    await this.writeCheckedByte(LAMZU_FLASH.pollRate, encoded);
    const confirmed = decodeLamzuPollingRate((await this.readFlash(LAMZU_FLASH.pollRate, 2))[0] ?? 0);
    if (confirmed !== pollingRateHz) {
      throw new Error(`The mouse kept ${confirmed ?? "an unknown rate"} instead of ${pollingRateHz} Hz.`);
    }
    return confirmed;
  }

  async setDpi(dpi: number): Promise<number> {
    const encoded = encodeLamzuDpi(dpi);
    if (!encoded) throw new Error(`${dpi} DPI is not supported by this Lamzu sensor encoding.`);
    const stageIndex = Math.min(
      (await this.readFlash(LAMZU_FLASH.resolutionIndex, 2))[0] ?? 0,
      LAMZU_MAX_RESOLUTION_STAGES - 1,
    );
    const address = LAMZU_FLASH.resolutions + stageIndex * 4;
    await this.writeFlash(address, encoded);
    const confirmed = decodeLamzuDpi(await this.readFlash(address, 3));
    if (confirmed !== dpi) throw new Error(`The mouse kept ${confirmed} DPI instead of ${dpi} DPI.`);
    return confirmed;
  }

  async setLiftOffDistance(
    liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]>,
  ): Promise<NonNullable<MouseStatus["liftOffDistance"]>> {
    if (liftOffDistance === "Low") {
      throw new Error("Lamzu Maya supports 1 mm and 2 mm lift-off only.");
    }
    const encoded = encodeLamzuLod(liftOffDistance);
    await this.writeCheckedByte(LAMZU_FLASH.liftOffDistance, encoded);
    const confirmed = decodeLamzuLod((await this.readFlash(LAMZU_FLASH.liftOffDistance, 2))[0] ?? 0);
    if (confirmed !== liftOffDistance) {
      throw new Error(`The mouse kept ${confirmed ?? "an unknown LOD"} instead of ${liftOffDistance}.`);
    }
    return confirmed;
  }

  async setMotionSync(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(LAMZU_FLASH.motionSync, enabled, "Motion Sync");
  }

  async setAngleSnapping(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(LAMZU_FLASH.angleSnapping, enabled, "angle snapping");
  }

  async setRippleControl(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(LAMZU_FLASH.rippleControl, enabled, "ripple control");
  }

  async setPerformanceMode(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(LAMZU_FLASH.peakPerformance, enabled, "performance mode");
  }

  async setDebounceTime(debounceMs: number): Promise<number> {
    if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 15) {
      throw new Error("Lamzu Maya supports a debounce time from 0 to 15 ms.");
    }
    return await this.setVerifiedByte(LAMZU_FLASH.debounceMs, debounceMs, "debounce time");
  }

  async setSleepTimeout(timeout: number): Promise<number> {
    if (![1, 3, 6, 12, 30, 60, 180].includes(timeout)) {
      throw new Error("Unsupported Lamzu sleep timeout.");
    }
    await this.writeCheckedByte(LAMZU_FLASH.sleepTime, timeout);
    await this.writeCheckedByte(LAMZU_FLASH.peakPerformanceTime, timeout);
    const sleepConfirmed = (await this.readFlash(LAMZU_FLASH.sleepTime, 2))[0];
    const performanceConfirmed = (await this.readFlash(LAMZU_FLASH.peakPerformanceTime, 2))[0];
    if (sleepConfirmed !== timeout || performanceConfirmed !== timeout) {
      throw new Error("The mouse did not confirm the requested sleep timeout.");
    }
    return sleepConfirmed;
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.responseWaiter?.reject(new Error("The Lamzu device was closed."));
    this.responseWaiter = null;
    if (this.device.opened) await this.device.close();
  }

  private async readFlash(address: number, length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += 10) {
      const count = Math.min(10, length - offset);
      const packet = createLamzuPacket(LAMZU_COMMAND.readFlash);
      const currentAddress = address + offset;
      packet[2] = currentAddress >> 8;
      packet[3] = currentAddress & 0xff;
      packet[4] = count;
      finalizeLamzuPacket(packet);
      const response = await this.exchange(packet);
      this.assertAccepted(response, "configuration read");
      result.set(response.slice(5, 5 + count), offset);
    }
    return result;
  }

  private async writeFlash(address: number, data: Uint8Array): Promise<void> {
    for (let offset = 0; offset < data.length; offset += 10) {
      const chunk = data.slice(offset, offset + 10);
      const packet = createLamzuPacket(LAMZU_COMMAND.writeFlash);
      const currentAddress = address + offset;
      packet[2] = currentAddress >> 8;
      packet[3] = currentAddress & 0xff;
      packet[4] = chunk.length;
      packet.set(chunk, 5);
      finalizeLamzuPacket(packet);
      this.assertAccepted(await this.exchange(packet), "configuration write");
    }
  }

  private async writeCheckedByte(address: number, value: number): Promise<void> {
    await this.writeFlash(address, new Uint8Array([value, lamzuDataChecksum(new Uint8Array([value]))]));
  }

  private async setVerifiedByte(address: number, value: number, label: string): Promise<number> {
    await this.writeCheckedByte(address, value);
    const confirmed = (await this.readFlash(address, 2))[0];
    if (confirmed !== value) throw new Error(`The mouse did not confirm the requested ${label}.`);
    return confirmed;
  }

  private async setVerifiedBoolean(address: number, enabled: boolean, label: string): Promise<boolean> {
    return (await this.setVerifiedByte(address, enabled ? 1 : 0, label)) === 1;
  }

  private async query(command: number, parameters = new Uint8Array()): Promise<Uint8Array> {
    if (parameters.length > 10) throw new Error("Lamzu queries support at most 10 parameter bytes.");
    const packet = createLamzuPacket(command);
    packet[4] = parameters.length;
    packet.set(parameters, 5);
    finalizeLamzuPacket(packet);
    return await this.exchange(packet);
  }

  private async exchange(packet: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    if (this.responseWaiter) throw new Error("Another Lamzu request is already in progress.");
    await this.open();
    const command = packet[0];
    let timeout = 0;
    let rejectResponse: ((reason: Error) => void) | null = null;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      rejectResponse = reject;
      timeout = window.setTimeout(() => {
        this.responseWaiter = null;
        reject(new Error(`The Lamzu mouse did not answer command 0x${command.toString(16).padStart(2, "0")}.`));
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
      await this.device.sendReport(LAMZU_REPORT_ID, packet);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      (rejectResponse as ((reason: Error) => void) | null)?.(
        new Error(`Chrome could not write Lamzu report 8. ${detail}`),
      );
      this.responseWaiter = null;
    }
    return await response;
  }

  private assertAccepted(response: Uint8Array, label: string): void {
    if (response[1] !== 0) {
      throw new Error(`Lamzu ${label} failed with status 0x${(response[1] ?? 0).toString(16)}.`);
    }
  }

  private decodeVersionOptional(response: Uint8Array | null): string | null {
    if (!response || response[1] !== 0) return null;
    return `Mouse v${response[5] ?? 0}.${(response[6] ?? 0).toString(16).padStart(2, "0")}`;
  }
}
