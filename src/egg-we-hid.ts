import type { MouseStatus } from "./mouse-types";

/**
 * Endgame Gear WE-series (OP1we / dongle / related PIDs).
 *
 * Verified: battery via feature report 0xa1, command 0xb4 (public RE).
 * Not verified: CPI / polling / LOD / debounce command IDs — those need a
 * USB capture of official WE Series software. Writes for unmapped settings
 * are intentionally disabled so the UI does not pretend defaults are live.
 *
 * WebHID notes:
 * - sendFeatureReport(reportId, data) — data must NOT include report id
 * - length must match the HID feature report payload (often 63 for a 64-byte
 *   Windows buffer that includes report id as byte 0)
 * - receiveFeatureReport usually omits report id; Windows docs include it
 */

const EGG_VENDOR_ID = 0x3367;

const KNOWN_PRODUCTS = new Map<number, { name: string; wired: boolean }>([
  [0x1972, { name: "Endgame Gear OP1we", wired: true }],
  [0x1970, { name: "Endgame Gear wireless receiver", wired: false }],
  [0x1968, { name: "Endgame Gear XM2we", wired: true }],
  [0x1982, { name: "Endgame Gear XM2w v2", wired: true }],
]);

const EGG_8K_PRODUCT_IDS = new Set([0x1964, 0x1966, 0x1976, 0x1978]);

/** Verified WE battery transport (Windows HidD uses report id + 63 payload). */
const WE_REPORT_ID = 0xa1;
const WE_PAYLOAD_LENGTH = 63;
const BATTERY_COMMAND = 0xb4;

const POLLING_RATES = [125, 250, 500, 1000] as const;

interface FeatureReportTarget {
  reportId: number;
  payloadLength: number;
}

export class EggWeHidClient {
  private commandQueue: Promise<unknown> = Promise.resolve();
  private reportTarget: FeatureReportTarget | null = null;
  private lastBatteryRaw: string | null = null;
  private lastBatteryError: string | null = null;
  /** True when receiveFeatureReport includes report id as byte 0. */
  private responseIncludesReportId: boolean | null = null;

  /**
   * Settings command map is not reverse-engineered yet. Keep false until a
   * capture confirms read/write pairs for CPI, polling, LOD, and debounce.
   */
  static readonly settingsMapped = false;

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== EGG_VENDOR_ID) return false;
    if (EGG_8K_PRODUCT_IDS.has(device.productId)) return false;
    return this.hasVendorConfigInterface(device);
  }

  static supportScore(device: HIDDevice): number {
    if (!this.isSupported(device)) return 0;
    let score = 1;
    if (this.findFeatureReport(device, WE_REPORT_ID)) score += 5;
    if (this.findFeatureReport(device, 0xa0)) score += 1;
    if (this.collectionTreeHasVendorUsage(device.collections)) score += 1;
    return score;
  }

  private static hasVendorConfigInterface(device: HIDDevice): boolean {
    if (this.findFeatureReport(device, WE_REPORT_ID) || this.findFeatureReport(device, 0xa0)) return true;
    if (this.collectionTreeHasVendorUsage(device.collections)) return true;
    return this.listFeatureReports(device).length > 0;
  }

  private static listFeatureReports(device: HIDDevice): FeatureReportTarget[] {
    const found: FeatureReportTarget[] = [];
    const visit = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        for (const report of collection.featureReports) {
          found.push({
            reportId: report.reportId,
            payloadLength: this.featureReportPayloadLength(report),
          });
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
    if (bits === 0) return WE_PAYLOAD_LENGTH;
    return Math.ceil(bits / 8);
  }

  private static collectionTreeHasVendorUsage(collections: readonly HIDCollectionInfo[]): boolean {
    return collections.some((collection) =>
      collection.usagePage >= 0xff00 || this.collectionTreeHasVendorUsage(collection.children));
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.reportTarget) this.reportTarget = this.resolveReportTarget();
  }

  describeCollections(): string {
    const reports = EggWeHidClient.listFeatureReports(this.device);
    if (reports.length === 0) {
      return `fallback report 0x${WE_REPORT_ID.toString(16)}/${WE_PAYLOAD_LENGTH}B`;
    }
    return reports.map((report) =>
      `id 0x${report.reportId.toString(16)}/${report.payloadLength}B`).join(" · ");
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
    const preferred = EggWeHidClient.findFeatureReport(this.device, WE_REPORT_ID);
    if (preferred) {
      return {
        reportId: preferred.reportId,
        // Prefer descriptor length, but never invent a weird size for battery.
        payloadLength: preferred.payloadLength > 0 ? preferred.payloadLength : WE_PAYLOAD_LENGTH,
      };
    }
    return { reportId: WE_REPORT_ID, payloadLength: WE_PAYLOAD_LENGTH };
  }

  async readStatus(): Promise<MouseStatus> {
    const meta = this.productMeta();
    await this.open();
    const battery = await this.readBattery();
    const target = this.reportTarget ?? this.resolveReportTarget();

    const detailParts = [
      meta.wired ? "Wired USB" : "2.4 GHz dongle",
      `PID 0x${this.device.productId.toString(16).toUpperCase()}`,
      "WE protocol",
      `report 0x${target.reportId.toString(16)}/${target.payloadLength}B`,
    ];
    if (battery.percent === null) {
      detailParts.push(this.lastBatteryError
        ? `battery fail: ${this.lastBatteryError}`
        : "battery unread");
      if (this.lastBatteryRaw) detailParts.push(`raw ${this.lastBatteryRaw}`);
    }
    detailParts.push("settings map pending RE");

    return {
      brand: "Endgame Gear",
      name: meta.name,
      batteryPercent: battery.percent,
      batteryState: battery.state,
      // Placeholders — not live device values until settings are reverse-engineered.
      dpi: 800,
      pollingRateHz: 1000,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: meta.wired ? "Wired" : "Wireless",
      connectionDetail: detailParts.join(" · "),
      debounceMs: null,
      liftOffDistance: null,
      firmware: battery.percent !== null
        ? ["Firmware unread (settings map pending)"]
        : ["Connect OK · battery protocol probing"],
    };
  }

  async setDpi(_dpi: number): Promise<number> {
    throw this.settingsNotMappedError("CPI");
  }

  async setPollingRate(_rate: number): Promise<number> {
    throw this.settingsNotMappedError("polling rate");
  }

  async setLiftOffDistance(_value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    throw this.settingsNotMappedError("lift-off distance");
  }

  async setDebounceTime(_milliseconds: number): Promise<number> {
    throw this.settingsNotMappedError("debounce");
  }

  private settingsNotMappedError(label: string): Error {
    return new Error(
      `OP1we ${label} is not reverse-engineered yet. `
      + "Battery uses a known command; DPI/polling/LOD/debounce need a USB capture "
      + "of Endgame Gear WE Series software. The values shown are placeholders.",
    );
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  /**
   * Dump command responses for reverse engineering (DevTools / temporary UI).
   */
  async probeCommands(from = 0x00, to = 0xff): Promise<string> {
    const lines: string[] = [
      `device: ${this.device.productName || "unknown"}`,
      `pid: 0x${this.device.productId.toString(16)}`,
      `collections: ${this.describeCollections()}`,
      `target: report 0x${(this.reportTarget ?? this.resolveReportTarget()).reportId.toString(16)}`
        + `/${(this.reportTarget ?? this.resolveReportTarget()).payloadLength}B`,
    ];
    for (let command = from; command <= to; command += 1) {
      try {
        const response = await this.query(command, { wake: command === BATTERY_COMMAND });
        const hex = [...response].slice(0, 24).map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
        const tail = response.byteLength > 24 ? " …" : "";
        lines.push(`0x${command.toString(16).padStart(2, "0")}: (${response.byteLength}B) ${hex}${tail}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed";
        lines.push(`0x${command.toString(16).padStart(2, "0")}: ${message}`);
      }
    }
    return lines.join("\n");
  }

  /** Narrow battery-focused probe used on connect diagnostics. */
  async probeBattery(): Promise<string> {
    const lines: string[] = [];
    const sizes = this.payloadLengthsToTry();
    for (const length of sizes) {
      for (const reportId of [WE_REPORT_ID, 0xa0]) {
        try {
          this.reportTarget = { reportId, payloadLength: length };
          const response = await this.query(BATTERY_COMMAND, { wake: true });
          await this.delay(100);
          const second = await this.query(BATTERY_COMMAND, { wake: true });
          const parsed = this.parseBatteryResponse(second);
          lines.push(
            `report 0x${reportId.toString(16)}/${length}B → ${second.byteLength}B `
            + `raw[${this.toHex(second, 20)}] parse=${parsed.percent ?? "null"}%`,
          );
          if (parsed.percent !== null) {
            this.lastBatteryRaw = this.toHex(second, 20);
            return lines.join("\n");
          }
          void response;
        } catch (error) {
          const message = error instanceof Error ? error.message : "failed";
          lines.push(`report 0x${reportId.toString(16)}/${length}B → ${message}`);
        }
      }
    }
    return lines.join("\n");
  }

  private async readBattery(): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    this.lastBatteryError = null;
    this.lastBatteryRaw = null;

    // Try verified framing first, then a small set of alternate lengths only if needed.
    const attempts = this.payloadLengthsToTry().flatMap((length) => ([
      { reportId: WE_REPORT_ID, payloadLength: length },
      { reportId: 0xa0, payloadLength: length },
    ]));

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      try {
        this.reportTarget = attempt;
        // Public protocol: double-read with wake delays.
        await this.query(BATTERY_COMMAND, { wake: true });
        await this.delay(100);
        const response = await this.query(BATTERY_COMMAND, { wake: true });
        this.lastBatteryRaw = this.toHex(response, 24);
        const parsed = this.parseBatteryResponse(response);
        if (parsed.percent !== null) {
          return {
            percent: parsed.percent,
            state: this.productMeta().wired ? "Charging" : "Discharging",
          };
        }
        // Keep the working transport even if parse failed — try next framing.
        lastError = new Error(`no battery byte in ${this.lastBatteryRaw}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    this.lastBatteryError = lastError?.message ?? "unknown";
    // Restore preferred target for later probes.
    this.reportTarget = this.resolveReportTarget();
    return { percent: null, state: "Unknown" };
  }

  private payloadLengthsToTry(): number[] {
    const fromDescriptor = EggWeHidClient.findFeatureReport(this.device, WE_REPORT_ID)?.payloadLength;
    const lengths = [
      WE_PAYLOAD_LENGTH, // 63 — matches Windows 64-byte buffer with report id
      fromDescriptor,
      64,
      32,
      31,
      15,
      7,
    ].filter((value): value is number => typeof value === "number" && value > 0);
    return [...new Set(lengths)];
  }

  private parseBatteryResponse(response: Uint8Array): { percent: number | null } {
    if (response.byteLength === 0) return { percent: null };

    // Detect whether report id is present.
    if (response[0] === WE_REPORT_ID || response[0] === 0xa0) {
      this.responseIncludesReportId = true;
    } else if (this.responseIncludesReportId === null) {
      this.responseIncludesReportId = false;
    }

    const at = (windowsIndex: number): number | undefined => {
      if (this.responseIncludesReportId) return response[windowsIndex];
      return response[windowsIndex - 1];
    };

    // Documented layout (Windows indices): [1]=status 0x01|0x08, [16]=percent.
    const status = at(1);
    const documented = at(16);
    if ((status === 0x01 || status === 0x08) && documented !== undefined && documented <= 100) {
      return { percent: documented };
    }

    // Alternate common layouts seen across CompX-ish devices.
    const candidates = [
      at(16), at(15), at(5), at(4), at(3), at(2),
      response[15], response[16], response[5], response[4], response[0],
    ];
    for (const value of candidates) {
      if (value !== undefined && value > 0 && value <= 100) {
        return { percent: value };
      }
    }

    // Last resort: any byte in 5–100 that is not a known status marker alone.
    for (let index = 0; index < response.byteLength; index += 1) {
      const value = response[index];
      if (value >= 5 && value <= 100 && value !== WE_REPORT_ID && value !== BATTERY_COMMAND) {
        // Prefer later bytes (payload) over early command echoes.
        if (index >= 2) return { percent: value };
      }
    }
    return { percent: null };
  }

  private query(command: number, options: { wake?: boolean } = {}): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      await this.open();
      const payload = new Uint8Array(1);
      payload[0] = command;
      await this.sendFeatureExact(payload);
      if (options.wake) await this.delay(350);
      else await this.delay(40);
      return await this.receiveFeature();
    };
    const next = this.commandQueue.then(run, run);
    this.commandQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  /**
   * Send using the current report target only (exact size). Do not “succeed”
   * on a random length — that was caching a silent no-op framing.
   */
  private async sendFeatureExact(payload: Uint8Array): Promise<void> {
    await this.open();
    const target = this.reportTarget ?? this.resolveReportTarget();
    const data = new Uint8Array(target.payloadLength);
    data.set(payload.subarray(0, Math.min(payload.byteLength, data.byteLength)));
    try {
      await this.device.sendFeatureReport(target.reportId, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message} (report 0x${target.reportId.toString(16)}, ${target.payloadLength}B payload, `
        + `pid 0x${this.device.productId.toString(16)}, ${this.describeCollections()})`,
      );
    }
  }

  private async receiveFeature(): Promise<Uint8Array> {
    await this.open();
    const target = this.reportTarget ?? this.resolveReportTarget();
    try {
      const view = await this.device.receiveFeatureReport(target.reportId);
      return this.copyDataView(view);
    } catch (error) {
      // Some stacks want the same report id used for set; try the other common id once.
      if (target.reportId === WE_REPORT_ID) {
        try {
          const view = await this.device.receiveFeatureReport(0xa0);
          return this.copyDataView(view);
        } catch {
          // fall through
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} (receive report 0x${target.reportId.toString(16)})`);
    }
  }

  private toHex(bytes: Uint8Array, max = 24): string {
    const slice = bytes.subarray(0, max);
    const hex = [...slice].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return bytes.byteLength > max ? `${hex}…` : hex;
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
