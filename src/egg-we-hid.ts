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
  // Battery — at most one feature transaction (no multi-command probes)
  // ---------------------------------------------------------------------------

  private resolvePreferredTarget(): FeatureReportTarget {
    const features = EggWeHidClient.listFeatureReports(this.device)
      .filter((report) => report.payloadLength > 0);
    // Prefer 16-byte config report when present; fall back to 7-byte (0x06).
    const by08 = features.find((report) => report.reportId === 0x08 && report.payloadLength >= 15);
    if (by08) return by08;
    const by06 = features.find((report) => report.reportId === 0x06);
    if (by06) return by06;
    if (features[0]) return features[0];
    return { reportId: 0x06, payloadLength: 7 };
  }

  private async readBatteryOnce(wireless: boolean): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    const target = this.resolvePreferredTarget();
    // Try 0x04 first (CompX/Pulsar-style). One packet only on wireless.
    const commands = wireless ? [0x04] : [0x04, 0xb4];

    for (const command of commands) {
      try {
        const response = await this.featureExchange(target, command, wireless);
        const parsed = this.parseBattery(response, command, wireless);
        if (parsed.percent !== null) {
          return {
            percent: parsed.percent,
            state: parsed.charging
              ? (parsed.percent >= 99 ? "Full" : "Charging")
              : (wireless ? "Discharging" : "Charging"),
          };
        }
        // Wired: try next command once. Wireless: stop after first attempt.
        if (wireless) break;
      } catch {
        if (wireless) break;
      }
    }
    return { percent: null, state: "Unknown" };
  }

  private async featureExchange(
    target: FeatureReportTarget,
    command: number,
    wireless: boolean,
  ): Promise<Uint8Array> {
    const packet = new Uint8Array(target.payloadLength);
    packet[0] = command;
    if (target.payloadLength >= 16) {
      // Pulsar-style length + checksum on 16-byte frames.
      packet[4] = 0;
      let sum = 0;
      for (let i = 0; i < packet.length - 1; i += 1) sum += packet[i];
      packet[15] = (0x55 - (sum & 0xff) - target.reportId) & 0xff;
    }
    await this.device.sendFeatureReport(target.reportId, packet);
    await this.delay(wireless ? 30 : 50);
    const view = await this.device.receiveFeatureReport(target.reportId);
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  /**
   * Parse battery from a single response.
   * Observed earlier: wrong byte → 52% vs OEM ~70%; 100% on dongle was a flag.
   * Prefer CompX layout percent @5; reject 100 unless charge looks full.
   */
  private parseBattery(
    response: Uint8Array,
    command: number,
    wireless: boolean,
  ): { percent: number | null; charging: boolean } {
    if (response.byteLength === 0) return { percent: null, charging: !wireless };

    const max = response.byteLength - 1;
    const chargeFlag = max >= 6 ? response[6] : undefined;
    const charging = chargeFlag === 1 || chargeFlag === 2 || (!wireless && chargeFlag !== 0);

    const tryIndex = (index: number): number | null => {
      if (index < 0 || index > max) return null;
      const raw = response[index];
      if (raw === command) return null;
      if (raw === 0 || raw > 100) return null;
      // 100% on wireless is almost always a status flag, not charge level.
      if (raw === 100 && wireless && chargeFlag !== 1 && chargeFlag !== 2) return null;
      if (raw === 100 && !charging && wireless) return null;
      if (raw >= 1 && raw <= 100) return raw;
      return null;
    };

    // 1) Preferred CompX/Pulsar layout: percent at [5]
    const at5 = tryIndex(5);
    if (at5 !== null) return { percent: at5, charging };

    // 2) Other payload indices (skip [0] command echo; skip last byte if 16B checksum)
    const last = response.byteLength >= 16 ? max - 1 : max;
    const order = [4, 3, 2, 6, 1, 7].filter((index) => index <= last);
    for (const index of order) {
      const value = tryIndex(index);
      if (value !== null && value !== 100) return { percent: value, charging };
    }

    // 3) Allow 100% only if charge flag says charging/full
    const full = tryIndex(5) ?? tryIndex(4);
    if (full === 100) return { percent: 100, charging: true };

    return { percent: null, charging: !wireless };
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
