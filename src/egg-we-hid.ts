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
   * Among WE-capable devices, collapse cable + receiver into one logical mouse.
   * Prefer cable when both are present; otherwise keep a single receiver.
   */
  static pickDevices(devices: readonly HIDDevice[]): HIDDevice[] {
    const we = devices.filter((device) => this.isSupported(device));
    if (we.length === 0) return [];
    const cables = we.filter((device) => !this.isReceiverDevice(device));
    const receivers = we.filter((device) => this.isReceiverDevice(device));
    if (cables.length > 0) return cables;
    return receivers.slice(0, 1);
  }

  static supportScore(device: HIDDevice): number {
    if (!this.isSupported(device)) return 0;
    let score = 1;
    if (OP1WE_CABLE_PIDS.has(device.productId)) score += 8;
    if (OP1WE_RECEIVER_PIDS.has(device.productId)) score += 2;
    if (!this.isReceiverDevice(device)) score += 4;
    const features = this.listFeatureReports(device);
    if (features.some((report) => report.reportId === 0x08)) score += 2;
    if (features.some((report) => report.reportId === 0x06)) score += 1;
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
   * Identity + connection. Wireless does zero config HID.
   * Wired may attempt a single battery read (best-effort, approximate).
   */
  async readStatus(): Promise<MouseStatus> {
    const meta = this.productMeta();
    const wireless = meta.viaReceiver;

    if (wireless) {
      // CRITICAL: no sendFeatureReport / sendReport — freezes the OP1we.
      return {
        brand: "Endgame Gear",
        name: meta.name,
        batteryPercent: null,
        batteryState: "Unknown",
        dpi: 800,
        pollingRateHz: 1000,
        supportedPollingRates: this.supportedPollingRates,
        activeProfile: null,
        connectionType: "Wireless",
        connectionDetail:
          `2.4 GHz via receiver · PID 0x${this.device.productId.toString(16).toUpperCase()} `
          + "· config HID idle (avoids freeze) · settings map pending RE",
        debounceMs: null,
        liftOffDistance: null,
        firmware: ["Wireless path · no config HID"],
      };
    }

    // Wired: optional single battery read only.
    let batteryPercent: number | null = null;
    let batteryState: MouseStatus["batteryState"] = "Unknown";
    let batteryNote = "battery skipped";

    try {
      await this.open();
      const battery = await this.readBatteryOnce();
      batteryPercent = battery.percent;
      batteryState = battery.state;
      batteryNote = battery.note;
    } catch (error) {
      batteryNote = error instanceof Error ? error.message : "battery read failed";
    }

    return {
      brand: "Endgame Gear",
      name: meta.name,
      batteryPercent,
      batteryState,
      dpi: 800,
      pollingRateHz: 1000,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: "Wired",
      connectionDetail: [
        "Wired USB",
        `PID 0x${this.device.productId.toString(16).toUpperCase()}`,
        batteryNote,
        "settings map pending RE",
      ].join(" · "),
      debounceMs: null,
      liftOffDistance: null,
      firmware: ["Firmware unread (settings map pending)"],
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
  // Battery (wired only) — single transaction, best-effort
  // ---------------------------------------------------------------------------

  private resolvePreferredTarget(): FeatureReportTarget {
    const features = EggWeHidClient.listFeatureReports(this.device)
      .filter((report) => report.payloadLength > 0);
    const by08 = features.find((report) => report.reportId === 0x08);
    if (by08) return by08;
    const by06 = features.find((report) => report.reportId === 0x06);
    if (by06) return by06;
    if (features[0]) return features[0];
    return { reportId: 0x06, payloadLength: 7 };
  }

  private async readBatteryOnce(): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
    note: string;
  }> {
    if (this.isWirelessPath()) {
      return { percent: null, state: "Unknown", note: "battery n/a on wireless" };
    }

    const target = this.resolvePreferredTarget();
    const packet = new Uint8Array(target.payloadLength);
    packet[0] = 0x04; // CompX-style battery command candidate

    try {
      await this.device.sendFeatureReport(target.reportId, packet);
      await this.delay(40);
      const view = await this.device.receiveFeatureReport(target.reportId);
      const response = new Uint8Array(
        view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
      );
      const raw = [...response].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
      // Prefer index 5 when present; never treat 100 as trusted without flags.
      let percent: number | null = null;
      let index = -1;
      if (response.byteLength > 5) {
        const value = response[5];
        if (value >= 1 && value <= 99) {
          percent = value;
          index = 5;
        }
      }
      if (percent === null) {
        for (let i = 1; i < Math.min(response.byteLength, 7); i += 1) {
          const value = response[i];
          if (value >= 1 && value <= 99) {
            percent = value;
            index = i;
            break;
          }
        }
      }
      return {
        percent,
        state: percent !== null ? "Charging" : "Unknown",
        note: percent !== null
          ? `batt@${index} ~${percent}% (approx) raw ${raw}`
          : `battery unread raw ${raw}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { percent: null, state: "Unknown", note: `battery fail: ${message}` };
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
