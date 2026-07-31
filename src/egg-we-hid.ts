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
  // Battery
  // User capture: feature 0x08/16B returns 08 + zeros (no payload yet);
  // feature 0x06 with wrong length fails write. Need exact sizes + possibly
  // output/input (Pulsar-style) or OEM wake sequence — Wireshark will settle.
  // ---------------------------------------------------------------------------

  private batteryFeatureTargets(): FeatureReportTarget[] {
    const fromDescriptor = EggWeHidClient.listFeatureReports(this.device)
      .filter((report) => report.payloadLength > 0);
    // Only exact sizes that match this hardware (never invent len=6).
    const known: FeatureReportTarget[] = [
      { reportId: 0x06, payloadLength: 7 },
      { reportId: 0x08, payloadLength: 16 },
    ];
    const merged = [...fromDescriptor, ...known];
    const seen = new Set<string>();
    return merged
      .filter((target) => {
        // Drop known-bad sizes from empty item counts.
        if (target.reportId === 0x06 && target.payloadLength !== 7) return false;
        if (target.reportId === 0x08 && target.payloadLength < 15) return false;
        const key = `${target.reportId}:${target.payloadLength}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => {
        // Prefer 0x06/7 (previously returned data) then 0x08/16.
        if (left.reportId !== right.reportId) {
          return left.reportId === 0x06 ? -1 : right.reportId === 0x06 ? 1 : left.reportId - right.reportId;
        }
        return left.payloadLength - right.payloadLength;
      });
  }

  private async readBatteryOnce(wireless: boolean): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    const targets = this.batteryFeatureTargets().slice(0, wireless ? 2 : 4);
    const commands = wireless ? [0x04] : [0x04, 0xb4, 0x05];
    let lastRaw = "";

    for (const target of targets) {
      for (const command of commands) {
        // Feature report path (no checksum first — zeros were returned with/without).
        try {
          const response = await this.featureExchange(target, command, wireless, false);
          lastRaw = this.toHex(response);
          const parsed = this.parseBattery(response, command, wireless);
          if (parsed.percent !== null) {
            console.info(`[OpenMouse WE battery] ok feature 0x${target.reportId.toString(16)}/${target.payloadLength} cmd=0x${command.toString(16)} raw=[${lastRaw}] → ${parsed.percent}%`);
            return this.batteryResult(parsed.percent, parsed.charging, wireless);
          }
          console.info(`[OpenMouse WE battery] empty feature 0x${target.reportId.toString(16)}/${target.payloadLength} cmd=0x${command.toString(16)} raw=[${lastRaw}]`);
        } catch (error) {
          lastRaw = error instanceof Error ? error.message : String(error);
          console.info(`[OpenMouse WE battery] fail feature 0x${target.reportId.toString(16)}/${target.payloadLength} cmd=0x${command.toString(16)}: ${lastRaw}`);
        }

        // Wired only: double-read wake (old EGG battery pattern) for 0xb4 / 0x04.
        if (!wireless && (command === 0x04 || command === 0xb4)) {
          try {
            const response = await this.featureExchangeWake(target, command);
            lastRaw = this.toHex(response);
            const parsed = this.parseBattery(response, command, wireless);
            if (parsed.percent !== null) {
              console.info(`[OpenMouse WE battery] ok wake 0x${target.reportId.toString(16)} cmd=0x${command.toString(16)} raw=[${lastRaw}] → ${parsed.percent}%`);
              return this.batteryResult(parsed.percent, parsed.charging, wireless);
            }
          } catch (error) {
            lastRaw = error instanceof Error ? error.message : String(error);
          }
        }

        // Output/input path (same report id family as Pulsar 0x08) — cable only.
        if (!wireless && target.reportId === 0x08) {
          try {
            const response = await this.outputExchange(target, command);
            lastRaw = this.toHex(response);
            const parsed = this.parseBattery(response, command, wireless);
            if (parsed.percent !== null) {
              console.info(`[OpenMouse WE battery] ok output 0x08 cmd=0x${command.toString(16)} raw=[${lastRaw}] → ${parsed.percent}%`);
              return this.batteryResult(parsed.percent, parsed.charging, wireless);
            }
            console.info(`[OpenMouse WE battery] empty output 0x08 cmd=0x${command.toString(16)} raw=[${lastRaw}]`);
          } catch (error) {
            lastRaw = error instanceof Error ? error.message : String(error);
            console.info(`[OpenMouse WE battery] fail output 0x08: ${lastRaw}`);
          }
        }
      }
      if (wireless) break;
    }

    console.info(
      `[OpenMouse WE battery] unread pid=0x${this.device.productId.toString(16)} `
      + `reports=${this.describeCollections()} last=${lastRaw || "none"}`,
    );
    return { percent: null, state: "Unknown" };
  }

  private batteryResult(
    percent: number,
    charging: boolean,
    wireless: boolean,
  ): { percent: number; state: MouseStatus["batteryState"] } {
    if (charging) {
      return { percent, state: percent >= 99 ? "Full" : "Charging" };
    }
    return { percent, state: wireless ? "Discharging" : "Charging" };
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
    await this.delay(wireless ? 40 : 80);
    const view = await this.device.receiveFeatureReport(target.reportId);
    return this.copyView(view);
  }

  /** Classic EGG-style double transaction (discard first response). */
  private async featureExchangeWake(
    target: FeatureReportTarget,
    command: number,
  ): Promise<Uint8Array> {
    const packet = new Uint8Array(target.payloadLength);
    packet[0] = command;
    await this.device.sendFeatureReport(target.reportId, packet);
    await this.delay(200);
    try {
      await this.device.receiveFeatureReport(target.reportId);
    } catch {
      // ignore first
    }
    await this.delay(80);
    await this.device.sendFeatureReport(target.reportId, packet);
    await this.delay(200);
    return this.copyView(await this.device.receiveFeatureReport(target.reportId));
  }

  private async outputExchange(
    target: FeatureReportTarget,
    command: number,
  ): Promise<Uint8Array> {
    const packet = new Uint8Array(target.payloadLength);
    packet[0] = command;
    // Soft wait for matching input report.
    const reply = new Promise<Uint8Array>((resolve) => {
      const timer = window.setTimeout(() => {
        this.device.removeEventListener("inputreport", onInput);
        resolve(new Uint8Array());
      }, 600);
      const onInput = (event: HIDInputReportEvent): void => {
        if (event.reportId !== target.reportId) return;
        window.clearTimeout(timer);
        this.device.removeEventListener("inputreport", onInput);
        resolve(this.copyView(event.data));
      };
      this.device.addEventListener("inputreport", onInput);
    });
    await this.device.sendReport(target.reportId, packet);
    const input = await reply;
    if (input.byteLength > 0) return input;
    // Fall back to feature get on same id.
    try {
      return this.copyView(await this.device.receiveFeatureReport(target.reportId));
    } catch {
      return input;
    }
  }

  private parseBattery(
    response: Uint8Array,
    command: number,
    wireless: boolean,
  ): { percent: number | null; charging: boolean } {
    if (response.byteLength === 0) return { percent: null, charging: !wireless };

    // Strip leading report id if present (08 00 00… from user's capture).
    let data = response;
    if ((response[0] === 0x06 || response[0] === 0x08) && response.byteLength > 1) {
      // If everything after report id is zero, there is no battery payload yet.
      if (response.slice(1).every((byte) => byte === 0)) {
        return { percent: null, charging: !wireless };
      }
      data = response.slice(1);
    }

    // All-zero payload = device ignored the command.
    if (data.every((byte) => byte === 0)) {
      return { percent: null, charging: !wireless };
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

    for (const index of [5, 4, 3, 2, 6, 1, 7, 8, 9, 10]) {
      const value = asPercent(data[index]);
      if (value !== null && value < 100) {
        return { percent: value, charging: charging || !wireless };
      }
    }

    // Any non-zero 1–99 in payload (last resort).
    for (let index = 1; index < data.byteLength; index += 1) {
      const value = asPercent(data[index]);
      if (value !== null && value < 100) {
        return { percent: value, charging: charging || !wireless };
      }
    }

    return { percent: null, charging: !wireless };
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
