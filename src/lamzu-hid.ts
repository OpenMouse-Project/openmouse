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
  LAMZU_AURORA_COMMON_DELAY_MS,
  LAMZU_AURORA_FEATURE_BYTES,
  LAMZU_AURORA_STATUS_OK,
  LAMZU_COMMAND,
  LAMZU_FLASH,
  LAMZU_MAX_RESOLUTION_STAGES,
  LAMZU_PACKET_LENGTH,
  LAMZU_REPORT_ID,
  lamzuDataChecksum,
  parseAuroraBattery,
  parseBatteryMillivolts,
} from "./lamzu-protocol";
import {
  isLamzuVendor,
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

/** Windows WebHID requires feature writes to use the max feature-report size. */
function maxFeatureReportBytes(device: HIDDevice): number {
  let max = 0;
  for (const collection of walkCollections(device.collections)) {
    for (const report of collection.featureReports) {
      max = Math.max(max, featureReportByteLength(report));
    }
  }
  return max;
}

/**
 * True Aurora command interfaces expose a ~64-byte feature report (reportCount 64
 * on Linux/macOS; often 63 data bytes on Windows). Tiny vendor features such as
 * `0x06 @ 7 B` are NOT Aurora — they cannot carry DPI stage writes.
 */
function isAuroraSizedFeatureReport(report: HIDReportInfo): boolean {
  if (report.items?.some((item) => item.reportCount === 64)) return true;
  const bytes = featureReportByteLength(report);
  return bytes >= 32;
}

function listFeatureReports(device: HIDDevice): HIDReportInfo[] {
  const reports: HIDReportInfo[] = [];
  for (const collection of walkCollections(device.collections)) {
    reports.push(...collection.featureReports);
  }
  return reports;
}

/**
 * Official Lamzu Aurora (`dm`) uses feature report 0 with reportCount 64.
 * Compx Aurora variants often use report 0x06. Never treat a 7-byte utility
 * feature as a real Aurora settings channel.
 */
function findAuroraFeatureReport(device: HIDDevice): { reportId: number; bytes: number } | null {
  const reports = listFeatureReports(device);
  const candidates = reports.filter(isAuroraSizedFeatureReport);
  if (candidates.length === 0) return null;

  const preferred = candidates.find((report) => {
    const bytes = featureReportByteLength(report);
    return report.reportId === 0 && (bytes >= 64 || report.items?.some((item) => item.reportCount === 64));
  })
    ?? candidates.find((report) => {
      const bytes = featureReportByteLength(report);
      return bytes >= 64 || report.items?.some((item) => item.reportCount === 64);
    })
    ?? candidates.find((report) => report.reportId === 0)
    ?? candidates.find((report) => report.reportId === 0x06)
    ?? candidates[0];

  if (!preferred) return null;
  const preferredBytes = featureReportByteLength(preferred);
  return {
    reportId: preferred.reportId,
    bytes: preferredBytes >= 32 ? preferredBytes : LAMZU_AURORA_FEATURE_BYTES,
  };
}

/** Tiny utility features (e.g. 0x06 @ 7 B) — useful only as a last-resort soft-connect probe. */
function findTinyFeatureReport(device: HIDDevice): { reportId: number; bytes: number } | null {
  if (findAuroraFeatureReport(device)) return null;
  const reports = listFeatureReports(device).filter((report) => {
    const bytes = featureReportByteLength(report);
    return bytes > 0 && bytes < 32;
  });
  if (reports.length === 0) return null;
  if (!isLamzuVendor(device.vendorId) && !LAMZU_PRODUCTS.has(device.productId)) return null;
  const preferred = reports.find((report) => report.reportId === 0x06) ?? reports[0];
  return preferred
    ? { reportId: preferred.reportId, bytes: featureReportByteLength(preferred) }
    : null;
}

function describeFeatureReports(device: HIDDevice): string {
  const parts: string[] = [];
  for (const collection of walkCollections(device.collections)) {
    for (const report of collection.featureReports) {
      const bytes = featureReportByteLength(report);
      parts.push(
        `0x${report.reportId.toString(16)}@${collection.usagePage.toString(16)}:${collection.usage.toString(16)}/${bytes || "?"}B`,
      );
    }
  }
  return parts.join(", ") || "none";
}

function describeAllReports(device: HIDDevice): string {
  const parts: string[] = [];
  for (const collection of walkCollections(device.collections)) {
    const usage = `0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)}`;
    for (const report of collection.inputReports) {
      const bytes = featureReportByteLength(report);
      parts.push(`in:0x${report.reportId.toString(16)}@${usage}/${bytes || "?"}B`);
    }
    for (const report of collection.outputReports) {
      const bytes = featureReportByteLength(report);
      parts.push(`out:0x${report.reportId.toString(16)}@${usage}/${bytes || "?"}B`);
    }
    for (const report of collection.featureReports) {
      const bytes = featureReportByteLength(report);
      parts.push(`feat:0x${report.reportId.toString(16)}@${usage}/${bytes || "?"}B`);
    }
  }
  return parts.join(", ") || "none";
}

function hasClassicConfigReports(device: HIDDevice): boolean {
  return walkCollections(device.collections).some((collection) => {
    const hasInput = collection.inputReports.some((report) => report.reportId === LAMZU_REPORT_ID);
    const hasOutput = collection.outputReports.some((report) => report.reportId === LAMZU_REPORT_ID);
    return hasInput && hasOutput;
  });
}

/** Looser classic check used when ranking sibling interfaces. */
function hasClassicReport8(device: HIDDevice): boolean {
  return walkCollections(device.collections).some((collection) =>
    collection.inputReports.some((report) => report.reportId === LAMZU_REPORT_ID)
    || collection.outputReports.some((report) => report.reportId === LAMZU_REPORT_ID));
}

/**
 * Compx-style vendor I/O on usage 0xff02 (any report ID, e.g. 0x08 or 0x13)
 * with enough bytes for a 16-byte Compx packet. Maya dongle PID 0xfa09 exposes
 * in/out 0x13 @ 19 B here — not report 8.
 */
function hasClassicVendorIO(device: HIDDevice): boolean {
  for (const collection of walkCollections(device.collections)) {
    if (collection.usagePage !== 0xff02) continue;
    for (const output of collection.outputReports) {
      const outBytes = featureReportByteLength(output);
      if (outBytes > 0 && outBytes < LAMZU_PACKET_LENGTH) continue;
      const hasInput = collection.inputReports.some((input) => input.reportId === output.reportId);
      if (hasInput) return true;
    }
  }
  return false;
}

function outputReportByteLength(device: HIDDevice, reportId: number): number {
  for (const collection of walkCollections(device.collections)) {
    for (const report of collection.outputReports) {
      if (report.reportId === reportId) return featureReportByteLength(report);
    }
  }
  return 0;
}

export class LamzuHidClient {
  /** Slow enough that status polling does not fight settings writes on feature reports. */
  readonly pollIntervalMs = 8_000;

  private transport: LamzuTransport | null = null;
  private classicReportId = LAMZU_REPORT_ID;
  private auroraReportId = 0;
  private auroraReportBytes = LAMZU_AURORA_FEATURE_BYTES;
  private auroraHidIndex = 0;
  private auroraIsNewProtocol = true;
  private auroraProfile = 0;
  private auroraWriteReady = false;
  private auroraOpChain: Promise<void> = Promise.resolve();
  private blockedReason: string | null = null;
  private responseWaiter: {
    command: number;
    resolve: (bytes: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (!this.responseWaiter) return;
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    if (bytes[0] !== this.responseWaiter.command) return;
    // Remember which report ID carried the Compx response (may differ from 8).
    this.classicReportId = event.reportId || this.classicReportId;
    const waiter = this.responseWaiter;
    this.responseWaiter = null;
    waiter.resolve(bytes);
  };

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    if (!isLamzuVendor(device.vendorId)) return false;
    return hasClassicConfigReports(device)
      || hasClassicReport8(device)
      || hasClassicVendorIO(device)
      || findAuroraFeatureReport(device) !== null
      || findTinyFeatureReport(device) !== null
      || LAMZU_PRODUCTS.has(device.productId)
      || /maya|lamzu|2\.4g|receiver|dongle/i.test(device.productName ?? "");
  }

  /**
   * Prefer real Compx / Aurora control interfaces over tiny 0xff04 utility
   * features (7 B) that cannot carry DPI settings.
   */
  static supportScore(device: HIDDevice): number {
    if (!isLamzuVendor(device.vendorId)) return 0;
    if (hasClassicConfigReports(device)) return 100;
    if (hasClassicReport8(device)) return 90;
    if (hasClassicVendorIO(device)) return 85;
    if (findAuroraFeatureReport(device)) return 95;
    if (LAMZU_PRODUCTS.has(device.productId)) return 20;
    if (findTinyFeatureReport(device)) return 15;
    return 10;
  }

  /**
   * Among authorized Lamzu interfaces with the same VID/PID, pick the one that
   * can actually configure the mouse (report 8 / 0x13 / real Aurora), not the
   * 7-byte usage 0xff04 utility collection Windows often shows first.
   */
  static pickBestDevice(devices: readonly HIDDevice[], preferred?: HIDDevice): HIDDevice | null {
    const lamzu = devices.filter((device) => isLamzuVendor(device.vendorId));
    if (lamzu.length === 0) return null;

    // Prefer the user's pick when it is Maya X / a known product; otherwise
    // stay on the same VID+PID family as the preferred device.
    const productId = preferred?.productId
      ?? lamzu.find((device) => LAMZU_PRODUCTS.has(device.productId))?.productId
      ?? lamzu[0]?.productId;
    const vendorId = preferred?.vendorId
      ?? lamzu.find((device) => device.productId === productId)?.vendorId
      ?? lamzu[0]?.vendorId;
    const siblings = lamzu.filter((device) =>
      (productId === undefined || device.productId === productId)
      && (vendorId === undefined || device.vendorId === vendorId));
    const pool = siblings.length > 0 ? siblings : lamzu;
    return [...pool].sort((left, right) => LamzuHidClient.supportScore(right) - LamzuHidClient.supportScore(left))[0]
      ?? null;
  }

  static fromAuthorizedDevices(devices: readonly HIDDevice[], preferred?: HIDDevice): LamzuHidClient | null {
    const best = LamzuHidClient.pickBestDevice(devices, preferred);
    return best ? new LamzuHidClient(best) : null;
  }

  /** Collapse multi-interface Compx/Lamzu receivers to one sidebar row per VID/PID. */
  static mergeLogicalDevices(devices: readonly HIDDevice[]): HIDDevice[] {
    const bestByKey = new Map<string, HIDDevice>();
    for (const device of devices) {
      if (!isLamzuVendor(device.vendorId)) continue;
      const key = `${device.vendorId}:${device.productId}`;
      const current = bestByKey.get(key);
      if (!current || LamzuHidClient.supportScore(device) > LamzuHidClient.supportScore(current)) {
        bestByKey.set(key, device);
      }
    }
    return [...bestByKey.values()];
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
      if (/maya\s*x/i.test(product)) return /lamzu/i.test(product) ? product : `Lamzu ${product}`;
      if (/maya/i.test(product)) return /lamzu/i.test(product) ? product : `Lamzu ${product}`;
      if (/2\.4g|receiver|dongle/i.test(product)) {
        return this.device.vendorId === VENDOR_ID.lamzuNative ? "Lamzu Maya X" : "Lamzu Maya";
      }
      return /lamzu/i.test(product) ? product : `Lamzu ${product}`;
    }
    return this.device.vendorId === VENDOR_ID.lamzuNative ? "Lamzu Maya X" : "Lamzu Maya";
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
    if (this.transport === "classic") {
      await this.open();
      return;
    }
    if (this.transport === "aurora") {
      await this.open();
      if (!this.auroraWriteReady) {
        await this.probeAuroraLink();
        if (this.auroraWriteReady) {
          this.blockedReason = null;
        } else if (await this.probeClassicLink()) {
          this.transport = "classic";
          this.blockedReason = null;
        } else {
          this.blockedReason = this.classifyBlockedReason();
        }
      }
      return;
    }
    this.blockedReason = null;

    // 1) Descriptor advertises Compx report 8 or vendor I/O (e.g. 0x13 @ 0xff02).
    if (hasClassicConfigReports(this.device) || hasClassicReport8(this.device) || hasClassicVendorIO(this.device)) {
      this.transport = "classic";
      await this.open();
      // Still probe so classicReportId matches 0x08 vs 0x13 and checksums work.
      if (await this.probeClassicLink()) {
        this.blockedReason = null;
        return;
      }
      // Fall through — maybe Aurora works on this handle instead.
    }

    await this.device.open().catch(() => undefined);

    // 2) Blind Compx on any sizable output report.
    if (await this.probeClassicLink()) {
      this.transport = "classic";
      this.blockedReason = null;
      return;
    }

    // 3) Real Aurora feature-report path (64 B / reportCount 64 — Maya X, etc.).
    const aurora = findAuroraFeatureReport(this.device);
    if (aurora || this.device.vendorId === VENDOR_ID.lamzuNative) {
      this.transport = "aurora";
      if (this.device.vendorId === VENDOR_ID.lamzuNative) {
        this.auroraReportId = 0;
        this.auroraReportBytes = LAMZU_AURORA_FEATURE_BYTES;
      } else {
        this.auroraReportId = aurora!.reportId;
        this.auroraReportBytes = aurora!.bytes >= 32 ? aurora!.bytes : LAMZU_AURORA_FEATURE_BYTES;
      }
      this.auroraIsNewProtocol = true;
      await this.open();
      await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
      await this.probeAuroraLink();
      if (this.auroraWriteReady) {
        this.blockedReason = null;
        return;
      }
    }

    // 4) Soft-connect on tiny utility features only so the UI can explain the limit.
    const tiny = findTinyFeatureReport(this.device);
    if (tiny) {
      this.transport = "aurora";
      this.auroraReportId = tiny.reportId;
      this.auroraReportBytes = LAMZU_AURORA_FEATURE_BYTES;
      this.auroraIsNewProtocol = true;
      this.auroraWriteReady = false;
      this.blockedReason = "tiny-feature-report";
      return;
    }

    this.blockedReason = this.classifyBlockedReason();
    this.transport = "aurora";
    this.auroraWriteReady = false;
  }

  private classifyBlockedReason(): "tiny-feature-report" | "wrong-interface" {
    if (hasClassicVendorIO(this.device)) return "wrong-interface";
    return maxFeatureReportBytes(this.device) > 0 && maxFeatureReportBytes(this.device) < 32
      ? "tiny-feature-report"
      : "wrong-interface";
  }

  /**
   * Try Compx packets on report 8 and any output report large enough for a
   * 16-byte Compx body (pad to the descriptor width — e.g. 19 B on report 0x13).
   */
  private async probeClassicLink(): Promise<boolean> {
    if (!this.device.opened) {
      try {
        await this.device.open();
      } catch {
        return false;
      }
    }

    this.device.addEventListener("inputreport", this.onInputReport);

    const outputIds = walkCollections(this.device.collections).flatMap((collection) =>
      collection.outputReports
        .filter((report) => {
          const bytes = featureReportByteLength(report);
          return bytes === 0 || bytes >= LAMZU_PACKET_LENGTH;
        })
        .map((report) => report.reportId));

    // Prefer vendor 0xff02 report IDs (0x13 on some Maya dongles) before bare 0.
    const reportIds = [...new Set([
      ...outputIds,
      LAMZU_REPORT_ID,
      0,
    ])];

    for (const reportId of reportIds) {
      const packet = createLamzuPacket(LAMZU_COMMAND.readVersionId);
      finalizeLamzuPacket(packet, reportId || LAMZU_REPORT_ID);
      try {
        const response = await this.exchangeOnReport(reportId, packet, 280);
        if (response[1] === 0 || response[0] === LAMZU_COMMAND.readVersionId) {
          this.classicReportId = reportId || LAMZU_REPORT_ID;
          return true;
        }
      } catch {
        /* try next */
      }
    }

    this.device.removeEventListener("inputreport", this.onInputReport);
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /** Serialize Aurora feature-report traffic (status refresh vs settings writes). */
  private async withAuroraLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.auroraOpChain;
    let release!: () => void;
    this.auroraOpChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private auroraFramings(): Array<{ reportId: number; size: number }> {
    // Official Aurora (`dm`) always uses sendFeatureReport(0, Uint8Array(64)).
    // Maya X (VID 0x373e) is that path — do not probe 63/0x06 on it.
    if (this.device.vendorId === VENDOR_ID.lamzuNative) {
      return [{ reportId: 0, size: LAMZU_AURORA_FEATURE_BYTES }];
    }

    const descriptorMax = maxFeatureReportBytes(this.device);
    const featureIds = listFeatureReports(this.device).map((report) => report.reportId);
    const sizes = [...new Set([
      LAMZU_AURORA_FEATURE_BYTES,
      63,
      descriptorMax >= 32 ? descriptorMax : 0,
      this.auroraReportBytes >= 32 ? this.auroraReportBytes : 0,
      descriptorMax > 0 && descriptorMax < 32 ? descriptorMax : 0,
      7,
    ].filter((size) => size > 0))];
    const reportIds = [...new Set([
      0,
      this.auroraReportId || 0,
      0x06,
      ...featureIds,
    ])];
    const framings: Array<{ reportId: number; size: number }> = [];
    for (const reportId of reportIds) {
      for (const size of sizes) framings.push({ reportId, size });
    }
    return framings;
  }

  /**
   * Official driver always sends exactly `size` bytes and swallows write errors.
   * Never race-timeout these — abandoning an in-flight WebHID write leaves the
   * device busy and the next call throws "Failed to write the feature report".
   */
  private async sendAuroraFeature(
    reportId: number,
    size: number,
    request: Uint8Array,
  ): Promise<void> {
    const payload = new Uint8Array(size);
    payload.set(request.subarray(0, Math.min(request.length, size)));
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        if (!this.device.opened) await this.device.open();
        await this.device.sendFeatureReport(reportId, payload);
        return;
      } catch (error) {
        lastError = error;
        // Match lamzu.net: brief pause then retry; Chrome often fails when busy.
        await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS * (attempt + 1));
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(`sendFeatureReport(0x${reportId.toString(16)}, ${size} B) failed.`);
  }

  private async receiveAuroraFeature(reportId: number): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.device.opened) await this.device.open();
    const view = await this.device.receiveFeatureReport(reportId);
    // Copy only the DataView window — not view.buffer (may include unrelated bytes).
    let bytes = new Uint8Array(view.byteLength);
    for (let index = 0; index < view.byteLength; index += 1) bytes[index] = view.getUint8(index);

    // Some stacks prefix report ID 0 as a leading 0x00 before the Aurora payload.
    if (
      reportId === 0
      && bytes.length > 1
      && bytes[0] === 0
      && (bytes[1] === LAMZU_AURORA_STATUS_OK || bytes[1] === 2)
    ) {
      bytes = new Uint8Array(bytes.subarray(1));
    } else if (
      bytes.length > 1
      && bytes[0] === reportId
      && reportId !== 0
      && (bytes[1] === LAMZU_AURORA_STATUS_OK || bytes[1] === 2 || bytes[1]! > 0)
    ) {
      bytes = new Uint8Array(bytes.subarray(1));
    }
    return bytes;
  }

  private async withHidTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer = 0;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  private auroraStatus(response: Uint8Array): number {
    return response[auroraStatusIndex(this.auroraHidIndex)] ?? 0;
  }

  private responseLooksAlive(response: Uint8Array): boolean {
    if (response.length === 0) return false;
    const status = this.auroraStatus(response);
    if (status === LAMZU_AURORA_STATUS_OK || status === 2) return true;
    if (response[6] === 129 || response[5] === 129) return true;
    if (parseAuroraBattery(response) !== null) return true;
    return false;
  }

  /** Only full-size Aurora buffers can carry DPI stage payloads. */
  private framingCanCarrySettings(size: number): boolean {
    return size >= 32;
  }

  /**
   * Bounded cousin of Lamzu Aurora `retrySetGet`.
   * Status 0 means "not ready yet" — poll briefly before giving up.
   * Keep polls short so a bad framing cannot freeze reconnect for minutes.
   */
  private async retryAuroraSetGet(
    reportId: number,
    request: Uint8Array,
    size: number,
    initial: Uint8Array<ArrayBuffer>,
    options?: { maxAttempts?: number; maxPolls?: number },
  ): Promise<Uint8Array<ArrayBuffer>> {
    const maxAttempts = options?.maxAttempts ?? 3;
    const maxPolls = options?.maxPolls ?? 8;
    let response: Uint8Array<ArrayBuffer> = initial;
    this.noteAuroraHidIndex(response);
    if (this.responseLooksAlive(response)) return response;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const status = this.auroraStatus(response);
      if (this.responseLooksAlive(response)) return response;

      if (status > LAMZU_AURORA_STATUS_OK) {
        await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
        try {
          await this.sendAuroraFeature(reportId, size, request);
        } catch {
          /* keep polling / retrying like the official driver */
        }
        await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
        try {
          response = await this.receiveAuroraFeature(reportId);
        } catch {
          response = new Uint8Array(0);
        }
        this.noteAuroraHidIndex(response);
        if (this.responseLooksAlive(response)) return response;
        continue;
      }

      // status < 0xA1 (including 0): poll reads only, then one resend.
      for (let poll = 0; poll < maxPolls; poll += 1) {
        await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
        try {
          response = await this.receiveAuroraFeature(reportId);
        } catch {
          response = new Uint8Array(0);
        }
        this.noteAuroraHidIndex(response);
        if (this.responseLooksAlive(response)) return response;
      }
      if (this.responseLooksAlive(response)) return response;

      await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
      try {
        await this.sendAuroraFeature(reportId, size, request);
      } catch {
        /* ignore */
      }
      await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
      try {
        response = await this.receiveAuroraFeature(reportId);
      } catch {
        response = new Uint8Array(0);
      }
      this.noteAuroraHidIndex(response);
      if (this.responseLooksAlive(response)) return response;
    }
    return response;
  }

  /**
   * Fast framing discovery. Prefer 63/64-byte Aurora buffers — a 7 B Windows
   * item sum cannot carry DPI stage writes even if short probes look alive.
   */
  private async probeAuroraLink(): Promise<void> {
    const firmware = new Uint8Array(LAMZU_AURORA_FEATURE_BYTES);
    firmware[2] = 2;
    firmware[3] = 16;
    firmware[5] = 129;

    const probes: Uint8Array[] = [
      firmware,
      createAuroraCommand(LAMZU_AURORA_CMD.getBattery, { isNewProtocol: false }),
      createAuroraCommand(LAMZU_AURORA_CMD.getPolling, {
        profile: this.auroraProfile,
        isNewProtocol: true,
      }),
    ];

    const deadline = Date.now() + 1_800;
    let sawTinyAlive = false;

    for (const probe of probes) {
      for (const { reportId, size } of this.auroraFramings()) {
        if (Date.now() > deadline) break;
        try {
          await this.sendAuroraFeature(reportId, size, probe);
          await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
          let response = await this.receiveAuroraFeature(reportId);
          if (!this.responseLooksAlive(response)) {
            response = await this.retryAuroraSetGet(reportId, probe, size, response, {
              maxAttempts: 1,
              maxPolls: 2,
            });
          }
          if (!this.responseLooksAlive(response)) continue;

          if (!this.framingCanCarrySettings(size)) {
            sawTinyAlive = true;
            continue;
          }

          this.auroraReportId = reportId;
          this.auroraReportBytes = size;
          this.auroraWriteReady = true;
          this.blockedReason = null;
          this.noteAuroraHidIndex(response);
          if (response[6] === 129) this.auroraHidIndex = 0;
          else if (response[5] === 129) this.auroraHidIndex = 1;
          return;
        } catch {
          /* try next framing */
        }

        if (reportId !== 0 && size >= 32 && size + 1 <= 256) {
          try {
            const framed = new Uint8Array(size + 1);
            framed[0] = reportId;
            framed.set(probe.subarray(0, size), 1);
            await this.sendAuroraFeature(0, size + 1, framed);
            await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
            const response = await this.receiveAuroraFeature(0);
            if (!this.responseLooksAlive(response)) continue;
            this.auroraReportId = 0;
            this.auroraReportBytes = size + 1;
            this.auroraWriteReady = true;
            this.blockedReason = null;
            this.noteAuroraHidIndex(response);
            return;
          } catch {
            /* continue */
          }
        }
      }
    }

    this.auroraWriteReady = false;
    if (sawTinyAlive) {
      // Remember that the tiny report answers, but settings need a larger buffer.
      this.auroraReportBytes = Math.max(this.auroraReportBytes, 7);
      this.blockedReason = "tiny-feature-report";
    }
  }

  private noteAuroraHidIndex(response: Uint8Array): void {
    if ((response[0] ?? 0) === LAMZU_AURORA_STATUS_OK) this.auroraHidIndex = 1;
    else if ((response[1] ?? 0) === LAMZU_AURORA_STATUS_OK) this.auroraHidIndex = 0;
    else if ((response[0] ?? 0) >= 160) this.auroraHidIndex = 1;
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
      protocolLabel: `Compx report 0x${this.classicReportId.toString(16)}`,
    });
  }

  private async readAuroraStatus(): Promise<MouseStatus> {
    // Soft-connect: never block the UI if Aurora framing is not ready yet.
    if (!this.auroraWriteReady) {
      const allReports = describeAllReports(this.device);
      const featureReports = describeFeatureReports(this.device);
      const tiny = this.blockedReason === "tiny-feature-report"
        || (/feat:0x6@[^/]+\/7B/.test(allReports) && !hasClassicVendorIO(this.device));
      const protocolLabel = tiny
        ? `Feature report too small for settings (${featureReports}) · reports: ${allReports}`
        : `Settings link not ready (${featureReports || "no feature reports"}; ${allReports})`;
      return this.buildStatus({
        dpi: 800,
        pollingRateHz: 1000,
        lod: "Medium",
        batteryPercent: null,
        batteryVoltageMv: null,
        activeProfile: this.auroraProfile + 1,
        debounceMs: null,
        motionSync: false,
        sleepTimeout: null,
        angleSnapping: false,
        rippleControl: false,
        performanceMode: null,
        firmware: ["Firmware version unavailable"],
        protocolLabel,
        settingsReady: false,
        blockedHint: tiny
          ? "This Compx “2.4G Wireless Receiver” only exposes a 7-byte utility feature — it cannot configure Maya X. Forget this site under chrome://settings/content/hidDevices, then Add device again and pick “LAMZU MAYA X” or “Maya X 8K Dongle” (VID 0x373e). Keep the mouse awake; wired USB also works for first-time setup."
          : "Lamzu settings link is not ready. Keep the mouse awake, replug the dongle, then reconnect. For Maya X, select “LAMZU MAYA X” / the 8K dongle — not a generic Compx 2.4G receiver.",
      });
    }

    // Never fail the whole connect on a single Aurora getter — the sidebar
    // otherwise stays on "Available" with a grey idle indicator.
    const firmware = await this.readAuroraFirmware().catch(() => "Firmware version unavailable");
    const battery = await this.readAuroraBattery().catch(() => null);
    const pollingRateHz = await this.getPollingRate().catch(() => 1000);
    const lodRaw = await this.auroraGetValue(LAMZU_AURORA_CMD.getLod).catch(() => 1);
    const motionSync = (await this.auroraGetValue(LAMZU_AURORA_CMD.getMotionSync).catch(() => 0)) === 1;
    const angleSnapping = (await this.auroraGetValue(LAMZU_AURORA_CMD.getAngleSnap).catch(() => 0)) === 1;
    const rippleControl = (await this.auroraGetValue(LAMZU_AURORA_CMD.getRipple).catch(() => 0)) === 1;
    const debounceMs = await this.auroraGetValue(LAMZU_AURORA_CMD.getDebounce).catch(() => null);
    const dpi = await this.readAuroraDpi().catch(() => 800);

    return this.buildStatus({
      dpi,
      pollingRateHz,
      lod: decodeLamzuLod(lodRaw) ?? "Medium",
      batteryPercent: battery?.percent ?? null,
      batteryVoltageMv: null,
      batteryState: battery?.charging ? "Charging" : "Discharging",
      activeProfile: this.auroraProfile + 1,
      debounceMs,
      motionSync,
      sleepTimeout: null,
      angleSnapping,
      rippleControl,
      performanceMode: null,
      firmware: [firmware],
      protocolLabel: `Aurora feature report 0x${this.auroraReportId.toString(16)} (${this.auroraReportBytes} B)`,
      settingsReady: true,
    });
  }

  private buildStatus(input: {
    dpi: number;
    pollingRateHz: number;
    lod: MouseStatus["liftOffDistance"];
    batteryPercent: number | null;
    batteryVoltageMv: number | null;
    batteryState?: MouseStatus["batteryState"];
    activeProfile: number | null;
    debounceMs: number | null;
    motionSync: boolean | null;
    sleepTimeout: number | null;
    angleSnapping: boolean | null;
    rippleControl: boolean | null;
    performanceMode: boolean | null;
    firmware: string[];
    protocolLabel: string;
    settingsReady?: boolean;
    blockedHint?: string;
  }): MouseStatus {
    const maxHz = this.maxPollingRateHz();
    const supportedPollingRates = [125, 250, 500, 1000, 2000, 4000, 8000].filter((hz) => hz <= maxHz);
    return {
      brand: "Lamzu",
      name: this.displayName(),
      ui: {
        family: "lamzu",
        settingsReady: input.settingsReady ?? true,
        hideLodLow: true,
        hideUnsupportedPollingRates: true,
        forceShowBattery: this.connectionType() === "Wireless",
        hideProcessingCard: false,
        pollingNote: input.blockedHint
          ?? (maxHz >= 8000
            ? "Maya receivers support up to 8,000 Hz when the paired dongle allows it."
            : maxHz >= 4000
              ? "This Lamzu receiver supports up to 4,000 Hz."
              : "This Lamzu connection supports up to 1,000 Hz."),
        defaultDisplayName: this.displayName(),
      },
      batteryPercent: input.batteryPercent,
      batteryVoltageMv: input.batteryVoltageMv,
      batteryState: input.batteryState ?? "Discharging",
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
    // Official getDPIStageInfo waits ~100ms before reading the stage table.
    await this.sleep(100);
    const response = await this.auroraExchange(request);
    const status = this.auroraStatus(response);
    const cmdEcho = response[6 - this.auroraHidIndex] ?? 0;
    if (status !== LAMZU_AURORA_STATUS_OK || cmdEcho !== 129) {
      return 800;
    }
    const countIndex = 8 - this.auroraHidIndex;
    const count = response[countIndex] ?? 0;
    if (count <= 0 || stage < 0 || stage >= count) return 800;
    const base = 9 - this.auroraHidIndex + stage * 4;
    const dpi = ((response[base] ?? 0) << 8) | (response[base + 1] ?? 0);
    // Uninitialized stage slots read as 0 — treat as unset rather than "0 DPI".
    return dpi > 0 ? dpi : 800;
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
    await this.sleep(100);
    const current = await this.auroraExchange(readRequest);
    const countIndex = 8 - this.auroraHidIndex;
    const count = current[countIndex] ?? 0;
    if (count <= 0) throw new Error("The mouse did not report any DPI stages.");

    const stageCount = Math.max(count, 6);
    const write = new Uint8Array(LAMZU_AURORA_FEATURE_BYTES);
    write[2] = LAMZU_AURORA_CMD.setDpiStages[0];
    write[3] = LAMZU_AURORA_CMD.setDpiStages[1];
    write[4] = LAMZU_AURORA_CMD.setDpiStages[2];
    write[5] = LAMZU_AURORA_CMD.setDpiStages[3];
    write[6] = this.auroraProfile;
    write[7] = stageCount;
    // Official always packs stage bytes at offset 8 (not hidIndex-shifted).
    for (let index = 0; index < stageCount * 4; index += 1) {
      write[8 + index] = current[9 - this.auroraHidIndex + index] ?? 0;
    }
    // Fill empty slots with defaults like lamzu.net setDPIStageNum.
    const defaults = [400, 800, 1600, 3200, 6400, dpi];
    for (let slot = 0; slot < stageCount; slot += 1) {
      const offset = 8 + slot * 4;
      const existing = ((write[offset] ?? 0) << 8) | (write[offset + 1] ?? 0);
      if (existing === 0) {
        const fill = defaults[Math.min(slot, defaults.length - 1)] ?? 800;
        write[offset] = (fill >> 8) & 0xff;
        write[offset + 1] = fill & 0xff;
        write[offset + 2] = (fill >> 8) & 0xff;
        write[offset + 3] = fill & 0xff;
      }
    }
    const activeStage = Math.min(Math.max(stage, 0), stageCount - 1);
    const offset = 8 + activeStage * 4;
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
    const response = await this.auroraExchange(request, { allowEmpty: true });
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

  private async readAuroraBattery(): Promise<{ charging: boolean; percent: number } | null> {
    const request = createAuroraCommand(LAMZU_AURORA_CMD.getBattery, { isNewProtocol: false });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await this.sleep(300);
      const response = await this.auroraExchange(request, { allowEmpty: true });
      const parsed = parseAuroraBattery(response);
      if (parsed && (parsed.percent > 0 || parsed.charging || this.auroraStatus(response) === LAMZU_AURORA_STATUS_OK)) {
        return parsed;
      }
    }
    return null;
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
    const tryProtocol = async (isNewProtocol: boolean): Promise<number> => {
      const request = createAuroraCommand(cmd, {
        profile: this.auroraProfile,
        isNewProtocol,
      });
      const response = await this.auroraExchange(request);
      return response[auroraValueIndex(this.auroraHidIndex, isNewProtocol)] ?? 0;
    };

    try {
      return await tryProtocol(this.auroraIsNewProtocol);
    } catch {
      const fallback = !this.auroraIsNewProtocol;
      const value = await tryProtocol(fallback);
      this.auroraIsNewProtocol = fallback;
      return value;
    }
  }

  private async auroraExchange(
    request: Uint8Array<ArrayBuffer>,
    options?: { allowEmpty?: boolean },
  ): Promise<Uint8Array> {
    return await this.withAuroraLock(async () => {
      await this.open();
      if (!this.auroraWriteReady || !this.framingCanCarrySettings(this.auroraReportBytes)) {
        await this.probeAuroraLink();
      }
      if (!this.auroraWriteReady || !this.framingCanCarrySettings(this.auroraReportBytes)) {
        throw new Error(
          this.blockedReason === "tiny-feature-report"
            ? "This Compx 2.4G receiver only exposes a 7-byte utility feature and cannot carry DPI/polling. "
              + "Forget this site under chrome://settings/content/hidDevices, then reconnect and pick “LAMZU MAYA X” / the Maya X 8K dongle."
            : "Lamzu settings link is not ready. Keep the mouse awake, replug the dongle, then reconnect.",
        );
      }

      // Once framing is known, stick to it. Falling through to 63 B / report 0x06
      // throws Chrome’s “Failed to write the feature report” on Maya X.
      const attempts = this.device.vendorId === VENDOR_ID.lamzuNative
        || (this.auroraReportId === 0 && this.auroraReportBytes === LAMZU_AURORA_FEATURE_BYTES)
        ? [{ reportId: this.auroraReportId, size: this.auroraReportBytes }]
        : [
          { reportId: this.auroraReportId, size: this.auroraReportBytes },
          { reportId: 0, size: 64 },
          { reportId: 0x06, size: 64 },
        ];

      const seen = new Set<string>();
      let lastError: unknown = null;

      for (const { reportId, size } of attempts) {
        if (!this.framingCanCarrySettings(size)) continue;
        const key = `${reportId}:${size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          // Official setReport swallows write failures then still receives.
          try {
            await this.sendAuroraFeature(reportId, size, request);
          } catch (error) {
            lastError = error;
            // Soft-fail write (lamzu.net style) and still attempt receive.
          }
          await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
          let response = await this.receiveAuroraFeature(reportId);
          response = await this.retryAuroraSetGet(reportId, request, size, response, {
            maxAttempts: 3,
            maxPolls: 12,
          });
          this.noteAuroraHidIndex(response);
          const status = this.auroraStatus(response);
          if (status === LAMZU_AURORA_STATUS_OK || status === 2 || this.responseLooksAlive(response)) {
            this.auroraReportId = reportId;
            this.auroraReportBytes = size;
            this.auroraWriteReady = true;
            return response;
          }
          if (options?.allowEmpty && response.some((value) => value !== 0)) {
            this.auroraReportId = reportId;
            this.auroraReportBytes = size;
            return response;
          }
          lastError = new Error(
            `Lamzu Aurora command failed (report 0x${reportId.toString(16)}, ${size} B, status ${status || "none"}).`,
          );
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError instanceof Error) {
        const message = lastError.message;
        if (/Failed to write the feature report/i.test(message)) {
          throw new Error(
            "Chrome could not write the Lamzu Aurora feature report (device busy or wrong buffer). "
              + "Keep the mouse awake, wait a second, and try again. If it keeps failing, reconnect the dongle.",
          );
        }
        throw lastError;
      }
      throw new Error(
        `Lamzu Aurora command failed (report 0x${this.auroraReportId.toString(16)}, ${this.auroraReportBytes} B, status none).`,
      );
    });
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
      finalizeLamzuPacket(packet, this.classicReportId);
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
      finalizeLamzuPacket(packet, this.classicReportId);
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
    finalizeLamzuPacket(packet, this.classicReportId);
    return await this.exchange(packet);
  }

  private async exchange(packet: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    return await this.exchangeOnReport(this.classicReportId, packet, 1200);
  }

  private async exchangeOnReport(
    reportId: number,
    packet: Uint8Array<ArrayBuffer>,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    if (this.responseWaiter) throw new Error("Another Lamzu request is already in progress.");
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener("inputreport", this.onInputReport);
    const command = packet[0];
    let timeout = 0;
    let rejectResponse: ((reason: Error) => void) | null = null;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      rejectResponse = reject;
      timeout = window.setTimeout(() => {
        this.responseWaiter = null;
        reject(new Error(`The Lamzu mouse did not answer command 0x${command.toString(16).padStart(2, "0")}.`));
      }, timeoutMs);
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
      const reportBytes = outputReportByteLength(this.device, reportId);
      const payload = reportBytes > packet.length
        ? (() => {
          const padded = new Uint8Array(reportBytes);
          padded.set(packet);
          return padded;
        })()
        : packet;
      await this.withHidTimeout(
        this.device.sendReport(reportId, payload),
        800,
        `sendReport(0x${reportId.toString(16)}, ${payload.length} B)`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      (rejectResponse as ((reason: Error) => void) | null)?.(
        new Error(`Chrome could not write Lamzu report 0x${reportId.toString(16)}. ${detail}`),
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
