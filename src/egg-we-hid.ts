import type { MouseStatus } from "./mouse-types";
import {
  WE_CMD_GET_POWER,
  WE_CMD_READ_EEPROM,
  WE_CMD_WRITE_EEPROM,
  WE_MAX_EEPROM_CHUNK,
  WE_OFF,
  WE_PAYLOAD_LEN,
  WE_REPORT_ID,
  weBuildCmdPayload,
  weBuildReadEepromPayload,
  weBuildWriteEepromPayload,
  weDecodeProfile,
  weEncodeLod,
  weIsValidCpi,
  wePackScalarPair,
  weParseReadEepromResponse,
  weParseWriteEepromResponse,
  weEncodeReportRate,
  weIsValidPollingRate,
  wePatchActiveDpi,
  WE_POLLING_RATES,
  type WeLod,
  type WeProfile,
} from "./egg-we-protocol";

/**
 * Endgame Gear WE-series (OP1we).
 *
 * Cable + wireless dongle: FF02 feature 8 ↔ FF01 input 9, checksum sum-to-0x55.
 * Battery GetPower 0x04; profile ReadEEPROM 0x08 / WriteEEPROM 0x07.
 * Prefer cable when both are present. Wireless uses the same cmds with
 * slightly longer spacing between EEPROM chunks.
 */

const EGG_VENDOR_ID = 0x3367;
const OP1WE_CABLE_PIDS = new Set([0x1962, 0x1972]);
const OP1WE_RECEIVER_PIDS = new Set([0x1961, 0x1970]);
const OTHER_WE_MOUSE_PIDS = new Map<number, string>([
  [0x1968, "Endgame Gear XM2we"],
  [0x1982, "Endgame Gear XM2w"],
]);
const EGG_8K_PRODUCT_IDS = new Set([0x1964, 0x1966, 0x1976, 0x1978]);

const USAGE_PAGE_CMD = 0xff02;
const USAGE_PAGE_NOTIFY = 0xff01;
const REPORT_NOTIFY = 0x09;
const CMD_TIMEOUT_MS = 900;
const WIRED_POLL_INTERVAL_MS = 30_000;
/** Slower status refresh on the dongle to avoid flooding the RF path. */
const WIRELESS_POLL_INTERVAL_MS = 45_000;
const WIRELESS_EEPROM_GAP_MS = 35;
/** Profile bytes needed for DPI + LOD + debounce (+ stages). */
const PROFILE_END = 0xb5;

interface ReportTarget {
  reportId: number;
  payloadLength: number;
}

interface WeChannels {
  cmd: HIDDevice;
  notify: HIDDevice;
}

export class EggWeHidClient {
  /** Basic settings (DPI, LOD) are mapped on cable and wireless receiver. */
  static readonly settingsMapped = true;

  /** Max report rate for this model (OEM UI: 125 / 250 / 500 / 1000 Hz). */
  static readonly MAX_POLLING_HZ = 1000;

  private cmdDevice: HIDDevice | null = null;
  private notifyDevice: HIDDevice | null = null;
  private channelsResolved = false;
  private responseWaiter: {
    command: number;
    resolve: (bytes: Uint8Array) => void;
    reject: (reason: Error) => void;
    timer: number;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (event.reportId !== REPORT_NOTIFY) return;
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    const waiter = this.responseWaiter;
    if (!waiter || bytes[0] !== waiter.command) return;
    window.clearTimeout(waiter.timer);
    this.responseWaiter = null;
    waiter.resolve(bytes);
  };

  constructor(readonly device: HIDDevice) {}

  static fromAuthorizedDevices(devices: readonly HIDDevice[]): EggWeHidClient | null {
    const primary = this.pickDevices(devices)[0];
    if (!primary) return null;
    const client = new EggWeHidClient(primary);
    client.bindPeers(devices);
    return client;
  }

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== EGG_VENDOR_ID) return false;
    return !EGG_8K_PRODUCT_IDS.has(device.productId)
      && (OP1WE_CABLE_PIDS.has(device.productId) || OP1WE_RECEIVER_PIDS.has(device.productId));
  }

  static isReceiverDevice(device: HIDDevice): boolean {
    if (OP1WE_RECEIVER_PIDS.has(device.productId)) return true;
    const name = (device.productName || "").toLowerCase();
    return name.includes("receiver") || name.includes("dongle");
  }

  static pickDevices(devices: readonly HIDDevice[]): HIDDevice[] {
    const we = devices.filter((device) => this.isSupported(device));
    if (we.length === 0) return [];
    const ranked = [...we].sort((left, right) => {
      const receiverDelta = Number(this.isReceiverDevice(left)) - Number(this.isReceiverDevice(right));
      if (receiverDelta !== 0) return receiverDelta;
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
    const pages = this.usagePages(device);
    if (pages.has(USAGE_PAGE_CMD)) score += 10;
    if (pages.has(USAGE_PAGE_NOTIFY)) score += 10;
    if (pages.has(0xff04)) score += 4;
    const features = this.listFeatureReports(device);
    const inputs = this.listInputReports(device);
    if (features.some((report) => report.reportId === WE_REPORT_ID && report.payloadLength >= 15)) score += 6;
    if (inputs.some((report) => report.reportId === REPORT_NOTIFY && report.payloadLength >= 15)) score += 6;
    if (features.length > 0) score += 2;
    return score;
  }

  get pollIntervalMs(): number {
    return this.isWirelessPath() ? WIRELESS_POLL_INTERVAL_MS : WIRED_POLL_INTERVAL_MS;
  }

  isWirelessPath(): boolean {
    return EggWeHidClient.isReceiverDevice(this.device);
  }

  ownsDevice(device: HIDDevice): boolean {
    return device === this.device
      || device === this.cmdDevice
      || device === this.notifyDevice;
  }

  /**
   * Pair FF02 (cmd) + FF01 (notify) for this transport only.
   * Cable primary → cable peers; receiver primary → receiver peers.
   */
  bindPeers(devices: readonly HIDDevice[]): void {
    const wireless = this.isWirelessPath();
    const peers = devices.filter((candidate) =>
      candidate.vendorId === this.device.vendorId
      && candidate.productId === this.device.productId
      && EggWeHidClient.isReceiverDevice(candidate) === wireless);
    const pool = peers.length > 0 ? peers : [this.device];
    const cmd = pool.find((d) => EggWeHidClient.hasCmdChannel(d)) ?? null;
    const notify = pool.find((d) => EggWeHidClient.hasNotifyChannel(d)) ?? null;
    this.cmdDevice = cmd ?? (EggWeHidClient.hasCmdChannel(this.device) ? this.device : null);
    this.notifyDevice = notify
      ?? (EggWeHidClient.hasNotifyChannel(this.device) ? this.device : null);
    this.channelsResolved = true;
  }

  async open(): Promise<void> {
    if (!this.channelsResolved) {
      const authorized = typeof navigator !== "undefined" && navigator.hid
        ? await navigator.hid.getDevices()
        : [];
      this.bindPeers(authorized);
    }
    const channels = this.resolvedChannels();
    if (!channels) {
      if (!this.device.opened) await this.device.open();
      return;
    }
    if (!channels.cmd.opened) await channels.cmd.open();
    if (channels.notify !== channels.cmd && !channels.notify.opened) {
      await channels.notify.open();
    }
    channels.notify.removeEventListener("inputreport", this.onInputReport);
    channels.notify.addEventListener("inputreport", this.onInputReport);
  }

  describeCollections(): string {
    const parts: string[] = [];
    const cmd = this.cmdDevice ?? this.device;
    const notify = this.notifyDevice;
    const features = EggWeHidClient.listFeatureReports(cmd)
      .map((report) => `feat 0x${report.reportId.toString(16)}/${report.payloadLength}B`);
    if (features.length) parts.push(features.join(" · "));
    if (notify) {
      const inputs = EggWeHidClient.listInputReports(notify)
        .filter((report) => report.reportId === REPORT_NOTIFY)
        .map((report) => `in 0x${report.reportId.toString(16)}/${report.payloadLength}B`);
      if (inputs.length) parts.push(inputs.join(" · "));
    }
    return parts.join(" · ") || "no vendor reports";
  }

  getDpiOptions(): number[] {
    const values: number[] = [];
    for (let dpi = 50; dpi <= 12800; dpi += 50) values.push(dpi);
    return values;
  }

  get supportedPollingRates(): number[] {
    // Same four rates as Endgame Gear WE Series software (upper bound 1000 Hz).
    return [...WE_POLLING_RATES];
  }

  async readStatus(): Promise<MouseStatus> {
    const meta = this.productMeta();
    const wireless = meta.viaReceiver;

    let batteryPercent: number | null = null;
    let batteryState: MouseStatus["batteryState"] = "Unknown";
    let profile: WeProfile | null = null;

    try {
      await this.open();
      const battery = await this.readBatteryOnce();
      batteryPercent = battery.percent;
      batteryState = battery.state;
      profile = await this.readProfile();
    } catch (error) {
      console.info(
        "[OpenMouse WE] readStatus failed:",
        error instanceof Error ? error.message : error,
      );
    }

    return {
      brand: "Endgame Gear",
      name: meta.name,
      batteryPercent,
      batteryState,
      dpi: profile?.dpi ?? 800,
      pollingRateHz: profile?.pollingRateHz ?? 1000,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: wireless ? "2.4 GHz receiver" : "USB",
      // Debounce mapped on wire but not in the simple WE control grid.
      debounceMs: null,
      liftOffDistance: profile?.lod ?? null,
      // Do not set eggCpiStages — that flag selects OP1 8K advanced UI.
      firmware: [],
      ui: {
        family: "egg-we",
        settingsReady: EggWeHidClient.settingsMapped && profile !== null,
        hideLodLow: true,
        hideUnsupportedPollingRates: true,
        hideProcessingCard: true,
        forceShowBattery: true,
        pollingNote: "OP1we supports up to 1,000 Hz (125 / 250 / 500 / 1000).",
        defaultDisplayName: "Endgame Gear OP1we",
      },
    };
  }

  async setDpi(dpi: number): Promise<number> {
    if (!weIsValidCpi(dpi) || !this.getDpiOptions().includes(dpi)) {
      throw new Error("OP1we CPI must be between 50 and 12,800 in 50 CPI steps.");
    }
    await this.open();
    const mem = await this.readProfileMemory();
    const profile = weDecodeProfile(mem);
    wePatchActiveDpi(mem, dpi, profile.activeDpiLevel);
    const off = WE_OFF.dpiStages + profile.activeDpiLevel * WE_OFF.dpiStageBytes;
    await this.writeEeprom(off, [...mem.subarray(off, off + WE_OFF.dpiStageBytes)]);
    const confirmed = weDecodeProfile(await this.readProfileMemory());
    if (confirmed.dpi !== dpi) {
      throw new Error(`The mouse kept ${confirmed.dpi} CPI instead of ${dpi} CPI.`);
    }
    return confirmed.dpi;
  }

  async setPollingRate(rate: number): Promise<number> {
    if (!weIsValidPollingRate(rate)) {
      throw new Error("OP1we supports 125, 250, 500, or 1000 Hz report rate.");
    }
    await this.open();
    const encoded = weEncodeReportRate(rate);
    const [v, c] = wePackScalarPair(encoded);
    await this.writeEeprom(WE_OFF.reportRate, [v, c]);
    const confirmed = weDecodeProfile(await this.readProfileMemory());
    if (confirmed.pollingRateHz !== rate) {
      throw new Error(
        `The mouse kept ${confirmed.pollingRateHz.toLocaleString()} Hz instead of ${rate.toLocaleString()} Hz.`,
      );
    }
    return confirmed.pollingRateHz;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    if (value === "Low") {
      throw new Error("The OP1we supports Medium or High lift-off distance only.");
    }
    const raw = weEncodeLod(value as WeLod);
    await this.open();
    const [v, c] = wePackScalarPair(raw);
    await this.writeEeprom(WE_OFF.lod, [v, c]);
    const profile = weDecodeProfile(await this.readProfileMemory());
    if (profile.lod !== value) {
      throw new Error(`The mouse kept ${profile.lod ?? "unknown"} LOD instead of ${value}.`);
    }
  }

  async setDebounceTime(milliseconds: number): Promise<number> {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 20) {
      throw new Error("OP1we debounce must be an integer from 0 to 20 ms.");
    }
    await this.open();
    const [v, c] = wePackScalarPair(milliseconds);
    await this.writeEeprom(WE_OFF.debounce, [v, c]);
    const profile = weDecodeProfile(await this.readProfileMemory());
    if (profile.debounceMs !== milliseconds) {
      throw new Error(
        `The mouse kept ${profile.debounceMs ?? "unknown"} ms debounce instead of ${milliseconds} ms.`,
      );
    }
    return milliseconds;
  }

  async close(): Promise<void> {
    if (this.responseWaiter) {
      window.clearTimeout(this.responseWaiter.timer);
      this.responseWaiter.reject(new Error("The OP1we device was closed."));
      this.responseWaiter = null;
    }
    const notify = this.notifyDevice;
    if (notify) notify.removeEventListener("inputreport", this.onInputReport);
    const unique = new Set<HIDDevice>([
      this.device,
      ...(this.cmdDevice ? [this.cmdDevice] : []),
      ...(this.notifyDevice ? [this.notifyDevice] : []),
    ]);
    for (const device of unique) {
      if (device.opened) await device.close().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Profile EEPROM
  // ---------------------------------------------------------------------------

  private async readProfile(): Promise<WeProfile> {
    return weDecodeProfile(await this.readProfileMemory());
  }

  private async readProfileMemory(): Promise<Uint8Array> {
    const mem = new Uint8Array(PROFILE_END);
    let addr = 0;
    while (addr < PROFILE_END) {
      const len = Math.min(WE_MAX_EEPROM_CHUNK, PROFILE_END - addr);
      const chunk = await this.readEeprom(addr, len);
      mem.set(chunk, addr);
      addr += len;
      // Space RF commands on the dongle so the cursor does not stall.
      if (this.isWirelessPath() && addr < PROFILE_END) {
        await this.delay(WIRELESS_EEPROM_GAP_MS);
      }
    }
    return mem;
  }

  private async readEeprom(addr: number, length: number): Promise<Uint8Array> {
    const channels = this.requireChannels();
    const payload = weBuildReadEepromPayload(addr, length);
    const response = await this.transact(channels, WE_CMD_READ_EEPROM, payload);
    const data = weParseReadEepromResponse(response, addr, length);
    if (!data) {
      throw new Error(
        `OP1we ReadEEPROM failed at 0x${addr.toString(16)} len=${length} `
        + `raw=[${this.toHex(response)}]`,
      );
    }
    return data;
  }

  private async writeEeprom(addr: number, data: number[]): Promise<void> {
    const channels = this.requireChannels();
    const payload = weBuildWriteEepromPayload(addr, data);
    const response = await this.transact(channels, WE_CMD_WRITE_EEPROM, payload);
    if (!weParseWriteEepromResponse(response)) {
      throw new Error(
        `OP1we WriteEEPROM failed at 0x${addr.toString(16)} raw=[${this.toHex(response)}]`,
      );
    }
    if (this.isWirelessPath()) await this.delay(WIRELESS_EEPROM_GAP_MS);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  // ---------------------------------------------------------------------------
  // GetPower + transport
  // ---------------------------------------------------------------------------

  private productMeta(): { name: string; wired: boolean; viaReceiver: boolean } {
    const viaReceiver = EggWeHidClient.isReceiverDevice(this.device);
    const other = OTHER_WE_MOUSE_PIDS.get(this.device.productId);
    const name = other
      ?? (OP1WE_CABLE_PIDS.has(this.device.productId)
        || OP1WE_RECEIVER_PIDS.has(this.device.productId)
        || /op1\s*we|we series/i.test(this.device.productName || "")
        ? "Endgame Gear OP1we"
        : (this.device.productName?.replace(/\s*(receiver|dongle)\s*/ig, " ").trim()
          || "Endgame Gear WE mouse"));
    return { name, wired: !viaReceiver, viaReceiver };
  }

  private requireChannels(): WeChannels {
    const channels = this.resolvedChannels();
    if (!channels) {
      throw new Error(
        "OP1we vendor channels missing. Authorize FF02 (command) and FF01 (notify).",
      );
    }
    return channels;
  }

  private resolvedChannels(): WeChannels | null {
    if (!this.cmdDevice || !EggWeHidClient.hasCmdChannel(this.cmdDevice)) return null;
    const notify = this.notifyDevice
      ?? (EggWeHidClient.hasNotifyChannel(this.cmdDevice) ? this.cmdDevice : null);
    if (!notify) return null;
    return { cmd: this.cmdDevice, notify };
  }

  private async readBatteryOnce(): Promise<{
    percent: number | null;
    state: MouseStatus["batteryState"];
  }> {
    try {
      const channels = this.requireChannels();
      const payload = weBuildCmdPayload(WE_CMD_GET_POWER);
      const response = await this.transact(channels, WE_CMD_GET_POWER, payload);
      const parsed = this.parseGetPowerResponse(response);
      if (parsed.percent === null) return { percent: null, state: "Unknown" };
      if (parsed.charging) {
        return { percent: parsed.percent, state: parsed.percent >= 99 ? "Full" : "Charging" };
      }
      return { percent: parsed.percent, state: parsed.percent >= 99 ? "Full" : "Discharging" };
    } catch {
      return { percent: null, state: "Unknown" };
    }
  }

  private parseGetPowerResponse(response: Uint8Array): {
    percent: number | null;
    charging: boolean;
  } {
    let data = response;
    if (data[0] === REPORT_NOTIFY && data.byteLength > WE_PAYLOAD_LEN - 1) {
      data = data.subarray(1);
    }
    if (data.byteLength < 7) return { percent: null, charging: false };
    if (data[0] !== WE_CMD_GET_POWER || data[1] !== 0) return { percent: null, charging: false };
    const power = data[5];
    if (power === undefined || power > 100) return { percent: null, charging: false };
    return { percent: power, charging: (data[6] ?? 0) !== 0 };
  }

  private async transact(
    channels: WeChannels,
    command: number,
    payload: Uint8Array,
  ): Promise<Uint8Array> {
    if (this.responseWaiter) {
      window.clearTimeout(this.responseWaiter.timer);
      this.responseWaiter.reject(new Error("Superseded by another OP1we request."));
      this.responseWaiter = null;
    }

    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.responseWaiter?.resolve === resolve) this.responseWaiter = null;
        reject(new Error(`Timed out waiting for OP1we cmd 0x${command.toString(16)}.`));
      }, CMD_TIMEOUT_MS);
      this.responseWaiter = { command, resolve, reject, timer };
    });

    channels.notify.removeEventListener("inputreport", this.onInputReport);
    channels.notify.addEventListener("inputreport", this.onInputReport);

    const body = payload.byteLength === WE_PAYLOAD_LEN
      ? payload
      : (() => { throw new Error("WE payload must be 16 bytes."); })();
    // Ensure ArrayBuffer-backed view for WebHID typings.
    const copy = new Uint8Array(body);
    try {
      await channels.cmd.sendFeatureReport(WE_REPORT_ID, copy.buffer);
    } catch (error) {
      const waiter = this.responseWaiter as {
        reject: (reason: Error) => void;
        timer: number;
      } | null;
      if (waiter) {
        window.clearTimeout(waiter.timer);
        this.responseWaiter = null;
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return responsePromise;
  }

  private toHex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  }

  // ---------------------------------------------------------------------------
  // Descriptor helpers
  // ---------------------------------------------------------------------------

  private static hasCmdChannel(device: HIDDevice): boolean {
    const pages = this.usagePages(device);
    if (pages.has(USAGE_PAGE_CMD)) return true;
    return this.listFeatureReports(device)
      .some((report) => report.reportId === WE_REPORT_ID && report.payloadLength >= 15);
  }

  private static hasNotifyChannel(device: HIDDevice): boolean {
    const pages = this.usagePages(device);
    if (pages.has(USAGE_PAGE_NOTIFY)) return true;
    return this.listInputReports(device)
      .some((report) => report.reportId === REPORT_NOTIFY && report.payloadLength >= 15);
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

  private static listFeatureReports(device: HIDDevice): ReportTarget[] {
    return this.listReports(device, "featureReports");
  }

  private static listInputReports(device: HIDDevice): ReportTarget[] {
    return this.listReports(device, "inputReports");
  }

  private static listReports(
    device: HIDDevice,
    kind: "featureReports" | "outputReports" | "inputReports",
  ): ReportTarget[] {
    const found: ReportTarget[] = [];
    const visit = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        for (const report of collection[kind]) {
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
}

// Re-export protocol helpers for tests / tooling that import the client module.
export {
  weBuildCmdPayload,
  weBuildReadEepromPayload,
  weBuildWriteEepromPayload,
  weDecodeProfile,
  wePackDpiStage,
  weUnpackDpiStage,
  wePackScalarPair,
  weReportChecksum,
  weCpiToByte,
  weByteToCpi,
  weParseReadEepromResponse,
  weParseWriteEepromResponse,
  wePatchActiveDpi,
} from "./egg-we-protocol";
