import type { MouseStatus } from "./mouse-types";

/**
 * Endgame Gear WE-series (OP1we and related).
 *
 * Observed on OP1we (PID 0x1962):
 *   feature reports: 0x06 (7 bytes), 0x08 (16 bytes)
 * Older public RE for some EGG wireless used 0xa1/0xb4 — that map does NOT
 * apply to this firmware generation.
 *
 * Settings (CPI/polling/LOD/debounce) still need a USB capture of WE software.
 * Battery is probed across the real report ids + common command bytes.
 */

const EGG_VENDOR_ID = 0x3367;

/**
 * Known PIDs are hints only. Cable vs dongle is detected from the product
 * name ("Receiver" / "Dongle"). Display name is always the mouse, never the
 * receiver as a separate product.
 */
const KNOWN_MOUSE_NAMES = new Map<number, string>([
  [0x1962, "Endgame Gear OP1we"],
  [0x1972, "Endgame Gear OP1we"],
  [0x1970, "Endgame Gear OP1we"],
  [0x1968, "Endgame Gear XM2we"],
  [0x1982, "Endgame Gear XM2w"],
]);

const EGG_8K_PRODUCT_IDS = new Set([0x1964, 0x1966, 0x1976, 0x1978]);

/** Commands worth trying for battery / identity on CompX-style 16-byte reports. */
const BATTERY_COMMAND_CANDIDATES = [
  0x04, // Pulsar-family battery
  0xb4, // older EGG WE battery docs
  0x05, 0x06, 0x07, 0x08, 0x0a, 0x0b, 0x0c, 0x0e,
  0x10, 0x11, 0x12, 0x14, 0x1d, 0x20, 0x2b,
  0x01, 0x02, 0x03,
] as const;

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
  private lastBatteryNote: string | null = null;
  private lockedBattery: { command: number; byteIndex: number } | null = null;
  private useOutputReport = false;
  private inputWaiter: {
    reportId: number;
    resolve: (bytes: Uint8Array) => void;
    reject: (error: Error) => void;
    timer: number;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (!this.inputWaiter || event.reportId !== this.inputWaiter.reportId) return;
    const waiter = this.inputWaiter;
    this.inputWaiter = null;
    window.clearTimeout(waiter.timer);
    waiter.resolve(this.copyDataView(event.data));
  };

  /**
   * Settings command map is not reverse-engineered yet for this report family.
   */
  static readonly settingsMapped = false;

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== EGG_VENDOR_ID) return false;
    if (EGG_8K_PRODUCT_IDS.has(device.productId)) return false;
    return this.listFeatureReports(device).length > 0
      || this.listOutputReports(device).length > 0
      || this.collectionTreeHasVendorUsage(device.collections);
  }

  /** USB dongle / receiver interface (still talks to the mouse over 2.4 GHz). */
  static isReceiverDevice(device: HIDDevice): boolean {
    const name = (device.productName || "").toLowerCase();
    return name.includes("receiver") || name.includes("dongle");
  }

  static supportScore(device: HIDDevice): number {
    if (!this.isSupported(device)) return 0;
    let score = 1;
    const features = this.listFeatureReports(device);
    // Prefer the 16-byte config-style report (0x08) when present.
    if (features.some((report) => report.reportId === 0x08 && report.payloadLength >= 15)) score += 6;
    if (features.some((report) => report.reportId === 0x06)) score += 2;
    if (features.some((report) => report.reportId === 0xa1)) score += 1;
    // Prefer the mouse USB interface over a bare receiver when both are present.
    if (!this.isReceiverDevice(device)) score += 3;
    score += Math.min(features.length, 3);
    return score;
  }

  private static listFeatureReports(device: HIDDevice): FeatureReportTarget[] {
    const found: FeatureReportTarget[] = [];
    const visit = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        for (const report of collection.featureReports) {
          found.push({
            reportId: report.reportId,
            payloadLength: this.reportPayloadLength(report),
          });
        }
        visit(collection.children);
      }
    };
    visit(device.collections);
    return found;
  }

  private static listOutputReports(device: HIDDevice): FeatureReportTarget[] {
    const found: FeatureReportTarget[] = [];
    const visit = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        for (const report of collection.outputReports) {
          found.push({
            reportId: report.reportId,
            payloadLength: this.reportPayloadLength(report),
          });
        }
        visit(collection.children);
      }
    };
    visit(device.collections);
    return found;
  }

  private static listInputReports(device: HIDDevice): FeatureReportTarget[] {
    const found: FeatureReportTarget[] = [];
    const visit = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        for (const report of collection.inputReports) {
          found.push({
            reportId: report.reportId,
            payloadLength: this.reportPayloadLength(report),
          });
        }
        visit(collection.children);
      }
    };
    visit(device.collections);
    return found;
  }

  private static reportPayloadLength(report: HIDReportInfo): number {
    let bits = 0;
    for (const item of report.items ?? []) {
      bits += item.reportSize * item.reportCount;
    }
    return bits === 0 ? 0 : Math.ceil(bits / 8);
  }

  private static collectionTreeHasVendorUsage(collections: readonly HIDCollectionInfo[]): boolean {
    return collections.some((collection) =>
      collection.usagePage >= 0xff00 || this.collectionTreeHasVendorUsage(collection.children));
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.device.addEventListener("inputreport", this.onInputReport);
    if (!this.reportTarget) this.reportTarget = this.resolvePreferredTarget();
  }

  describeCollections(): string {
    const features = EggWeHidClient.listFeatureReports(this.device)
      .map((report) => `feat 0x${report.reportId.toString(16)}/${report.payloadLength}B`);
    const outputs = EggWeHidClient.listOutputReports(this.device)
      .map((report) => `out 0x${report.reportId.toString(16)}/${report.payloadLength}B`);
    const inputs = EggWeHidClient.listInputReports(this.device)
      .map((report) => `in 0x${report.reportId.toString(16)}/${report.payloadLength}B`);
    return [...features, ...outputs, ...inputs].join(" · ") || "no reports";
  }

  getDpiOptions(): number[] {
    const values: number[] = [];
    for (let dpi = 50; dpi <= 19000; dpi += 50) values.push(dpi);
    return values;
  }

  get supportedPollingRates(): number[] {
    return [...POLLING_RATES];
  }

  private productMeta(): { name: string; wired: boolean; viaReceiver: boolean } {
    const viaReceiver = EggWeHidClient.isReceiverDevice(this.device);
    const knownName = KNOWN_MOUSE_NAMES.get(this.device.productId);
    const productName = this.device.productName?.trim() || "";
    const lower = productName.toLowerCase();

    let name = knownName ?? (productName || "Endgame Gear WE mouse");
    // Always show the mouse name — never list "Receiver" as the product.
    if (viaReceiver) {
      if (lower.includes("op1we") || lower.includes("op1 we") || knownName?.includes("OP1we")) {
        name = "Endgame Gear OP1we";
      } else if (lower.includes("xm2") || knownName?.includes("XM2")) {
        name = knownName ?? "Endgame Gear XM2we";
      } else {
        const cleaned = productName
          .replace(/\s*receiver\s*/ig, " ")
          .replace(/\s*dongle\s*/ig, " ")
          .replace(/\s+/g, " ")
          .trim();
        name = knownName ?? (cleaned || "Endgame Gear mouse");
      }
    } else if (lower.includes("op1we") || lower.includes("op1 we")) {
      name = "Endgame Gear OP1we";
    }

    return {
      name,
      // Cable interface = wired/charging path; receiver = wireless path to the same mouse.
      wired: !viaReceiver,
      viaReceiver,
    };
  }

  /** Prefer 16-byte report 0x08, then any largest feature report, then output reports. */
  private resolvePreferredTarget(): FeatureReportTarget {
    const features = EggWeHidClient.listFeatureReports(this.device);
    const byId08 = features.find((report) => report.reportId === 0x08);
    if (byId08 && byId08.payloadLength > 0) return byId08;

    const sortedFeatures = [...features]
      .filter((report) => report.payloadLength > 0)
      .sort((left, right) => right.payloadLength - left.payloadLength || left.reportId - right.reportId);
    if (sortedFeatures[0]) return sortedFeatures[0];

    const outputs = EggWeHidClient.listOutputReports(this.device)
      .filter((report) => report.payloadLength > 0)
      .sort((left, right) => right.payloadLength - left.payloadLength);
    if (outputs[0]) {
      this.useOutputReport = true;
      return outputs[0];
    }

    // Last resort — sizes from the user's probe.
    return { reportId: 0x08, payloadLength: 16 };
  }

  private allTransportTargets(): FeatureReportTarget[] {
    const features = EggWeHidClient.listFeatureReports(this.device)
      .filter((report) => report.payloadLength > 0);
    const outputs = EggWeHidClient.listOutputReports(this.device)
      .filter((report) => report.payloadLength > 0);
    const merged = [...features, ...outputs];
    if (merged.length === 0) {
      return [
        { reportId: 0x08, payloadLength: 16 },
        { reportId: 0x06, payloadLength: 7 },
      ];
    }
    // De-dupe by reportId+length
    const seen = new Set<string>();
    return merged.filter((target) => {
      const key = `${target.reportId}:${target.payloadLength}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async readStatus(): Promise<MouseStatus> {
    const meta = this.productMeta();
    await this.open();
    const battery = await this.readBattery();
    const target = this.reportTarget ?? this.resolvePreferredTarget();

    const detailParts = [
      meta.viaReceiver ? "2.4 GHz (via receiver)" : "Wired USB",
      `PID 0x${this.device.productId.toString(16).toUpperCase()}`,
      "WE protocol",
      `${this.useOutputReport ? "out" : "feat"} 0x${target.reportId.toString(16)}/${target.payloadLength}B`,
    ];
    if (battery.percent !== null && this.lastBatteryNote) {
      detailParts.push(this.lastBatteryNote);
    }
    if (battery.percent === null) {
      detailParts.push(this.lastBatteryError ? `battery: ${this.lastBatteryError}` : "battery unread");
      if (this.lastBatteryRaw) detailParts.push(`raw ${this.lastBatteryRaw}`);
    }
    detailParts.push("settings map pending RE");

    return {
      brand: "Endgame Gear",
      name: meta.name,
      batteryPercent: battery.percent,
      batteryState: battery.state,
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
        : ["Probing WE reports 0x06/0x08"],
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
      `OP1we ${label} is not reverse-engineered yet on this report family `
      + `(${this.describeCollections()}). Capture WE Series software USB traffic to map writes.`,
    );
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.clearInputWaiter(new Error("Device closed."));
    if (this.device.opened) await this.device.close();
  }

  /**
   * Probe real report ids (0x06/0x08 etc.) with battery-ish commands.
   * Called on connect when battery % is missing.
   */
  async probeBattery(): Promise<string> {
    const lines: string[] = [
      `pid 0x${this.device.productId.toString(16)}`,
      `collections: ${this.describeCollections()}`,
    ];
    const targets = this.allTransportTargets();
    let found: { percent: number; line: string } | null = null;

    for (const target of targets) {
      for (const viaOutput of [false, true]) {
        // Skip output mode if this target is only known as a feature report with no matching out.
        if (viaOutput) {
          const hasOut = EggWeHidClient.listOutputReports(this.device)
            .some((report) => report.reportId === target.reportId);
          if (!hasOut && EggWeHidClient.listOutputReports(this.device).length === 0) {
            // Still try sendReport — some stacks accept it when only feature is listed.
          } else if (!hasOut) {
            continue;
          }
        }

        for (const command of BATTERY_COMMAND_CANDIDATES) {
          try {
            this.reportTarget = target;
            this.useOutputReport = viaOutput;
            const response = await this.query(command, { wake: command === 0xb4 || command === 0x04 });
            const parsed = this.parseBatteryResponse(response, command);
            const mode = viaOutput ? "out" : "feat";
            const line =
              `${mode} 0x${target.reportId.toString(16)}/${target.payloadLength}B `
              + `cmd 0x${command.toString(16).padStart(2, "0")} → ${response.byteLength}B `
              + `[${this.toHex(response, 16)}] parse=${parsed.percent ?? "null"}`
              + (parsed.note ? ` (${parsed.note})` : "");
            lines.push(line);
            if (parsed.percent !== null && !found) {
              found = { percent: parsed.percent, line };
              this.lastBatteryRaw = this.toHex(response, 16);
              this.lastBatteryNote = parsed.note;
              if (parsed.byteIndex !== undefined) {
                this.lockedBattery = { command, byteIndex: parsed.byteIndex };
              }
              // Keep working transport locked in.
              this.reportTarget = target;
              this.useOutputReport = viaOutput;
              lines.push(`SELECTED: ${line}`);
              return lines.join("\n");
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "failed";
            const mode = viaOutput ? "out" : "feat";
            lines.push(
              `${mode} 0x${target.reportId.toString(16)}/${target.payloadLength}B `
              + `cmd 0x${command.toString(16).padStart(2, "0")} → ${message}`,
            );
          }
        }
      }
    }

    // Reset to preferred feature target after failed probe.
    this.useOutputReport = false;
    this.reportTarget = this.resolvePreferredTarget();
    return lines.join("\n");
  }

  async probeCommands(from = 0x00, to = 0x30): Promise<string> {
    const target = this.reportTarget ?? this.resolvePreferredTarget();
    const lines: string[] = [
      `target: ${this.useOutputReport ? "out" : "feat"} 0x${target.reportId.toString(16)}/${target.payloadLength}B`,
      `collections: ${this.describeCollections()}`,
    ];
    for (let command = from; command <= to; command += 1) {
      try {
        const response = await this.query(command);
        lines.push(
          `0x${command.toString(16).padStart(2, "0")}: (${response.byteLength}B) ${this.toHex(response, 16)}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed";
        lines.push(`0x${command.toString(16).padStart(2, "0")}: ${message}`);
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
    this.lastBatteryNote = null;
    const meta = this.productMeta();

    // Quick path: preferred report + common battery commands.
    const target = this.resolvePreferredTarget();
    this.reportTarget = target;
    this.useOutputReport = false;

    const commands = this.lockedBattery
      ? [this.lockedBattery.command, 0x04, 0xb4, 0x05, 0x0b]
      : [0x04, 0xb4, 0x05, 0x0b];

    for (const command of commands) {
      try {
        const response = await this.query(command, { wake: true });
        this.lastBatteryRaw = this.toHex(response, 16);
        const parsed = this.parseBatteryResponse(response, command);
        if (parsed.percent !== null) {
          this.lastBatteryNote = parsed.note;
          if (parsed.byteIndex !== undefined) {
            this.lockedBattery = { command, byteIndex: parsed.byteIndex };
          }
          return {
            percent: parsed.percent,
            state: this.decodeChargeState(response, meta.wired, parsed.percent),
          };
        }
      } catch (error) {
        this.lastBatteryError = error instanceof Error ? error.message : String(error);
      }
    }

    // Full probe across real report ids (0x06 / 0x08).
    try {
      const report = await this.probeBattery();
      const selected = report.split("\n").find((line) => line.startsWith("SELECTED:"));
      if (selected && this.lastBatteryRaw) {
        const match = /parse=(\d+)/.exec(selected);
        if (match) {
          return {
            percent: Number(match[1]),
            state: this.decodeChargeState(null, meta.wired, Number(match[1])),
          };
        }
      }
      this.lastBatteryError = "no battery byte in responses (see console probe)";
    } catch (error) {
      this.lastBatteryError = error instanceof Error ? error.message : String(error);
    }

    return { percent: null, state: "Unknown" };
  }

  private decodeChargeState(
    response: Uint8Array | null,
    wired: boolean,
    percent: number,
  ): MouseStatus["batteryState"] {
    // Pulsar-style charge flag at index 6.
    if (response && response[6] === 1) return "Charging";
    if (response && response[6] === 0 && !wired) return "Discharging";
    if (wired) return percent >= 99 ? "Full" : "Charging";
    return "Discharging";
  }

  /**
   * Parse battery carefully — early heuristics grabbed the first 1–100 byte and
   * often mis-read status/flags (e.g. sticky 100% on the receiver, or ~52 vs OEM 70).
   */
  private parseBatteryResponse(
    response: Uint8Array,
    command: number,
  ): { percent: number | null; byteIndex?: number; note: string | null } {
    if (response.byteLength === 0) return { percent: null, note: null };

    // Locked offset from a previous good read on this session.
    if (this.lockedBattery && this.lockedBattery.command === command) {
      const value = response[this.lockedBattery.byteIndex];
      const scaled = this.normalizePercent(value);
      if (scaled !== null) {
        return {
          percent: scaled,
          byteIndex: this.lockedBattery.byteIndex,
          note: `batt@${this.lockedBattery.byteIndex} cmd 0x${command.toString(16)}`,
        };
      }
    }

    // Pulsar-family layout (cmd 0x04): percent @5, charge @6.
    if (command === 0x04 || response[0] === 0x04) {
      const at5 = this.normalizePercent(response[5]);
      if (at5 !== null) {
        return { percent: at5, byteIndex: 5, note: "batt@5 (0x04 layout)" };
      }
    }

    // Score candidate payload indices — skip command echo [0] and checksum tail.
    type Candidate = { index: number; percent: number; score: number };
    const candidates: Candidate[] = [];
    const last = Math.max(1, response.byteLength - 1);
    for (let index = 1; index < last; index += 1) {
      const raw = response[index];
      const percent = this.normalizePercent(raw);
      if (percent === null) continue;

      let score = 10;
      // Prefer CompX/Pulsar payload region.
      if (index === 5) score += 8;
      if (index === 4 || index === 3) score += 4;
      if (index >= 2 && index <= 6) score += 2;
      // 100% is often a status flag, not a real reading — deprioritize.
      if (percent === 100) score -= 12;
      if (percent === 0) score -= 6;
      // Extremely common false positives.
      if (raw === command) score -= 20;
      if (raw === 0x08 || raw === 0x06) score -= 4;

      candidates.push({ index, percent, score });
    }

    candidates.sort((left, right) => right.score - left.score || left.index - right.index);
    const best = candidates[0];
    if (!best || best.score < 8) return { percent: null, note: null };

    return {
      percent: best.percent,
      byteIndex: best.index,
      note: `batt@${best.index} raw 0x${(response[best.index] ?? 0).toString(16)}`,
    };
  }

  /** Map raw report bytes to 1–100%. Supports plain % and 0–20×5 style. */
  private normalizePercent(value: number | undefined): number | null {
    if (value === undefined) return null;
    if (value >= 1 && value <= 100) return value;
    // Some CompX stacks report 0–20 in 5% steps.
    if (value >= 1 && value <= 20) return value * 5;
    return null;
  }

  private query(command: number, options: { wake?: boolean } = {}): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      await this.open();
      const target = this.reportTarget ?? this.resolvePreferredTarget();
      const packet = new Uint8Array(target.payloadLength);
      packet[0] = command;
      // CompX/Pulsar-style: length field + checksum on 16-byte reports.
      if (target.payloadLength >= 16) {
        packet[4] = 0;
        packet[15] = this.simpleChecksum(packet, target.reportId);
      }

      if (this.useOutputReport) {
        return await this.exchangeOutput(target.reportId, packet, options.wake ? 400 : 80);
      }

      await this.sendFeature(target, packet);
      if (options.wake) await this.delay(200);
      else await this.delay(40);
      return await this.receiveFeature(target.reportId);
    };
    const next = this.commandQueue.then(run, run);
    this.commandQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private simpleChecksum(packet: Uint8Array, reportId: number): number {
    let sum = 0;
    for (let index = 0; index < packet.length - 1; index += 1) sum += packet[index];
    // Pulsar uses 0x55 - sum - reportId; try that on 16-byte frames.
    return (0x55 - (sum & 0xff) - reportId) & 0xff;
  }

  private async sendFeature(target: FeatureReportTarget, packet: Uint8Array): Promise<void> {
    const data = new Uint8Array(target.payloadLength);
    data.set(packet.subarray(0, Math.min(packet.byteLength, data.byteLength)));
    try {
      await this.device.sendFeatureReport(target.reportId, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message} (feat 0x${target.reportId.toString(16)}, ${target.payloadLength}B, `
        + `pid 0x${this.device.productId.toString(16)})`,
      );
    }
  }

  private async receiveFeature(reportId: number): Promise<Uint8Array> {
    try {
      return this.copyDataView(await this.device.receiveFeatureReport(reportId));
    } catch (error) {
      // Try sibling report id if present.
      const alt = this.allTransportTargets().find((target) => target.reportId !== reportId);
      if (alt) {
        try {
          return this.copyDataView(await this.device.receiveFeatureReport(alt.reportId));
        } catch {
          // fall through
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} (receive feat 0x${reportId.toString(16)})`);
    }
  }

  private async exchangeOutput(
    reportId: number,
    packet: Uint8Array,
    settleMs: number,
  ): Promise<Uint8Array> {
    this.clearInputWaiter(new Error("Superseded."));

    const response = new Promise<Uint8Array>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.inputWaiter = null;
        resolve(new Uint8Array());
      }, 800);
      this.inputWaiter = { reportId, resolve, reject, timer };
    });

    const data = new Uint8Array(packet.byteLength);
    data.set(packet);
    try {
      await this.device.sendReport(reportId, data);
    } catch (error) {
      this.clearInputWaiter();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} (out 0x${reportId.toString(16)}, ${packet.byteLength}B)`);
    }

    await this.delay(settleMs);
    const input = await response;
    if (input.byteLength > 0) return input;
    try {
      return this.copyDataView(await this.device.receiveFeatureReport(reportId));
    } catch {
      return input;
    }
  }

  private clearInputWaiter(reason?: Error): void {
    const waiter = this.inputWaiter;
    if (!waiter) return;
    window.clearTimeout(waiter.timer);
    this.inputWaiter = null;
    if (reason) waiter.reject(reason);
  }

  private toHex(bytes: Uint8Array, max = 16): string {
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
