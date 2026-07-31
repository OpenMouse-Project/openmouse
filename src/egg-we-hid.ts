import type { MouseStatus } from "./mouse-types";

/**
 * Endgame Gear WE-series wireless mice (OP1we, shared dongle, etc.).
 *
 * Same structural style as egg-op1-hid.ts, but a different CompX/WE command
 * set — not the wired OP1 8K 1041-byte config blob.
 *
 * Transport notes (Windows WebHID is strict):
 * - Verified battery protocol uses feature report 0xa1 for Set + Get.
 * - sendFeatureReport data must match the HID descriptor byte length exactly
 *   (report id is separate; do not include it in the buffer).
 * - Native HidD_SetFeature buffers include report id as byte 0; WebHID
 *   responses do not, so battery % is at index 15 (not 16).
 */

const EGG_VENDOR_ID = 0x3367;

const KNOWN_PRODUCTS = new Map<number, { name: string; wired: boolean }>([
  [0x1972, { name: "Endgame Gear OP1we", wired: true }],
  [0x1970, { name: "Endgame Gear wireless receiver", wired: false }],
  [0x1968, { name: "Endgame Gear XM2we", wired: true }],
  [0x1982, { name: "Endgame Gear XM2w v2", wired: true }],
]);

/** Wired OP1 8K / XM2 8K PIDs — owned by egg-op1-hid, never claim here. */
const EGG_8K_PRODUCT_IDS = new Set([0x1964, 0x1966, 0x1976, 0x1978]);

/** Prefer the verified WE report; fall back if a firmware only exposes 0xa0. */
const PREFERRED_REPORT_IDS = [0xa1, 0xa0] as const;

const COMMAND = {
  battery: 0xb4,
  status: 0xb0,
  dpi: 0xb1,
  polling: 0xb2,
  lod: 0xb3,
  debounce: 0xb5,
  firmware: 0xb6,
} as const;

const POLLING_RATES = [125, 250, 500, 1000] as const;
const DEFAULT_DPI = 800;
const DEFAULT_POLLING = 1000;
const DEFAULT_DEBOUNCE = 3;

interface FeatureReportTarget {
  reportId: number;
  /** Payload length for sendFeatureReport (excludes report id). */
  payloadLength: number;
}

export class EggWeHidClient {
  private commandQueue: Promise<unknown> = Promise.resolve();
  private reportTarget: FeatureReportTarget | null = null;
  /** True when receiveFeatureReport includes the report id as byte 0. */
  private responseIncludesReportId: boolean | null = null;

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== EGG_VENDOR_ID) return false;
    if (EGG_8K_PRODUCT_IDS.has(device.productId)) return false;
    return this.hasVendorConfigInterface(device);
  }

  static supportScore(device: HIDDevice): number {
    if (!this.isSupported(device)) return 0;
    let score = 1;
    if (this.findFeatureReport(device, 0xa1)) score += 4;
    if (this.findFeatureReport(device, 0xa0)) score += 2;
    if (this.collectionTreeHasVendorUsage(device.collections)) score += 1;
    return score;
  }

  private static hasVendorConfigInterface(device: HIDDevice): boolean {
    if (this.findFeatureReport(device, 0xa1) || this.findFeatureReport(device, 0xa0)) return true;
    if (this.collectionTreeHasVendorUsage(device.collections)) return true;
    return this.listFeatureReports(device).length > 0;
  }

  private static listFeatureReports(device: HIDDevice): FeatureReportTarget[] {
    const found: FeatureReportTarget[] = [];
    const visit = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        for (const report of collection.featureReports) {
          const payloadLength = this.featureReportPayloadLength(report);
          if (payloadLength > 0) {
            found.push({ reportId: report.reportId, payloadLength });
          }
        }
        visit(collection.children);
      }
    };
    visit(device.collections);
    return found;
  }

  private static findFeatureReport(device: HIDDevice, reportId: number): FeatureReportTarget | null {
    return this.listFeatureReports(device).find((report) => report.reportId === reportId) ?? null;
  }

  private static featureReportPayloadLength(report: HIDReportInfo): number {
    let bits = 0;
    for (const item of report.items ?? []) {
      bits += item.reportSize * item.reportCount;
    }
    // Some descriptors leave items empty; fall back to common WE size (64 total with id → 63 payload).
    if (bits === 0) return 63;
    return Math.ceil(bits / 8);
  }

  private static collectionTreeHasVendorUsage(collections: readonly HIDCollectionInfo[]): boolean {
    return collections.some((collection) => {
      if (collection.usagePage >= 0xff00) return true;
      return this.collectionTreeHasVendorUsage(collection.children);
    });
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.reportTarget) this.reportTarget = this.resolveReportTarget();
  }

  describeCollections(): string {
    return EggWeHidClient.listFeatureReports(this.device).map((report) =>
      `id 0x${report.reportId.toString(16)} · ${report.payloadLength} bytes`).join(" | ")
      || this.device.collections.map((collection) =>
        `usage 0x${collection.usagePage.toString(16)}:0x${collection.usage.toString(16)}`).join(" | ")
      || "No HID collections reported";
  }

  getDpiOptions(): number[] {
    const values: number[] = [];
    for (let dpi = 50; dpi <= 19000; dpi += 50) values.push(dpi);
    return values;
  }

  get supportedPollingRates(): number[] {
    return [...POLLING_RATES];
  }

  private productMeta(): { name: string; wired: boolean } {
    const known = KNOWN_PRODUCTS.get(this.device.productId);
    if (known) return known;
    const productName = this.device.productName?.trim() || "Endgame Gear WE mouse";
    const lower = productName.toLowerCase();
    const wired = !lower.includes("receiver") && !lower.includes("dongle");
    if (lower.includes("op1we") || lower.includes("op1 we")) {
      return { name: wired ? "Endgame Gear OP1we" : "Endgame Gear OP1we receiver", wired };
    }
    return { name: productName, wired };
  }

  private resolveReportTarget(): FeatureReportTarget {
    for (const reportId of PREFERRED_REPORT_IDS) {
      const match = EggWeHidClient.findFeatureReport(this.device, reportId);
      if (match) return match;
    }
    const any = EggWeHidClient.listFeatureReports(this.device)[0];
    if (any) return any;
    // Descriptor empty (some Windows builds) — use verified WE defaults.
    return { reportId: 0xa1, payloadLength: 63 };
  }

  async readStatus(): Promise<MouseStatus> {
    const meta = this.productMeta();
    await this.open();

    // Battery is the only fully verified command. Soft-fail so a transport
    // mismatch still shows the device while we surface a clear banner.
    const battery = await this.readBattery().catch(() => ({
      percent: null as number | null,
      state: "Unknown" as const,
    }));
    const state = await this.readDeviceState().catch(() => null);
    const firmware = await this.readFirmware().catch(() => null);

    const dpi = state?.dpi ?? DEFAULT_DPI;
    const pollingRateHz = state?.pollingRateHz ?? DEFAULT_POLLING;
    const debounceMs = state?.debounceMs ?? DEFAULT_DEBOUNCE;
    const liftOffDistance = state?.liftOffDistance ?? "Medium";

    const target = this.reportTarget ?? this.resolveReportTarget();
    return {
      brand: "Endgame Gear",
      name: meta.name,
      batteryPercent: battery.percent,
      batteryState: battery.state,
      dpi: this.clampDpi(dpi),
      pollingRateHz: POLLING_RATES.includes(pollingRateHz as (typeof POLLING_RATES)[number])
        ? pollingRateHz
        : DEFAULT_POLLING,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: meta.wired ? "Wired" : "Wireless",
      connectionDetail:
        `${meta.wired ? "Wired USB" : "2.4 GHz dongle"} · PID 0x${this.device.productId.toString(16).toUpperCase()}`
        + ` · WE · report 0x${target.reportId.toString(16)}/${target.payloadLength}B`
        + (battery.percent === null ? " · battery unread" : ""),
      debounceMs,
      liftOffDistance,
      firmware: firmware
        ? [`Firmware ${firmware}`]
        : state?.firmware
          ? [`Firmware ${state.firmware}`]
          : ["Firmware unavailable"],
    };
  }

  async setDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) {
      throw new Error("OP1we CPI must be between 50 and 19,000 in 50 CPI steps.");
    }
    await this.writeSetting(COMMAND.dpi, [dpi & 0xff, (dpi >> 8) & 0xff]);
    const confirmed = (await this.readDeviceState()).dpi;
    if (confirmed !== dpi) {
      throw new Error(`The mouse kept ${confirmed} CPI instead of ${dpi} CPI. Settings command map may need a capture from WE software.`);
    }
    return confirmed;
  }

  async setPollingRate(rate: number): Promise<number> {
    if (!POLLING_RATES.includes(rate as (typeof POLLING_RATES)[number])) {
      throw new Error("Unsupported OP1we polling rate. Use 125, 250, 500, or 1000 Hz.");
    }
    await this.writeSetting(COMMAND.polling, [this.encodePolling(rate)]);
    const confirmed = (await this.readDeviceState()).pollingRateHz;
    if (confirmed !== rate) {
      throw new Error(`The mouse kept ${confirmed} Hz instead of ${rate} Hz. Settings command map may need a capture from WE software.`);
    }
    return confirmed;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    if (value === "Low") {
      throw new Error("The OP1we supports Medium or High lift-off distance.");
    }
    const encoded = value === "Medium" ? 1 : 2;
    await this.writeSetting(COMMAND.lod, [encoded]);
    const confirmed = (await this.readDeviceState()).liftOffDistance;
    if (confirmed !== value) {
      throw new Error("The mouse did not confirm the requested lift-off distance. Settings command map may need a capture from WE software.");
    }
  }

  async setDebounceTime(milliseconds: number): Promise<number> {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 15) {
      throw new Error("Debounce must be an integer from 0 to 15 ms.");
    }
    await this.writeSetting(COMMAND.debounce, [milliseconds]);
    const confirmed = (await this.readDeviceState()).debounceMs;
    if (confirmed !== milliseconds) {
      throw new Error(`The mouse kept ${confirmed} ms debounce instead of ${milliseconds} ms. Settings command map may need a capture from WE software.`);
    }
    return confirmed;
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  async probeCommands(from = 0xa8, to = 0xc0): Promise<string> {
    const lines: string[] = [`target: ${this.describeCollections()}`];
    for (let command = from; command <= to; command += 1) {
      try {
        const response = await this.query(command, { wake: command === COMMAND.battery });
        const hex = [...response].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
        lines.push(`0x${command.toString(16)}: ${hex}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed";
        lines.push(`0x${command.toString(16)}: ${message}`);
      }
    }
    return lines.join("\n");
  }

  private async readBattery(): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    // Public WE battery protocol: double-read with wake delays, command 0xb4.
    await this.query(COMMAND.battery, { wake: true });
    await this.delay(100);
    const response = await this.query(COMMAND.battery, { wake: true });
    const statusByte = this.responseByte(response, 1);
    const percentByte = this.responseByte(response, 16);

    if (statusByte !== 0x01 && statusByte !== 0x08) {
      if (percentByte !== undefined && percentByte <= 100) {
        return {
          percent: percentByte,
          state: this.productMeta().wired ? "Charging" : "Discharging",
        };
      }
      return { percent: null, state: "Unknown" };
    }
    return {
      percent: Math.min(percentByte ?? 0, 100),
      state: this.productMeta().wired ? "Charging" : "Discharging",
    };
  }

  /**
   * Map Windows-style offsets (report id at index 0) onto WebHID buffers
   * that usually omit the report id.
   */
  private responseByte(response: Uint8Array, windowsIndex: number): number | undefined {
    if (this.responseIncludesReportId === true) return response[windowsIndex];
    if (this.responseIncludesReportId === false) return response[windowsIndex - 1];

    // Auto-detect once we see a plausible battery frame.
    if (response[0] === 0xa1 || response[0] === 0xa0) {
      this.responseIncludesReportId = true;
      return response[windowsIndex];
    }
    this.responseIncludesReportId = false;
    return response[windowsIndex - 1];
  }

  private async readDeviceState(): Promise<{
    dpi: number;
    pollingRateHz: number;
    liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]>;
    debounceMs: number;
    firmware: string | null;
  }> {
    try {
      const block = await this.query(COMMAND.status);
      if (this.looksLikeStatus(block)) return this.parseStatusBlock(block);
    } catch {
      // Fall through to defaults — provisional status commands often fail.
    }
    return {
      dpi: DEFAULT_DPI,
      pollingRateHz: DEFAULT_POLLING,
      liftOffDistance: "Medium",
      debounceMs: DEFAULT_DEBOUNCE,
      firmware: null,
    };
  }

  private parseStatusBlock(block: Uint8Array): {
    dpi: number;
    pollingRateHz: number;
    liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]>;
    debounceMs: number;
    firmware: string | null;
  } {
    const dpi = this.clampDpi(
      (this.responseByte(block, 4) ?? 0) | ((this.responseByte(block, 5) ?? 0) << 8),
    );
    const pollingRateHz = this.decodePolling(this.responseByte(block, 6) ?? 0);
    const lodRaw = this.responseByte(block, 7) ?? 1;
    const liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]> =
      lodRaw === 2 ? "High" : "Medium";
    const debounceMs = Math.min(Math.max(this.responseByte(block, 8) ?? DEFAULT_DEBOUNCE, 0), 15);
    const major = this.responseByte(block, 10);
    const minor = this.responseByte(block, 11);
    const firmware = major !== undefined && minor !== undefined && (major !== 0 || minor !== 0)
      ? `${major}.${minor}`
      : null;
    return {
      dpi,
      pollingRateHz: POLLING_RATES.includes(pollingRateHz as (typeof POLLING_RATES)[number])
        ? pollingRateHz
        : DEFAULT_POLLING,
      liftOffDistance,
      debounceMs,
      firmware,
    };
  }

  private looksLikeStatus(block: Uint8Array): boolean {
    const dpi = (this.responseByte(block, 4) ?? 0) | ((this.responseByte(block, 5) ?? 0) << 8);
    const polling = this.decodePolling(this.responseByte(block, 6) ?? 0);
    const lod = this.responseByte(block, 7);
    const debounce = this.responseByte(block, 8);
    return dpi >= 50 && dpi <= 19000 && dpi % 50 === 0
      && POLLING_RATES.includes(polling as (typeof POLLING_RATES)[number])
      && (lod === 1 || lod === 2)
      && debounce !== undefined && debounce <= 15;
  }

  private async readFirmware(): Promise<string | null> {
    const response = await this.query(COMMAND.firmware);
    const major = this.responseByte(response, 2) ?? this.responseByte(response, 10);
    const minor = this.responseByte(response, 3) ?? this.responseByte(response, 11);
    if (major === undefined || minor === undefined) return null;
    if (major === 0 && minor === 0) return null;
    return `${major}.${minor}`;
  }

  private async writeSetting(command: number, payload: number[]): Promise<void> {
    // WE battery uses the same report for set+get; do not use 0xa0 unless that
    // is the only report the interface exposes.
    const data = new Uint8Array(Math.max(1 + payload.length, 2));
    data[0] = command;
    data[1] = payload.length;
    for (let index = 0; index < payload.length; index += 1) {
      data[2 + index] = payload[index] & 0xff;
    }
    await this.sendFeature(data);
    await this.delay(50);
  }

  private query(command: number, options: { wake?: boolean } = {}): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      await this.open();
      const data = new Uint8Array(1);
      data[0] = command;
      await this.sendFeature(data);
      if (options.wake) await this.delay(350);
      else await this.delay(40);
      return await this.receiveFeature();
    };
    const next = this.commandQueue.then(run, run);
    this.commandQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async sendFeature(payload: Uint8Array): Promise<void> {
    await this.open();
    const target = this.reportTarget ?? this.resolveReportTarget();
    const candidates = this.sendCandidates(target, payload);
    let lastError: Error | null = null;

    for (const candidate of candidates) {
      try {
        // Copy into a standalone ArrayBuffer so TS/BufferSource stay happy.
        const body = new Uint8Array(candidate.data.byteLength);
        body.set(candidate.data);
        await this.device.sendFeatureReport(candidate.reportId, body);
        this.reportTarget = { reportId: candidate.reportId, payloadLength: candidate.data.byteLength };
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    const detail = this.describeCollections();
    const message = lastError?.message ?? "Failed to write the feature report.";
    throw new Error(
      `${message} Tried report(s) on ${this.device.productName || "device"} `
      + `(PID 0x${this.device.productId.toString(16)}, ${detail}). `
      + "Close official WE software and pick the vendor interface if several appear.",
    );
  }

  /**
   * Build sized payloads. WebHID requires the exact feature report length from
   * the descriptor; wrong length → "Failed to write the feature report."
   */
  private sendCandidates(
    preferred: FeatureReportTarget,
    payload: Uint8Array,
  ): Array<{ reportId: number; data: Uint8Array }> {
    const reports = EggWeHidClient.listFeatureReports(this.device);
    const reportIds = [
      preferred.reportId,
      ...PREFERRED_REPORT_IDS,
      ...reports.map((report) => report.reportId),
    ].filter((id, index, all) => all.indexOf(id) === index);

    const lengths = [
      preferred.payloadLength,
      ...reports.map((report) => report.payloadLength),
      63, // 64-byte report with id excluded
      64,
      32,
      31,
      Math.max(payload.byteLength, 1),
    ].filter((length, index, all) => length > 0 && all.indexOf(length) === index);

    const candidates: Array<{ reportId: number; data: Uint8Array }> = [];
    for (const reportId of reportIds) {
      for (const length of lengths) {
        const data = new Uint8Array(length);
        data.set(payload.subarray(0, Math.min(payload.byteLength, length)));
        candidates.push({ reportId, data });
      }
    }
    return candidates;
  }

  private async receiveFeature(): Promise<Uint8Array> {
    await this.open();
    const target = this.reportTarget ?? this.resolveReportTarget();
    const reportIds = [target.reportId, ...PREFERRED_REPORT_IDS]
      .filter((id, index, all) => all.indexOf(id) === index);
    let lastError: Error | null = null;
    for (const reportId of reportIds) {
      try {
        const view = await this.device.receiveFeatureReport(reportId);
        return this.copyDataView(view);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error("Failed to read the feature report.");
  }

  private encodePolling(rate: number): number {
    const table: Record<number, number> = { 125: 8, 250: 4, 500: 2, 1000: 1 };
    const encoded = table[rate];
    if (!encoded) throw new Error("Unsupported OP1we polling rate.");
    return encoded;
  }

  private decodePolling(value: number): number {
    const table: Record<number, number> = {
      1: 1000, 2: 500, 4: 250, 8: 125,
      125: 125, 250: 250, 500: 500, 1000: 1000,
    };
    return table[value] ?? value;
  }

  private clampDpi(dpi: number): number {
    if (this.getDpiOptions().includes(dpi)) return dpi;
    const stepped = Math.round(dpi / 50) * 50;
    if (this.getDpiOptions().includes(stepped)) return stepped;
    return DEFAULT_DPI;
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
