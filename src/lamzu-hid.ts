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
  LAMZU_REPORT_ID,
  lamzuDataChecksum,
  parseAuroraBattery,
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
 * `0x06 @ 7 B` on usage 0xff04 are NOT the Aurora command channel — Lamzu's own
 * Compx driver ignores them and uses report ID 8 instead.
 */
function isAuroraSizedFeatureReport(report: HIDReportInfo): boolean {
  if (report.items?.some((item) => item.reportCount === 64)) return true;
  const bytes = featureReportByteLength(report);
  // 0 = Chrome omitted item sizes; still treat report ID 0x06 as a candidate.
  if (bytes === 0 && report.reportId === 0x06) return true;
  return bytes >= 32;
}

/**
 * Aurora receivers expose a vendor feature report large enough for 64-byte commands.
 */
function findAuroraFeatureReport(device: HIDDevice): { reportId: number; bytes: number } | null {
  const reports: HIDReportInfo[] = [];
  for (const collection of walkCollections(device.collections)) {
    reports.push(...collection.featureReports);
  }
  const candidates = reports.filter(isAuroraSizedFeatureReport);
  if (candidates.length === 0) return null;

  const preferred = candidates.find((report) => report.reportId === 0x06)
    ?? candidates.find((report) => {
      const bytes = featureReportByteLength(report);
      return bytes >= 64 || report.items?.some((item) => item.reportCount === 64);
    })
    ?? candidates[0];

  if (!preferred) return null;
  const preferredBytes = featureReportByteLength(preferred);
  // Always plan for Aurora's 64-byte command buffer; Windows often wants 63.
  return {
    reportId: preferred.reportId,
    bytes: preferredBytes >= 32 ? preferredBytes : LAMZU_AURORA_FEATURE_BYTES,
  };
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

function describeLamzuCollections(device: HIDDevice): string {
  return device.collections.map((collection) => {
    const inputs = collection.inputReports.map((report) => `in:0x${report.reportId.toString(16)}`).join(",") || "in:none";
    const outputs = collection.outputReports.map((report) => `out:0x${report.reportId.toString(16)}`).join(",") || "out:none";
    const features = collection.featureReports.map((report) => {
      const bytes = featureReportByteLength(report);
      return `feat:0x${report.reportId.toString(16)}/${bytes || "?"}B`;
    }).join(",") || "feat:none";
    return `usage 0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)} [${inputs}; ${outputs}; ${features}]`;
  }).join(" | ") || "no collections";
}

export class LamzuHidClient {
  /** Slow enough that status polling does not fight settings writes on feature reports. */
  readonly pollIntervalMs = 8_000;

  private transport: LamzuTransport | null = null;
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
      && (hasClassicConfigReports(device)
        || hasClassicReport8(device)
        || findAuroraFeatureReport(device) !== null
        || LAMZU_PRODUCTS.has(device.productId));
  }

  /** Prefer Compx report-8 interfaces over tiny vendor feature interfaces. */
  static supportScore(device: HIDDevice): number {
    if (device.vendorId !== VENDOR_ID.lamzu) return 0;
    if (hasClassicConfigReports(device)) return 100;
    if (hasClassicReport8(device)) return 90;
    if (findAuroraFeatureReport(device)) return 70;
    if (LAMZU_PRODUCTS.has(device.productId)) return 20;
    return 10;
  }

  /**
   * Among authorized Lamzu interfaces with the same VID/PID, pick the one that
   * can actually configure the mouse (report 8 / real Aurora), not the 7-byte
   * usage 0xff04 utility collection Windows often shows first.
   */
  static pickBestDevice(devices: readonly HIDDevice[], preferred?: HIDDevice): HIDDevice | null {
    const lamzu = devices.filter((device) => device.vendorId === VENDOR_ID.lamzu);
    if (lamzu.length === 0) return null;

    const productId = preferred?.productId
      ?? lamzu.find((device) => LAMZU_PRODUCTS.has(device.productId))?.productId
      ?? lamzu[0]?.productId;
    const siblings = productId === undefined
      ? lamzu
      : lamzu.filter((device) => device.productId === productId);
    const pool = siblings.length > 0 ? siblings : lamzu;
    return [...pool].sort((left, right) => LamzuHidClient.supportScore(right) - LamzuHidClient.supportScore(left))[0]
      ?? null;
  }

  static fromAuthorizedDevices(devices: readonly HIDDevice[], preferred?: HIDDevice): LamzuHidClient | null {
    const best = LamzuHidClient.pickBestDevice(devices, preferred);
    return best ? new LamzuHidClient(best) : null;
  }

  /** Collapse multi-interface Compx receivers to one sidebar row per VID/PID. */
  static mergeLogicalDevices(devices: readonly HIDDevice[]): HIDDevice[] {
    const bestByKey = new Map<string, HIDDevice>();
    for (const device of devices) {
      if (device.vendorId !== VENDOR_ID.lamzu) continue;
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
    this.blockedReason = null;

    // Official Lamzu Compx (VID 0x3554) configures via report ID 8 — not the
    // tiny usage 0xff04 feature report Windows exposes on some dongles.
    if (hasClassicConfigReports(this.device) || hasClassicReport8(this.device)) {
      this.transport = "classic";
      await this.open();
      return;
    }

    const aurora = findAuroraFeatureReport(this.device);
    if (aurora) {
      this.transport = "aurora";
      this.auroraReportId = aurora.reportId;
      this.auroraReportBytes = aurora.bytes >= 63 ? aurora.bytes : LAMZU_AURORA_FEATURE_BYTES;
      this.auroraIsNewProtocol = true;
      await this.open();
      await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
      await this.probeAuroraLink();
      return;
    }

    this.blockedReason = "wrong-interface";
    this.transport = "aurora";
    this.auroraWriteReady = false;
    await this.open().catch(() => undefined);
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
    // Never probe with the misleading 7-byte Windows size from usage 0xff04.
    const sizes = [...new Set([
      63,
      LAMZU_AURORA_FEATURE_BYTES,
      this.auroraReportBytes >= 32 ? this.auroraReportBytes : 0,
      maxFeatureReportBytes(this.device) >= 32 ? maxFeatureReportBytes(this.device) : 0,
    ].filter((size) => size >= 32))];
    const reportIds = [...new Set([
      this.auroraReportId || 0x06,
      0x06,
      0,
    ])];
    const framings: Array<{ reportId: number; size: number }> = [];
    for (const reportId of reportIds) {
      for (const size of sizes) framings.push({ reportId, size });
    }
    return framings;
  }

  private async sendAuroraFeature(reportId: number, size: number, request: Uint8Array): Promise<void> {
    const payload = new Uint8Array(size);
    payload.set(request.subarray(0, Math.min(request.length, size)));
    await this.withHidTimeout(
      this.device.sendFeatureReport(reportId, payload),
      800,
      `sendFeatureReport(0x${reportId.toString(16)}, ${size} B)`,
    );
  }

  private async receiveAuroraFeature(reportId: number): Promise<Uint8Array<ArrayBuffer>> {
    const view = await this.withHidTimeout(
      this.device.receiveFeatureReport(reportId),
      800,
      `receiveFeatureReport(0x${reportId.toString(16)})`,
    );
    const bytes = new Uint8Array(view.byteLength);
    for (let index = 0; index < view.byteLength; index += 1) bytes[index] = view.getUint8(index);
    // Some Windows stacks prefix the report ID; strip it when the payload still looks Aurora-shaped.
    if (
      bytes.length > 1
      && bytes[0] === reportId
      && reportId !== 0
      && (bytes[1] === LAMZU_AURORA_STATUS_OK || bytes[1] === 2 || bytes[1]! > 0)
    ) {
      return new Uint8Array(bytes.subarray(1));
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
    const status = this.auroraStatus(response);
    return status === LAMZU_AURORA_STATUS_OK
      || status === 2
      || response[6] === 129
      || response[5] === 129
      || parseAuroraBattery(response) !== null;
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
   * Fast framing discovery. Do NOT run the full retry loop here — a failed
   * framing often returns status 0 forever and would block Reconnecting… for minutes.
   */
  private async probeAuroraLink(): Promise<void> {
    const probes: Uint8Array[] = [
      (() => {
        const probe = new Uint8Array(LAMZU_AURORA_FEATURE_BYTES);
        probe[2] = 2;
        probe[3] = 16;
        probe[5] = 129;
        return probe;
      })(),
      createAuroraCommand(LAMZU_AURORA_CMD.getBattery, { isNewProtocol: false }),
      createAuroraCommand(LAMZU_AURORA_CMD.getPolling, {
        profile: this.auroraProfile,
        isNewProtocol: true,
      }),
    ];

    const deadline = Date.now() + 2_500;

    for (const probe of probes) {
      for (const { reportId, size } of this.auroraFramings()) {
        if (Date.now() > deadline) {
          this.auroraWriteReady = false;
          return;
        }
        try {
          await this.sendAuroraFeature(reportId, size, probe);
          await this.sleep(40);
          let response = await this.receiveAuroraFeature(reportId);
          // One short retry burst only — enough for a sleepy wireless dongle.
          if (!this.responseLooksAlive(response)) {
            response = await this.retryAuroraSetGet(reportId, probe, size, response, {
              maxAttempts: 1,
              maxPolls: 4,
            });
          }
          if (!this.responseLooksAlive(response)) continue;

          this.auroraReportId = reportId;
          this.auroraReportBytes = size;
          this.auroraWriteReady = true;
          this.noteAuroraHidIndex(response);
          if (response[6] === 129) this.auroraHidIndex = 0;
          else if (response[5] === 129) this.auroraHidIndex = 1;
          return;
        } catch {
          /* try next framing */
        }
      }
    }

    this.auroraWriteReady = false;
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
      protocolLabel: "Compx report 8",
    });
  }

  private async readAuroraStatus(): Promise<MouseStatus> {
    // Soft-connect: never block the UI if Aurora framing is not ready yet.
    if (!this.auroraWriteReady) {
      const wrongInterface = this.blockedReason === "wrong-interface"
        || describeFeatureReports(this.device).includes("/7B");
      const protocolLabel = wrongInterface
        ? `Wrong HID interface (${describeFeatureReports(this.device) || describeLamzuCollections(this.device)})`
        : `Aurora writes blocked (reports: ${describeFeatureReports(this.device)}; trying ${this.auroraReportBytes} B)`;
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
        blockedHint: wrongInterface
          ? "This is not the Compx config interface. Click Add device and choose the Lamzu/Compx interface that exposes report ID 8 (often listed as a second “2.4G Wireless Receiver” / vendor device). Avoid the usage 0xff04 utility interface."
          : "Chrome could not complete Lamzu feature-report writes on this interface. Replug the receiver, then use Add device and pick the Compx report-8 control interface.",
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
      if (!this.auroraWriteReady) await this.probeAuroraLink();
      if (!this.auroraWriteReady) {
        throw new Error(
          this.blockedReason === "wrong-interface"
            ? "This Lamzu HID interface cannot configure the mouse. "
              + "Click Add device and choose the Compx/vendor interface with report ID 8 "
              + "(not the usage 0xff04 utility interface)."
            : "Chrome blocked Lamzu feature-report writes. "
              + "Replug the receiver, then use Add device and pick the Compx report-8 control interface.",
        );
      }

      const reportId = this.auroraReportId;
      const size = this.auroraReportBytes;
      try {
        await this.sendAuroraFeature(reportId, size, request);
        await this.sleep(LAMZU_AURORA_COMMON_DELAY_MS);
        let response = await this.receiveAuroraFeature(reportId);
        response = await this.retryAuroraSetGet(reportId, request, size, response, {
          maxAttempts: 3,
          maxPolls: 8,
        });
        this.noteAuroraHidIndex(response);
        const status = this.auroraStatus(response);
        if (status === LAMZU_AURORA_STATUS_OK || status === 2 || this.responseLooksAlive(response)) {
          return response;
        }
        if (options?.allowEmpty && response.some((value) => value !== 0)) return response;
        throw new Error(
          `Lamzu Aurora command failed (report 0x${reportId.toString(16)}, ${size} B, status ${status || "none"}).`,
        );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Lamzu Aurora command failed")) throw error;
        const detail = error instanceof Error ? ` ${error.message}` : "";
        throw new Error(
          `Lamzu Aurora command failed (report 0x${reportId.toString(16)}, ${size} B, status none).${detail}`,
        );
      }
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
