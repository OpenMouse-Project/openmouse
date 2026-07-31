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
   * Wireless battery HID is off until OEM capture — dongle chatter freezes the
   * mouse and current commands only return empty frames.
   */
  static readonly ALLOW_WIRELESS_BATTERY = false;

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
    // From hidapitester report descriptors on PID 0x1962:
    //   FF02/2 → Feature report id 8, 16 data bytes
    //   FF04/2 → Feature report id 6, 7 data bytes
    //   FF01   → Input only (id 9); FF03 → Input only (id 2)
    const pages = this.usagePages(device);
    if (pages.has(0xff02)) score += 10;
    if (pages.has(0xff04)) score += 8;
    const features = this.listFeatureReports(device);
    if (features.some((report) => report.reportId === 0x08 && report.payloadLength >= 15)) score += 6;
    if (features.some((report) => report.reportId === 0x06 && report.payloadLength === 7)) score += 4;
    if (features.length > 0) score += 2;
    return score;
  }

  private static usagePages(device: HIDDevice): Set<number> {
    const pages = new Set<number>();
    const visit = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        pages.add(collection.usagePage);
        visit(collection.children);
      }
    };
    visit(device.collections);
    return pages;
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
  // Battery — from report descriptors (hidapitester on PID 0x1962):
  //   FF02/2: Feature report id 8, Report Count 16  (WebHID payload = 16 bytes, no report id)
  //   FF04/2: Feature report id 6, Report Count 7
  //   FF01:   Input report id 9 only — not feature
  //   FF03:   Input report id 2 only — not feature
  // Write on FF02/8 and FF04/6 succeeded in hidapitester; GetFeature failed when
  // length omitted the +1 report-id byte (Windows). WebHID sizes the buffer itself.
  // ---------------------------------------------------------------------------

  private batteryFeatureTargets(): FeatureReportTarget[] {
    const fromDescriptor = EggWeHidClient.listFeatureReports(this.device)
      .filter((report) => report.payloadLength > 0);
    // Descriptor-backed sizes only.
    const preferred: FeatureReportTarget[] = [
      { reportId: 0x08, payloadLength: 16 },
      { reportId: 0x06, payloadLength: 7 },
    ];
    const merged = [...fromDescriptor, ...preferred];
    const seen = new Set<string>();
    return merged
      .filter((target) => {
        if (target.reportId === 0x08 && target.payloadLength !== 16) return false;
        if (target.reportId === 0x06 && target.payloadLength !== 7) return false;
        if (target.reportId !== 0x08 && target.reportId !== 0x06) return false;
        const key = `${target.reportId}:${target.payloadLength}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.reportId === 0x08 ? -1 : right.reportId === 0x08 ? 1 : 0);
  }

  private async readBatteryOnce(wireless: boolean): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    // WebHID data buffer excludes report id: 16 bytes for report 8, 7 for report 6.
    const targets = this.batteryFeatureTargets();
    const commands = wireless ? [0x04] : [0x04, 0xb4, 0x05, 0x01, 0x02, 0x03];
    let lastRaw = "";

    for (const target of targets) {
      for (const command of commands) {
        try {
          const response = await this.featureExchange(target, command, wireless);
          lastRaw = this.toHex(response);
          const parsed = this.parseBattery(response, command, wireless);
          if (parsed.percent !== null) {
            console.info(
              `[OpenMouse WE battery] ok id=0x${target.reportId.toString(16)} `
              + `len=${target.payloadLength} cmd=0x${command.toString(16)} `
              + `raw=[${lastRaw}] → ${parsed.percent}%`,
            );
            return this.batteryResult(parsed.percent, parsed.charging, wireless);
          }
          console.info(
            `[OpenMouse WE battery] empty id=0x${target.reportId.toString(16)} `
            + `cmd=0x${command.toString(16)} raw=[${lastRaw}]`,
          );
        } catch (error) {
          lastRaw = error instanceof Error ? error.message : String(error);
          console.info(
            `[OpenMouse WE battery] fail id=0x${target.reportId.toString(16)} `
            + `cmd=0x${command.toString(16)}: ${lastRaw}`,
          );
        }
        if (wireless) break;
      }
      if (wireless) break;
    }

    console.info(`[OpenMouse WE battery] unread last=${lastRaw || "none"}`);
    return { percent: null, state: "Unknown" };
  }

  private batteryResult(
    percent: number,
    charging: boolean,
    wireless: boolean,
  ): { percent: number; state: MouseStatus["batteryState"] } {
    if (charging) return { percent, state: percent >= 99 ? "Full" : "Charging" };
    return { percent, state: wireless ? "Discharging" : "Charging" };
  }

  /**
   * WebHID: sendFeatureReport(reportId, data) — data does NOT include report id.
   * Payload length must match Report Count from the descriptor (16 or 7).
   */
  private async featureExchange(
    target: FeatureReportTarget,
    command: number,
    wireless: boolean,
  ): Promise<Uint8Array> {
    const packet = new Uint8Array(target.payloadLength);
    packet[0] = command;
    await this.device.sendFeatureReport(target.reportId, packet);
    await this.delay(wireless ? 40 : 100);
    // Second get helps some devices that ACK write then populate on next get.
    let view = await this.device.receiveFeatureReport(target.reportId);
    let bytes = this.copyView(view);
    if (!wireless && this.isAllZero(bytes)) {
      await this.delay(150);
      view = await this.device.receiveFeatureReport(target.reportId);
      bytes = this.copyView(view);
    }
    return bytes;
  }

  private parseBattery(
    response: Uint8Array,
    command: number,
    wireless: boolean,
  ): { percent: number | null; charging: boolean } {
    if (response.byteLength === 0 || this.isAllZero(response)) {
      return { percent: null, charging: !wireless };
    }

    // WebHID usually omits report id. If present, strip it.
    let data = response;
    if ((response[0] === 0x06 || response[0] === 0x08) && response.byteLength > 1) {
      if (this.isAllZero(response.subarray(1))) {
        return { percent: null, charging: !wireless };
      }
      data = response.subarray(1);
    }

    const chargeFlag = data[6];
    const charging = chargeFlag === 1 || chargeFlag === 2
      || (!wireless && chargeFlag !== undefined && chargeFlag !== 0);

    const asPercent = (raw: number | undefined): number | null => {
      if (raw === undefined || raw === command) return null;
      if (raw <= 0 || raw > 100) return null;
      if (raw === 100 && wireless && chargeFlag !== 1 && chargeFlag !== 2) return null;
      return raw;
    };

    // Prefer byte 1 as "command data" after our cmd at [0], then classic @5.
    for (const index of [1, 5, 4, 3, 2, 6, 7, 8, 9, 10]) {
      const value = asPercent(data[index]);
      if (value !== null && value < 100) {
        return { percent: value, charging: charging || !wireless };
      }
    }

    for (let index = 0; index < data.byteLength; index += 1) {
      if (index === 0 && data[0] === command) continue;
      const value = asPercent(data[index]);
      if (value !== null && value < 100) {
        return { percent: value, charging: charging || !wireless };
      }
    }

    return { percent: null, charging: !wireless };
  }

  private isAllZero(bytes: Uint8Array): boolean {
    for (let i = 0; i < bytes.byteLength; i += 1) {
      if (bytes[i] !== 0) return false;
    }
    return true;
  }

  private toHex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  }

  private copyView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
