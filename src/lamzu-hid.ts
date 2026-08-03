import type { MouseStatus } from "./mouse-types";
import {
  auroraStatusIndex,
  auroraValueIndex,
  batteryPercentFromMillivolts,
  createAuroraCommand,
  createLamzuPacket,
  decodeLamzuAuroraPollingRate,
  decodeLamzuDpi,
  decodeLamzuLod,
  decodeLamzuPollingRate,
  dpiOptionsForLamzu,
  encodeLamzuAuroraPollingRate,
  encodeLamzuDpi,
  encodeLamzuLod,
  encodeLamzuPollingRate,
  finalizeLamzuPacket,
  LAMZU_AURORA_CMD,
  LAMZU_AURORA_FEATURE_BYTES,
  LAMZU_AURORA_STATUS_OK,
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

type LamzuTransport = "classic" | "aurora";

function featureReportByteLength(report: HIDReportInfo): number {
  if (!report.items?.length) return 0;
  return report.items.reduce((total, item) => total + item.reportSize * item.reportCount, 0) / 8;
}

function walkCollections(collections: readonly HIDCollectionInfo[]): HIDCollectionInfo[] {
  const result: HIDCollectionInfo[] = [];
  for (const collection of collections) {
    result.push(collection);
    if (collection.children?.length) result.push(...walkCollections(collection.children));
  }
  return result;
}

/**
 * Aurora receivers (including Maya PID 0xfa09) expose a vendor feature report.
 * Chrome sometimes omits item sizes, so any Lamzu feature report is enough to
 * select the interface — we still prefer report 0x06 / 64-byte payloads.
 */
function findAuroraFeatureReport(device: HIDDevice): { reportId: number; bytes: number } | null {
  const reports: HIDReportInfo[] = [];
  for (const collection of walkCollections(device.collections)) {
    reports.push(...collection.featureReports);
  }
  if (reports.length === 0) return null;

  const preferred = reports.find((report) => report.reportId === 0x06)
    ?? reports.find((report) => {
      const bytes = featureReportByteLength(report);
      return bytes >= 64 || report.items?.some((item) => item.reportCount === 64);
    })
    ?? reports[0];

  if (!preferred) return null;
  const bytes = featureReportByteLength(preferred);
  return {
    reportId: preferred.reportId,
    bytes: bytes > 0 ? bytes : LAMZU_AURORA_FEATURE_BYTES,
  };
}

function hasClassicConfigReports(device: HIDDevice): boolean {
  return walkCollections(device.collections).some((collection) =>
    collection.inputReports.some((report) => report.reportId === LAMZU_REPORT_ID)
    && collection.outputReports.some((report) => report.reportId === LAMZU_REPORT_ID));
}

export class LamzuHidClient {
  private transport: LamzuTransport | null = null;
  private auroraReportId = 0;
  private auroraReportBytes = LAMZU_AURORA_FEATURE_BYTES;
  private auroraHidIndex = 0;
  private auroraIsNewProtocol = true;
  private auroraProfile = 0;
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
      && (hasClassicConfigReports(device) || findAuroraFeatureReport(device) !== null);
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (this.transport === "classic") {
      this.device.addEventListener("inputreport", this.onInputReport);
    }
  }

  displayName(): string {
    const known = LAMZU_PRODUCTS.get(this.device.productId);
    if (known) return `Lamzu ${known.name}`;
    const product = this.device.productName?.trim();
    if (product) {
      if (/maya/i.test(product)) return /lamzu/i.test(product) ? product : `Lamzu ${product}`;
      if (/2\.4g|receiver|dongle/i.test(product)) return "Lamzu Maya";
      return /lamzu/i.test(product) ? product : `Lamzu ${product}`;
    }
    return "Lamzu Maya";
  }

  maxPollingRateHz(): number {
    return LAMZU_MAX_POLLING_HZ.get(this.device.productId) ?? 8000;
  }

  connectionType(): "Wired" | "Wireless" {
    const known = LAMZU_PRODUCTS.get(this.device.productId);
    if (known) return known.wireless ? "Wireless" : "Wired";
    const product = this.device.productName ?? "";
    if (/receiver|dongle|2\.4g/i.test(product)) return "Wireless";
    if (/cable|wired|usb/i.test(product)) return "Wired";
    return "Wireless";
  }

  async readStatus(): Promise<MouseStatus> {
    await this.ensureTransport();
    return this.transport === "aurora"
      ? await this.readAuroraStatus()
      : await this.readClassicStatus();
  }

  getDpiOptions(): number[] {
    return dpiOptionsForLamzu();
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    await this.ensureTransport();
    if (this.transport === "aurora") {
      const encoded = encodeLamzuAuroraPollingRate(pollingRateHz);
      if (encoded === null || pollingRateHz > this.maxPollingRateHz()) {
        throw new Error("Unsupported Lamzu polling rate.");
      }
      await this.auroraSet(LAMZU_AURORA_CMD.setPolling, encoded);
      const confirmed = await this.getPollingRate();
      if (confirmed !== pollingRateHz) {
        throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
      }
      return confirmed;
    }

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
    await this.ensureTransport();
    if (this.transport === "aurora") return await this.setAuroraDpi(dpi);

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
    await this.ensureTransport();
    if (liftOffDistance === "Low") {
      throw new Error("Lamzu Maya supports 1 mm and 2 mm lift-off only.");
    }
    const encoded = encodeLamzuLod(liftOffDistance);
    if (this.transport === "aurora") {
      await this.auroraSet(LAMZU_AURORA_CMD.setLod, encoded);
      const confirmed = decodeLamzuLod(await this.auroraGetValue(LAMZU_AURORA_CMD.getLod));
      if (confirmed !== liftOffDistance) {
        throw new Error(`The mouse kept ${confirmed ?? "an unknown LOD"} instead of ${liftOffDistance}.`);
      }
      return confirmed;
    }
    await this.writeCheckedByte(LAMZU_FLASH.liftOffDistance, encoded);
    const confirmed = decodeLamzuLod((await this.readFlash(LAMZU_FLASH.liftOffDistance, 2))[0] ?? 0);
    if (confirmed !== liftOffDistance) {
      throw new Error(`The mouse kept ${confirmed ?? "an unknown LOD"} instead of ${liftOffDistance}.`);
    }
    return confirmed;
  }

  async setMotionSync(enabled: boolean): Promise<boolean> {
    await this.ensureTransport();
    if (this.transport === "aurora") {
      await this.auroraSet(LAMZU_AURORA_CMD.setMotionSync, enabled ? 1 : 0);
      return (await this.auroraGetValue(LAMZU_AURORA_CMD.getMotionSync)) === 1;
    }
    return await this.setVerifiedBoolean(LAMZU_FLASH.motionSync, enabled, "Motion Sync");
  }

  async setAngleSnapping(enabled: boolean): Promise<boolean> {
    await this.ensureTransport();
    if (this.transport === "aurora") {
      await this.auroraSet(LAMZU_AURORA_CMD.setAngleSnap, enabled ? 1 : 0);
      return (await this.auroraGetValue(LAMZU_AURORA_CMD.getAngleSnap)) === 1;
    }
    return await this.setVerifiedBoolean(LAMZU_FLASH.angleSnapping, enabled, "angle snapping");
  }

  async setRippleControl(enabled: boolean): Promise<boolean> {
    await this.ensureTransport();
    if (this.transport === "aurora") {
      await this.auroraSet(LAMZU_AURORA_CMD.setRipple, enabled ? 1 : 0);
      return (await this.auroraGetValue(LAMZU_AURORA_CMD.getRipple)) === 1;
    }
    return await this.setVerifiedBoolean(LAMZU_FLASH.rippleControl, enabled, "ripple control");
  }

  async setPerformanceMode(enabled: boolean): Promise<boolean> {
    await this.ensureTransport();
    if (this.transport === "aurora") {
      throw new Error("Performance mode is not exposed on this Aurora receiver protocol.");
    }
    return await this.setVerifiedBoolean(LAMZU_FLASH.peakPerformance, enabled, "performance mode");
  }

  async setDebounceTime(debounceMs: number): Promise<number> {
    await this.ensureTransport();
    if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 15) {
      throw new Error("Lamzu Maya supports a debounce time from 0 to 15 ms.");
    }
    if (this.transport === "aurora") {
      const request = createAuroraCommand(LAMZU_AURORA_CMD.setDebounce, {
        profile: this.auroraProfile,
        value: debounceMs,
        isNewProtocol: true,
      });
      // Debounce always carries profile then value in Aurora's encoding.
      request[6] = this.auroraProfile;
      request[7] = debounceMs;
      await this.auroraExchange(request);
      return await this.auroraGetValue(LAMZU_AURORA_CMD.getDebounce);
    }
    return await this.setVerifiedByte(LAMZU_FLASH.debounceMs, debounceMs, "debounce time");
  }

  async setSleepTimeout(timeout: number): Promise<number> {
    await this.ensureTransport();
    if (![1, 3, 6, 12, 30, 60, 180].includes(timeout)) {
      throw new Error("Unsupported Lamzu sleep timeout.");
    }
    if (this.transport === "aurora") {
      throw new Error("Auto-sleep is not writable on this Aurora receiver yet.");
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

  private async ensureTransport(): Promise<void> {
    if (this.transport) {
      await this.open();
      return;
    }
    const aurora = findAuroraFeatureReport(this.device);
    if (aurora) {
      this.transport = "aurora";
      this.auroraReportId = aurora.reportId;
      this.auroraReportBytes = Math.max(aurora.bytes, LAMZU_AURORA_FEATURE_BYTES);
      this.auroraIsNewProtocol = true;
    } else if (hasClassicConfigReports(this.device)) {
      this.transport = "classic";
    } else {
      throw new Error("No supported Lamzu control interface was found on this device.");
    }
    await this.open();
  }

  private async readClassicStatus(): Promise<MouseStatus> {
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
    const pollingRateHz = decodeLamzuPollingRate(flash[LAMZU_FLASH.pollRate] ?? 1) ?? 1000;
    const lod = decodeLamzuLod(flash[LAMZU_FLASH.liftOffDistance] ?? 0);
    const batteryMv = batteryResponse ? parseBatteryMillivolts(batteryResponse) : null;
    return this.buildStatus({
      dpi,
      pollingRateHz,
      lod,
      batteryPercent: batteryMv === null ? null : batteryPercentFromMillivolts(batteryMv),
      batteryVoltageMv: batteryMv,
      activeProfile: profileResponse && profileResponse[1] === 0
        ? (profileResponse[5] ?? 0) + 1
        : null,
      debounceMs: flash[LAMZU_FLASH.debounceMs] ?? null,
      motionSync: flash[LAMZU_FLASH.motionSync] === 1,
      sleepTimeout: flash[LAMZU_FLASH.sleepTime] ?? null,
      angleSnapping: flash[LAMZU_FLASH.angleSnapping] === 1,
      rippleControl: flash[LAMZU_FLASH.rippleControl] === 1,
      performanceMode: flash[LAMZU_FLASH.peakPerformance] === 1,
      firmware: [this.decodeVersionOptional(versionResponse) ?? "Firmware version unavailable"],
      protocolLabel: "Compx report 8",
    });
  }

  private async readAuroraStatus(): Promise<MouseStatus> {
    const pollingRateHz = await this.getPollingRate();
    const lodRaw = await this.auroraGetValue(LAMZU_AURORA_CMD.getLod).catch(() => 1);
    const motionSync = (await this.auroraGetValue(LAMZU_AURORA_CMD.getMotionSync).catch(() => 0)) === 1;
    const angleSnapping = (await this.auroraGetValue(LAMZU_AURORA_CMD.getAngleSnap).catch(() => 0)) === 1;
    const rippleControl = (await this.auroraGetValue(LAMZU_AURORA_CMD.getRipple).catch(() => 0)) === 1;
    const debounceMs = await this.auroraGetValue(LAMZU_AURORA_CMD.getDebounce).catch(() => null);
    const dpi = await this.readAuroraDpi().catch(() => 800);
    const firmware = await this.readAuroraFirmware().catch(() => "Firmware version unavailable");

    return this.buildStatus({
      dpi,
      pollingRateHz,
      lod: decodeLamzuLod(lodRaw),
      batteryPercent: null,
      batteryVoltageMv: null,
      activeProfile: this.auroraProfile + 1,
      debounceMs,
      motionSync,
      sleepTimeout: null,
      angleSnapping,
      rippleControl,
      performanceMode: null,
      firmware: [firmware],
      protocolLabel: `Aurora feature report 0x${this.auroraReportId.toString(16)}`,
    });
  }

  private buildStatus(input: {
    dpi: number;
    pollingRateHz: number;
    lod: MouseStatus["liftOffDistance"];
    batteryPercent: number | null;
    batteryVoltageMv: number | null;
    activeProfile: number | null;
    debounceMs: number | null;
    motionSync: boolean | null;
    sleepTimeout: number | null;
    angleSnapping: boolean | null;
    rippleControl: boolean | null;
    performanceMode: boolean | null;
    firmware: string[];
    protocolLabel: string;
  }): MouseStatus {
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
        hideProcessingCard: false,
        pollingNote: maxHz >= 8000
          ? "Maya receivers support up to 8,000 Hz when the paired dongle allows it."
          : maxHz >= 4000
            ? "This Lamzu receiver supports up to 4,000 Hz."
            : "This Lamzu connection supports up to 1,000 Hz.",
        defaultDisplayName: this.displayName(),
      },
      batteryPercent: input.batteryPercent,
      batteryVoltageMv: input.batteryVoltageMv,
      batteryState: "Discharging",
      dpi: input.dpi,
      pollingRateHz: input.pollingRateHz,
      supportedPollingRates,
      activeProfile: input.activeProfile,
      connectionType: this.connectionType(),
      connectionDetail: `${input.protocolLabel} · PID 0x${this.device.productId.toString(16).padStart(4, "0")}`,
      debounceMs: input.debounceMs,
      motionSync: input.motionSync,
      sleepTimeout: input.sleepTimeout,
      angleSnapping: input.angleSnapping,
      rippleControl: input.rippleControl,
      performanceMode: input.performanceMode,
      liftOffDistance: input.lod,
      firmware: input.firmware,
    };
  }

  private async getPollingRate(): Promise<number> {
    const encoded = await this.auroraGetValue(LAMZU_AURORA_CMD.getPolling);
    return decodeLamzuAuroraPollingRate(encoded) ?? 1000;
  }

  private async readAuroraDpi(): Promise<number> {
    const stage = await this.auroraGetValue(LAMZU_AURORA_CMD.getActiveDpi);
    const request = createAuroraCommand(LAMZU_AURORA_CMD.getDpiStages, {
      profile: this.auroraProfile,
      isNewProtocol: true,
    });
    request[6] = this.auroraProfile;
    request[7] = 6;
    const response = await this.auroraExchange(request);
    const countIndex = auroraValueIndex(this.auroraHidIndex, true);
    const count = response[countIndex] ?? 0;
    if (count <= 0 || stage >= count) return 800;
    const base = countIndex + 1 + stage * 4;
    return ((response[base] ?? 0) << 8) | (response[base + 1] ?? 0);
  }

  private async setAuroraDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) {
      throw new Error(`${dpi} DPI is not supported by this Lamzu sensor encoding.`);
    }
    const stage = await this.auroraGetValue(LAMZU_AURORA_CMD.getActiveDpi);
    const readRequest = createAuroraCommand(LAMZU_AURORA_CMD.getDpiStages, {
      profile: this.auroraProfile,
      isNewProtocol: true,
    });
    readRequest[6] = this.auroraProfile;
    readRequest[7] = 6;
    const current = await this.auroraExchange(readRequest);
    const countIndex = auroraValueIndex(this.auroraHidIndex, true);
    const count = current[countIndex] ?? 0;
    if (count <= 0) throw new Error("The mouse did not report any DPI stages.");

    const write = new Uint8Array(LAMZU_AURORA_FEATURE_BYTES);
    write[2] = LAMZU_AURORA_CMD.setDpiStages[0];
    write[3] = LAMZU_AURORA_CMD.setDpiStages[1];
    write[4] = LAMZU_AURORA_CMD.setDpiStages[2];
    write[5] = LAMZU_AURORA_CMD.setDpiStages[3];
    write[6] = this.auroraProfile;
    write[7] = count;
    for (let index = 0; index < count * 4; index += 1) {
      write[8 + index] = current[countIndex + 1 + index] ?? 0;
    }
    const offset = 8 + stage * 4;
    write[offset] = (dpi >> 8) & 0xff;
    write[offset + 1] = dpi & 0xff;
    write[offset + 2] = (dpi >> 8) & 0xff;
    write[offset + 3] = dpi & 0xff;
    await this.auroraExchange(write);

    const confirmed = await this.readAuroraDpi();
    if (confirmed !== dpi) throw new Error(`The mouse kept ${confirmed} DPI instead of ${dpi} DPI.`);
    return confirmed;
  }

  private async readAuroraFirmware(): Promise<string> {
    const request = createAuroraCommand(LAMZU_AURORA_CMD.getFirmware, { isNewProtocol: false });
    request[2] = 2;
    request[3] = 16;
    request[5] = 129;
    const response = await this.auroraExchange(request);
    if (response[6] === 129) {
      this.auroraHidIndex = 0;
      return `Mouse v${response[7] ?? 0}.${response[8] ?? 0}.${response[9] ?? 0}.${response[10] ?? 0}`;
    }
    if (response[5] === 129) {
      this.auroraHidIndex = 1;
      return `Mouse v${response[6] ?? 0}.${response[7] ?? 0}.${response[8] ?? 0}.${response[9] ?? 0}`;
    }
    return "Firmware version unavailable";
  }

  private async auroraSet(
    cmd: readonly [number, number, number, number],
    value: number,
  ): Promise<void> {
    const request = createAuroraCommand(cmd, {
      profile: this.auroraProfile,
      value,
      isNewProtocol: this.auroraIsNewProtocol,
    });
    await this.auroraExchange(request);
  }

  private async auroraGetValue(cmd: readonly [number, number, number, number]): Promise<number> {
    const request = createAuroraCommand(cmd, {
      profile: this.auroraProfile,
      isNewProtocol: this.auroraIsNewProtocol,
    });
    const response = await this.auroraExchange(request);
    return response[auroraValueIndex(this.auroraHidIndex, this.auroraIsNewProtocol)] ?? 0;
  }

  private async auroraExchange(request: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    await this.open();
    const payload = new Uint8Array(this.auroraReportBytes);
    payload.set(request.subarray(0, Math.min(request.length, this.auroraReportBytes)));

    let response = new Uint8Array(0);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await this.device.sendFeatureReport(this.auroraReportId, payload);
      } catch (error) {
        lastError = error;
        // Aurora's own webdriver always uses report ID 0; some stacks accept that.
        if (this.auroraReportId !== 0) {
          try {
            await this.device.sendFeatureReport(0, payload);
            this.auroraReportId = 0;
          } catch (fallbackError) {
            lastError = fallbackError;
            continue;
          }
        } else {
          continue;
        }
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
      try {
        const view = await this.device.receiveFeatureReport(this.auroraReportId);
        response = Uint8Array.from(
          { length: view.byteLength },
          (_, index) => view.getUint8(index),
        );
      } catch (error) {
        lastError = error;
        continue;
      }
      if ((response[0] ?? 0) === LAMZU_AURORA_STATUS_OK) this.auroraHidIndex = 1;
      else if ((response[1] ?? 0) === LAMZU_AURORA_STATUS_OK) this.auroraHidIndex = 0;
      else if ((response[0] ?? 0) >= 160) this.auroraHidIndex = 1;
      else this.auroraHidIndex = 0;
      const status = response[auroraStatusIndex(this.auroraHidIndex)] ?? 0;
      if (status === LAMZU_AURORA_STATUS_OK || status === 2) return response;
    }
    const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
    throw new Error(
      `Lamzu Aurora command failed (report 0x${this.auroraReportId.toString(16)}, status ${
        response[auroraStatusIndex(this.auroraHidIndex)] ?? "none"
      }).${detail}`,
    );
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
