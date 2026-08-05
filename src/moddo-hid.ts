import type { MouseStatus } from "./mouse-types";

/**
 * moddoMOUSE (moddo.io) vendor HID control.
 *
 * Transport: vendor usage page 0xFF, usage 0x01 (or legacy 0x02) under VID 0x2FE3.
 * Settings live in one packed feature report (id 0x02) — no CBOR:
 *   [ pollingHz u16le | lift u8 | dpiX u16le | dpiY u16le | invert/swap u8 | angle i16le | deepSleep u8 ]
 * Battery is feature report 0x04; firmware version + connection path (wireless
 * dongle vs. wired) come from feature report 0x03. Only documented settings are
 * touched here — no firmware flashing, wireless pairing, or button remapping.
 *
 * Report layout mirrors moddoHUB-Web (js/main.js, js/battery.js, js/firmware.js).
 */

const MODDO_VENDOR_ID = 0x2fe3;
const USAGE_PAGE_VENDOR = 0xff;
const USAGE_VENDOR_CONFIG = 0x01;
const USAGE_VENDOR_CONFIG_LEGACY = 0x02;

const REPORT_CONFIG = 0x02;
const REPORT_FW_INFO = 0x03;
const REPORT_BATTERY = 0x04;

/** Packed config-report field offsets (into the payload, i.e. after the report-id byte). */
const CONFIG = {
  polling: 0, // u16 LE — report rate in Hz
  lift: 2, // u8 — 1 = 1 mm, 2 = 2 mm
  dpiX: 3, // u16 LE
  dpiY: 5, // u16 LE
  invertSwap: 7, // u8 — preserved across writes
  angle: 8, // i16 LE — preserved across writes
  deepSleep: 10, // u8 — preserved across writes
} as const;
const CONFIG_REPORT_SIZE = 11;

const SUPPORTED_POLLING_RATES = [125, 250, 500, 1000] as const;
const DPI_MIN = 50;
const DPI_MAX = 26000;
const DPI_STEP = 50;

// The firmware applies config writes fire-and-forget, so a read-back can briefly
// still show the old value (especially over the 2.4 GHz dongle). Settle and retry
// before deciding a write failed.
const WRITE_SETTLE_MS = 60;
const WRITE_CONFIRM_ATTEMPTS = 5;

// Battery status codes and charger flags (js/battery.js).
const BATTERY_CHARGING = 0x44;
const BATTERY_DISCHARGING = 0x45;
const BATTERY_FULLY_CHARGED = 0x46;
const BATTERY_FULLY_DISCHARGED = 0x47;
const CHARGER_BATTERY_PRESENT_BIT = 1 << 0;

interface ModdoConfig {
  polling: number;
  lift: number;
  dpiX: number;
  dpiY: number;
  invertSwap: number;
  angle: number;
  deepSleep: number;
}

interface ModdoFirmware {
  mouse: string | null;
  dongle: string | null;
  dongleConnected: boolean;
}

export class ModdoHidClient {
  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== MODDO_VENDOR_ID) return false;
    const hasVendorConfig = (collections: readonly HIDCollectionInfo[]): boolean =>
      collections.some((collection) =>
        (collection.usagePage === USAGE_PAGE_VENDOR
          && (collection.usage === USAGE_VENDOR_CONFIG || collection.usage === USAGE_VENDOR_CONFIG_LEGACY))
        || hasVendorConfig(collection.children));
    return hasVendorConfig(device.collections);
  }

  get supportedPollingRates(): number[] {
    return [...SUPPORTED_POLLING_RATES];
  }

  getDpiOptions(): number[] {
    const values: number[] = [];
    for (let dpi = DPI_MIN; dpi <= DPI_MAX; dpi += DPI_STEP) values.push(dpi);
    return values;
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    // readConfig rejects a zeroed/asleep report, so a null here means "not ready"
    // and the grid stays hidden instead of showing 0 DPI / 0 Hz.
    const config = await this.readConfig().catch(() => null);
    const battery = await this.readBattery().catch(
      () => ({ percent: null, state: "Unknown" as MouseStatus["batteryState"] }),
    );
    const firmware = await this.readFirmware().catch(() => null);
    const wireless = firmware?.dongleConnected ?? false;

    return {
      brand: "moddoMOUSE",
      name: "moddoMOUSE",
      ui: {
        family: "moddo",
        settingsReady: config !== null,
        hideLodLow: true,
        hideUnsupportedPollingRates: true,
        hideProcessingCard: true,
        defaultDisplayName: "moddoMOUSE",
      },
      batteryPercent: battery.percent,
      batteryState: battery.state,
      dpi: config?.dpiX ?? 1600,
      dpiY: config?.dpiY ?? config?.dpiX ?? 1600,
      pollingRateHz: config?.polling ?? 1000,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: wireless ? "2.4 GHz receiver" : "USB",
      liftOffDistance: this.decodeLift(config?.lift),
      firmware: this.firmwareLines(firmware),
    };
  }

  async setDpi(dpi: number, dpiY: number = dpi): Promise<number> {
    for (const value of [dpi, dpiY]) {
      if (!this.isValidDpi(value)) {
        throw new Error(
          `moddoMOUSE DPI must be ${DPI_MIN}–${DPI_MAX.toLocaleString()} in ${DPI_STEP} DPI steps.`,
        );
      }
    }
    await this.open();
    const config = await this.readConfig();
    await this.writeConfig({ ...config, dpiX: dpi, dpiY });
    const confirmed = await this.confirmConfig((c) => c.dpiX === dpi && c.dpiY === dpiY);
    if (confirmed.dpiX !== dpi || confirmed.dpiY !== dpiY) {
      throw new Error(`The mouse kept ${confirmed.dpiX.toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
    }
    return confirmed.dpiX;
  }

  async setPollingRate(rate: number): Promise<number> {
    if (!(SUPPORTED_POLLING_RATES as readonly number[]).includes(rate)) {
      throw new Error("moddoMOUSE supports 125, 250, 500, or 1000 Hz report rate.");
    }
    await this.open();
    const config = await this.readConfig();
    await this.writeConfig({ ...config, polling: rate });
    const confirmed = await this.confirmConfig((c) => c.polling === rate);
    if (confirmed.polling !== rate) {
      throw new Error(
        `The mouse kept ${confirmed.polling.toLocaleString()} Hz instead of ${rate.toLocaleString()} Hz.`,
      );
    }
    return confirmed.polling;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    if (value === "Low") {
      throw new Error("The moddoMOUSE supports 1 mm (Medium) or 2 mm (High) lift-off distance.");
    }
    const encoded = value === "Medium" ? 1 : 2;
    await this.open();
    const config = await this.readConfig();
    await this.writeConfig({ ...config, lift: encoded });
    const confirmed = await this.confirmConfig((c) => c.lift === encoded);
    if (confirmed.lift !== encoded) {
      throw new Error(
        `The mouse kept ${this.decodeLift(confirmed.lift) ?? "an unknown"} lift-off distance instead of ${value}.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Report helpers
  // ---------------------------------------------------------------------------

  private isValidDpi(dpi: number): boolean {
    return Number.isInteger(dpi) && dpi >= DPI_MIN && dpi <= DPI_MAX && dpi % DPI_STEP === 0;
  }

  private decodeLift(raw: number | undefined): MouseStatus["liftOffDistance"] {
    if (raw === 1) return "Medium";
    if (raw === 2) return "High";
    return null;
  }

  private async readConfig(): Promise<ModdoConfig> {
    const view = this.payload(await this.device.receiveFeatureReport(REPORT_CONFIG));
    // Need at least polling + lift + both DPI axes (through offset 6).
    if (view.byteLength < 7) throw new Error("moddoMOUSE returned a truncated config report.");
    const u8 = (offset: number): number => (offset < view.byteLength ? view.getUint8(offset) : 0);
    const i16 = (offset: number): number => (offset + 2 <= view.byteLength ? view.getInt16(offset, true) : 0);
    const config: ModdoConfig = {
      polling: view.getUint16(CONFIG.polling, true),
      lift: view.getUint8(CONFIG.lift),
      dpiX: view.getUint16(CONFIG.dpiX, true),
      dpiY: view.getUint16(CONFIG.dpiY, true),
      invertSwap: u8(CONFIG.invertSwap),
      angle: i16(CONFIG.angle),
      deepSleep: u8(CONFIG.deepSleep),
    };
    // An asleep/off wireless mouse answers with a zeroed report. Reject it so the
    // UI never shows 0 DPI / 0 Hz and a read-modify-write can't persist zeros.
    if (config.polling <= 0 || config.dpiX < DPI_MIN || config.dpiX > DPI_MAX) {
      throw new Error("moddoMOUSE settings are not ready yet — wake the mouse and try again.");
    }
    return config;
  }

  /** Re-read the config until it matches, tolerating fire-and-forget write latency. */
  private async confirmConfig(matches: (config: ModdoConfig) => boolean): Promise<ModdoConfig> {
    let config = await this.readConfig();
    for (let attempt = 1; attempt < WRITE_CONFIRM_ATTEMPTS && !matches(config); attempt += 1) {
      await this.delay(WRITE_SETTLE_MS);
      config = await this.readConfig();
    }
    return config;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  private async writeConfig(config: ModdoConfig): Promise<void> {
    const buffer = new ArrayBuffer(CONFIG_REPORT_SIZE);
    const view = new DataView(buffer);
    view.setUint16(CONFIG.polling, config.polling, true);
    view.setUint8(CONFIG.lift, config.lift);
    view.setUint16(CONFIG.dpiX, config.dpiX, true);
    view.setUint16(CONFIG.dpiY, config.dpiY, true);
    view.setUint8(CONFIG.invertSwap, config.invertSwap);
    view.setInt16(CONFIG.angle, config.angle, true);
    view.setUint8(CONFIG.deepSleep, config.deepSleep);
    await this.device.sendFeatureReport(REPORT_CONFIG, new Uint8Array(buffer));
  }

  private async readBattery(): Promise<{ percent: number | null; state: MouseStatus["batteryState"] }> {
    const view = this.payload(await this.device.receiveFeatureReport(REPORT_BATTERY));
    if (view.byteLength < 4) return { percent: null, state: "Unknown" };
    const remaining = view.getUint8(0);
    const status = view.getUint8(2);
    const chargerStatus = view.getUint8(3);
    if ((chargerStatus & CHARGER_BATTERY_PRESENT_BIT) === 0) {
      // No cell present (e.g. a wired mouse) — surface an empty battery column.
      return { percent: null, state: "Unknown" };
    }
    const percent = remaining > 100 ? null : remaining;
    const state: MouseStatus["batteryState"] = status === BATTERY_CHARGING
      ? "Charging"
      : status === BATTERY_FULLY_CHARGED
        ? "Full"
        : status === BATTERY_DISCHARGING || status === BATTERY_FULLY_DISCHARGED
          ? "Discharging"
          : "Unknown";
    return { percent, state };
  }

  private async readFirmware(): Promise<ModdoFirmware> {
    const view = this.payload(await this.device.receiveFeatureReport(REPORT_FW_INFO));
    // First 8 bytes: dongle (rx) then mouse (tx) major.minor.patch.build.
    if (view.byteLength < 8) return { mouse: null, dongle: null, dongleConnected: false };
    const version = (offset: number): { text: string; present: boolean } => {
      const major = view.getUint8(offset);
      const minor = view.getUint8(offset + 1);
      const patch = view.getUint8(offset + 2);
      const build = view.getUint8(offset + 3);
      const present = !(major === 0 && minor === 0 && patch === 0 && build === 0);
      return { text: `${major}.${minor}.${patch}`, present };
    };
    const dongle = version(0);
    const mouse = version(4);
    return {
      mouse: mouse.present ? mouse.text : null,
      dongle: dongle.present ? dongle.text : null,
      dongleConnected: dongle.present,
    };
  }

  private firmwareLines(firmware: ModdoFirmware | null): string[] {
    const lines = [firmware?.mouse ? `Mouse v${firmware.mouse}` : "Mouse firmware unavailable"];
    if (firmware?.dongle) lines.push(`Dongle v${firmware.dongle}`);
    return lines;
  }

  /** WebHID feature reports carry the report id as byte 0; return a view past it. */
  private payload(view: DataView): DataView {
    return new DataView(view.buffer, view.byteOffset + 1, Math.max(0, view.byteLength - 1));
  }
}
