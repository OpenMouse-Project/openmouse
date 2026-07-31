import type { MouseStatus } from "./mouse-types";

/**
 * Endgame Gear WE-series (OP1we).
 *
 * Model:
 * - One physical mouse (OP1we).
 * - Cable HID (e.g. PID 0x1962) and receiver HID (e.g. PID 0x1961) are two
 *   transports to that same mouse — never two products.
 * - OEM software may list both interfaces; OpenMouse shows one OP1we.
 *
 * Safety:
 * - Wireless (receiver) path: NO feature/output config traffic. Any chatter
 *   freezes the mouse. Identity-only status until protocol is captured offline.
 * - Wired path: optional single battery attempt; no multi-command probes.
 *
 * Settings (CPI/polling/LOD/debounce) are not reverse-engineered yet.
 */

const EGG_VENDOR_ID = 0x3367;

/** Cable / dongle PIDs observed for OP1we and related WE family. */
const OP1WE_CABLE_PIDS = new Set([0x1962, 0x1972]);
const OP1WE_RECEIVER_PIDS = new Set([0x1961, 0x1970]);
const OTHER_WE_MOUSE_PIDS = new Map<number, string>([
  [0x1968, "Endgame Gear XM2we"],
  [0x1982, "Endgame Gear XM2w"],
]);

/** Wired OP1 8K / XM2 8K — owned by egg-op1-hid. */
const EGG_8K_PRODUCT_IDS = new Set([0x1964, 0x1966, 0x1976, 0x1978]);

const POLLING_RATES = [125, 250, 500, 1000] as const;

interface FeatureReportTarget {
  reportId: number;
  payloadLength: number;
}

export class EggWeHidClient {
  /** Settings writes are not mapped — keep false until USB capture of WE software. */
  static readonly settingsMapped = false;

  /** No background polling — feature traffic freezes the wireless mouse. */
  static readonly pollIntervalMs = 0;

  /**
   * When true, attempt one battery feature read on the receiver path.
   * Set false immediately if wireless freezes return.
   */
  static readonly ALLOW_WIRELESS_BATTERY = true;

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== EGG_VENDOR_ID) return false;
    if (EGG_8K_PRODUCT_IDS.has(device.productId)) return false;
    // Known WE PIDs, or any non-8K EGG with a vendor feature/output report.
    if (OP1WE_CABLE_PIDS.has(device.productId) || OP1WE_RECEIVER_PIDS.has(device.productId)) {
      return true;
    }
    if (OTHER_WE_MOUSE_PIDS.has(device.productId)) return true;
    return this.listFeatureReports(device).length > 0
      || this.listOutputReports(device).length > 0
      || this.collectionTreeHasVendorUsage(device.collections);
  }

  /** Dongle HID interface — same mouse, wireless transport only. */
  static isReceiverDevice(device: HIDDevice): boolean {
    if (OP1WE_RECEIVER_PIDS.has(device.productId)) return true;
    const name = (device.productName || "").toLowerCase();
    return name.includes("receiver") || name.includes("dongle");
  }

  /**
   * Among WE-capable HID interfaces, pick exactly one logical mouse.
   * Prefer cable over receiver; among equals, highest supportScore wins.
   * (A single USB mouse often enumerates multiple interfaces — never return both.)
   */
  static pickDevices(devices: readonly HIDDevice[]): HIDDevice[] {
    const we = devices.filter((device) => this.isSupported(device));
    if (we.length === 0) return [];
    const ranked = [...we].sort((left, right) => {
      const receiverDelta = Number(this.isReceiverDevice(left)) - Number(this.isReceiverDevice(right));
      if (receiverDelta !== 0) return receiverDelta; // non-receiver first
      return this.supportScore(right) - this.supportScore(left);
    });
    return ranked[0] ? [ranked[0]] : [];
  }

  static supportScore(device: HIDDevice): number {
    if (!this.isSupported(device)) return 0;
    let score = 1;
    if (OP1WE_CABLE_PIDS.has(device.productId)) score += 8;
    if (OP1WE_RECEIVER_PIDS.has(device.productId)) score += 2;
    if (!this.isReceiverDevice(device)) score += 4;
    const features = this.listFeatureReports(device);
    if (features.some((report) => report.reportId === 0x08)) score += 3;
    if (features.some((report) => report.reportId === 0x06)) score += 1;
    // Prefer interfaces that actually expose config reports over bare boot mice.
    if (features.length > 0) score += 2;
    return score;
  }

  isWirelessPath(): boolean {
    return EggWeHidClient.isReceiverDevice(this.device);
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
    // Wireless: do not open the config interface unless we later add a
    // user-triggered, proven-safe command. Opening alone has been OK; avoid
    // feature traffic after open.
    if (this.isWirelessPath()) return;
    if (!this.device.opened) await this.device.open();
  }

  describeCollections(): string {
    return EggWeHidClient.listFeatureReports(this.device)
      .map((report) => `feat 0x${report.reportId.toString(16)}/${report.payloadLength}B`)
      .join(" · ") || "no feature reports";
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
    const other = OTHER_WE_MOUSE_PIDS.get(this.device.productId);
    // Always the mouse product — receiver is never a separate model name.
    const name = other
      ?? (OP1WE_CABLE_PIDS.has(this.device.productId)
        || OP1WE_RECEIVER_PIDS.has(this.device.productId)
        || /op1\s*we|we series/i.test(this.device.productName || "")
        ? "Endgame Gear OP1we"
        : (this.device.productName?.replace(/\s*(receiver|dongle)\s*/ig, " ").trim()
          || "Endgame Gear WE mouse"));

    return {
      name,
      wired: !viaReceiver,
      viaReceiver,
    };
  }

  /**
   * Identity + connection + best-effort battery.
   * UI fields match other brands (short connection/firmware text — no debug dump).
   *
   * Wireless: one optional battery read only (no probes/refresh). If freezes return,
   * set ALLOW_WIRELESS_BATTERY to false.
   */
  async readStatus(): Promise<MouseStatus> {
    const meta = this.productMeta();
    const wireless = meta.viaReceiver;

    let batteryPercent: number | null = null;
    let batteryState: MouseStatus["batteryState"] = "Unknown";

    // Wired: always try battery. Wireless: single read only (no auto-refresh).
    if (!wireless || EggWeHidClient.ALLOW_WIRELESS_BATTERY) {
      try {
        if (!wireless) await this.open();
        else if (!this.device.opened) await this.device.open();
        const battery = await this.readBatteryOnce(wireless);
        batteryPercent = battery.percent;
        batteryState = battery.state;
      } catch {
        batteryPercent = null;
        batteryState = "Unknown";
      }
    }

    return {
      brand: "Endgame Gear",
      name: meta.name,
      batteryPercent,
      batteryState,
      // Placeholders until settings protocol is mapped (UI keeps controls disabled).
      dpi: 800,
      pollingRateHz: 1000,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: wireless ? "Wireless" : "Wired",
      // Same style as other brands: short human text, no PID/debug.
      connectionDetail: wireless ? "2.4 GHz receiver" : "USB",
      debounceMs: null,
      liftOffDistance: null,
      firmware: [],
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
      + "Capture Endgame Gear WE Series software USB traffic to map writes.",
    );
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  // ---------------------------------------------------------------------------
  // Battery — few short attempts, no refresh loop
  // Earlier working path used report 0x06 (7B) + cmd 0x04 on this hardware.
  // ---------------------------------------------------------------------------

  private batteryTargets(): FeatureReportTarget[] {
    const fromDescriptor = EggWeHidClient.listFeatureReports(this.device)
      .filter((report) => report.payloadLength > 0);
    const extras: FeatureReportTarget[] = [
      { reportId: 0x06, payloadLength: 7 },
      { reportId: 0x08, payloadLength: 16 },
      { reportId: 0x08, payloadLength: 15 },
      { reportId: 0x06, payloadLength: 6 },
    ];
    const merged = [...fromDescriptor, ...extras];
    // Prefer 0x06 first — that is what succeeded on the user's OP1we before.
    merged.sort((left, right) => {
      const rank = (report: FeatureReportTarget): number => {
        if (report.reportId === 0x06) return 0;
        if (report.reportId === 0x08) return 1;
        return 2;
      };
      return rank(left) - rank(right) || left.payloadLength - right.payloadLength;
    });
    const seen = new Set<string>();
    return merged.filter((target) => {
      const key = `${target.reportId}:${target.payloadLength}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async readBatteryOnce(wireless: boolean): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    // Cap attempts: wireless ≤2, wired ≤6 (2 reports × 2 cmds × variants, early exit).
    const targets = this.batteryTargets().slice(0, wireless ? 2 : 4);
    const commands = wireless ? [0x04] : [0x04, 0xb4];
    let lastRaw = "";

    for (const target of targets) {
      for (const command of commands) {
        for (const withChecksum of target.payloadLength >= 16 ? [false, true] : [false]) {
          try {
            const response = await this.featureExchange(target, command, wireless, withChecksum);
            lastRaw = [...response].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
            const parsed = this.parseBattery(response, command, wireless);
            if (parsed.percent !== null) {
              console.info(
                `[OpenMouse WE battery] ok report=0x${target.reportId.toString(16)} `
                + `len=${target.payloadLength} cmd=0x${command.toString(16)} `
                + `checksum=${withChecksum} raw=[${lastRaw}] → ${parsed.percent}%`,
              );
              return {
                percent: parsed.percent,
                state: parsed.charging
                  ? (parsed.percent >= 99 ? "Full" : "Charging")
                  : (wireless ? "Discharging" : "Charging"),
              };
            }
            console.info(
              `[OpenMouse WE battery] no parse report=0x${target.reportId.toString(16)} `
              + `len=${target.payloadLength} cmd=0x${command.toString(16)} raw=[${lastRaw}]`,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            lastRaw = message;
            console.info(
              `[OpenMouse WE battery] fail report=0x${target.reportId.toString(16)} `
              + `len=${target.payloadLength} cmd=0x${command.toString(16)}: ${message}`,
            );
          }
        }
      }
      // Wireless: at most two report targets (0x06 then 0x08), no command flood.
      if (wireless) break;
    }

    console.info(`[OpenMouse WE battery] unread last=${lastRaw || "none"}`);
    return { percent: null, state: "Unknown" };
  }

  private async featureExchange(
    target: FeatureReportTarget,
    command: number,
    wireless: boolean,
    withChecksum: boolean,
  ): Promise<Uint8Array> {
    const packet = new Uint8Array(target.payloadLength);
    packet[0] = command;
    if (withChecksum && target.payloadLength >= 16) {
      packet[4] = 0;
      let sum = 0;
      for (let i = 0; i < packet.length - 1; i += 1) sum += packet[i];
      packet[15] = (0x55 - (sum & 0xff) - target.reportId) & 0xff;
    }
    await this.device.sendFeatureReport(target.reportId, packet);
    // Short settle; double-get can help flaky feature endpoints on cable only.
    await this.delay(wireless ? 40 : 60);
    let view = await this.device.receiveFeatureReport(target.reportId);
    let bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    if (!wireless && bytes.every((byte) => byte === 0)) {
      await this.delay(80);
      view = await this.device.receiveFeatureReport(target.reportId);
      bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    return bytes;
  }

  /**
   * Parse battery from a single response.
   * Accept 1–99 at likely payload indices. Reject bare 100 on wireless.
   * Also try Windows-style layout (report id at [0]) by shifting indices +1.
   */
  private parseBattery(
    response: Uint8Array,
    command: number,
    wireless: boolean,
  ): { percent: number | null; charging: boolean } {
    if (response.byteLength === 0) return { percent: null, charging: !wireless };

    // Detect whether byte0 is a report id (0x06/0x08) rather than a command echo.
    const hasReportIdPrefix = response[0] === 0x06 || response[0] === 0x08;
    const at = (index: number): number | undefined => {
      const real = hasReportIdPrefix ? index + 1 : index;
      return real < response.byteLength ? response[real] : undefined;
    };

    const chargeFlag = at(6);
    const charging = chargeFlag === 1 || chargeFlag === 2
      || (!wireless && chargeFlag !== 0 && chargeFlag !== undefined);

    const asPercent = (raw: number | undefined): number | null => {
      if (raw === undefined) return null;
      if (raw === command) return null;
      if (raw === 0 || raw > 100) return null;
      if (raw === 100) {
        // Only trust 100 when charge flag implies charging/full.
        if (chargeFlag === 1 || chargeFlag === 2) return 100;
        if (wireless) return null;
        return 100;
      }
      return raw;
    };

    // Preferred order: CompX/Pulsar percent @5, then nearby payload bytes.
    for (const index of [5, 4, 3, 2, 6, 1, 7]) {
      const value = asPercent(at(index));
      if (value !== null && value < 100) {
        return { percent: value, charging: charging || !wireless };
      }
    }

    // Direct buffer scan (no shift) as last resort — skip [0].
    for (let index = 1; index < response.byteLength; index += 1) {
      const value = asPercent(response[index]);
      if (value !== null && value < 100) {
        return { percent: value, charging: charging || !wireless };
      }
    }

    const full = asPercent(at(5)) ?? asPercent(at(4)) ?? asPercent(response[5]);
    if (full === 100) return { percent: 100, charging: true };

    return { percent: null, charging: !wireless };
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
