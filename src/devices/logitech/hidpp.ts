import type { MouseStatus } from "../mouse-types";
import { withSoftwareId } from "./protocol";
import {
  MODE_STATUS,
  buildModeStatusWrite,
  decodeModeStatus,
  type GamingSurfaceMode,
  type LightforceSwitchMode,
  type ModeStatusField,
} from "./mode-status";

const LOGITECH_VENDOR_ID = 0x046d;
// HID++ control interfaces, including the PRO X 2 Superstrike USB interface.
const LOGITECH_RECEIVER_PRODUCT_IDS = new Set([0xc54d, 0xc539, 0xc0a8]);
const SHORT_REPORT_ID = 0x10;
const LONG_REPORT_ID = 0x11;
const DEVICE_INDEX = 0x01;
const FEATURE = {
  deviceName: 0x0005,
  firmware: 0x0003,
  unifiedBattery: 0x1004,
  batteryVoltage: 0x1001,
  adcMeasurement: 0x1f20,
  extendedDpi: 0x2202,
  extendedReportRate: 0x8061,
  modeStatus: 0x8090,
  // Legacy features used by HERO-era mice (e.g. G502 HERO / LIGHTSPEED,
  // Proteus). Queried only when the extended equivalents are absent.
  adjustableDpi: 0x2201,
  reportRate: 0x8060,
  onboardProfiles: 0x8100,
  analogButtons: 0x1b0c,
} as const;

interface ResolvedFeature {
  index: number;
  legacy: boolean;
}

const REPORT_RATE_HZ = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

export type LogitechMouseStatus = MouseStatus;

interface BatteryReading {
  percent: number | null;
  state: LogitechMouseStatus["batteryState"];
  voltageMv?: number | null;
}

const BATTERY_VOLTAGE_CURVE = [
  [4186, 100], [4067, 90], [3989, 80], [3922, 70], [3859, 60],
  [3811, 50], [3778, 40], [3751, 30], [3717, 20], [3671, 10],
  [3646, 5], [3579, 2], [3500, 0],
] as const;

interface FeatureInfo {
  index: number;
  version: number;
}

interface DpiConfiguration {
  x: number;
  y: number;
  lod: number;
}

interface AnalogButtonTuning {
  maxActuation: number;
  maxRapidTrigger: number;
  maxHaptics: number;
  buttons: Array<{ actuation: number; rapidTrigger: number; haptics: number }>;
}

interface DeviceIdentity {
  unitId: string | null;
  modelId: string | null;
  transportIds: Record<string, string>;
}

export class LogitechHidppClient {
  private dpiOptionsCache: number[] | null = null;
  private dpiFeatureResolved: ResolvedFeature | null = null;
  private rateFeatureResolved: ResolvedFeature | null = null;
  private reportRateFeatureIndex: number | null = null;
  private livePollingRateHz: number | null = null;
  private isSuperstrikeDevice = false;
  private readonly rateChangeWaiters: Array<{ rate: number; resolve: () => void; reject: (reason: Error) => void }> = [];
  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (event.reportId !== SHORT_REPORT_ID && event.reportId !== LONG_REPORT_ID) {
      return;
    }

    const report = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
    if (report[0] === DEVICE_INDEX && report[1] === this.reportRateFeatureIndex && report[2] === 0x00 && report[3] === 0x01) {
      const rate = REPORT_RATE_HZ[report[4] ?? -1];
      if (rate) {
        this.livePollingRateHz = rate;
        const matchingRateWaiters = this.rateChangeWaiters.filter((waiter) => waiter.rate === rate);
        this.rateChangeWaiters.splice(0, this.rateChangeWaiters.length, ...this.rateChangeWaiters.filter((waiter) => waiter.rate !== rate));
        matchingRateWaiters.forEach((waiter) => waiter.resolve());
      }
    }
    const matchingIndex = this.waiters.findIndex(
      (waiter) => report[0] === DEVICE_INDEX
        && report[1] === waiter.featureIndex
        && report[2] === withSoftwareId(waiter.functionId),
    );
    if (matchingIndex >= 0) {
      this.waiters.splice(matchingIndex, 1)[0].resolve(report);
      return;
    }

    // HID++ can emit a status notification between a write acknowledgement and
    // the matching read response. Leave the pending request in place and wait.
    if (report[0] === DEVICE_INDEX && report[1] === 0xff) {
      const failedIndex = this.waiters.findIndex(
        (waiter) => report[2] === waiter.featureIndex && report[3] === withSoftwareId(waiter.functionId),
      );
      if (failedIndex >= 0) {
        this.waiters.splice(failedIndex, 1)[0].reject(new Error("The mouse rejected that setting."));
      }
    }
  };

  private readonly waiters: Array<{
    featureIndex: number;
    functionId: number;
    resolve: (report: Uint8Array) => void;
    reject: (reason: Error) => void;
  }> = [];

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== LOGITECH_VENDOR_ID || !LOGITECH_RECEIVER_PRODUCT_IDS.has(device.productId)) {
      return false;
    }
    const hasHidppCollection = (collections: readonly HIDCollectionInfo[]): boolean =>
      collections.some((collection) =>
        (collection.usagePage === 0xff00 && collection.usage === 0x0001)
        || hasHidppCollection(collection.children));
    return hasHidppCollection(device.collections);
  }

  static async requestReceiver(): Promise<LogitechHidppClient | null> {
    if (!navigator.hid) {
      throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
    }

    const devices = await navigator.hid.requestDevice({
      filters: [...LOGITECH_RECEIVER_PRODUCT_IDS].map((productId) => ({
        vendorId: LOGITECH_VENDOR_ID,
        productId,
        usagePage: 0xff00,
        usage: 0x0001,
      })),
    });
    const device = devices[0];
    return device ? new LogitechHidppClient(device) : null;
  }

  static async reconnectAuthorizedReceiver(): Promise<LogitechHidppClient | null> {
    if (!navigator.hid) {
      return null;
    }

    const devices = await navigator.hid.getDevices();
    const device = devices.find((candidate) => this.isSupported(candidate));
    return device ? new LogitechHidppClient(device) : null;
  }

  async readStatus(): Promise<LogitechMouseStatus> {
    await this.open();

    const nameFeature = await this.getFeature(FEATURE.deviceName);
    const firmwareFeature = await this.getFeature(FEATURE.firmware);
    const batteryFeature = await this.getFeature(FEATURE.unifiedBattery);
    const batteryVoltageFeature = await this.getFeature(FEATURE.batteryVoltage);
    const adcMeasurementFeature = await this.getFeature(FEATURE.adcMeasurement);
    const dpiFeature = await this.resolveDpiFeature();
    const reportRateFeature = await this.resolveReportRateFeature();
    const profilesFeature = await this.getFeature(FEATURE.onboardProfiles);
    const analogButtonsFeature = await this.getFeature(FEATURE.analogButtons);

    // HID++ receivers expect one request at a time. Keeping the sequence serial
    // also makes every input report unambiguous to the WebHID event handler.
    const name = await this.readName(nameFeature.index);
    const identity = await this.readIdentity(firmwareFeature.index);
    const battery = batteryFeature.index
      ? await this.readBattery(batteryFeature.index)
      : batteryVoltageFeature.index
        ? await this.readBatteryVoltage(batteryVoltageFeature.index)
        : adcMeasurementFeature.index
          ? await this.readAdcMeasurement(adcMeasurementFeature.index)
        : { percent: null, state: "Unknown" as const, voltageMv: null };
    if (batteryVoltageFeature.index && battery.voltageMv === undefined) {
      battery.voltageMv = (await this.readBatteryVoltage(batteryVoltageFeature.index)).voltageMv;
    } else if (adcMeasurementFeature.index && battery.voltageMv === undefined) {
      battery.voltageMv = (await this.readAdcMeasurement(adcMeasurementFeature.index)).voltageMv;
    }
    const dpiState = dpiFeature.legacy
      ? await this.readLegacyDpi(dpiFeature.index)
      : await this.readDpi(dpiFeature.index);
    const supportsSeparateDpiAxes = dpiFeature.legacy
      ? false
      : await this.readDpiCapabilities(dpiFeature.index);
    const supportedPollingRates = reportRateFeature.legacy
      ? await this.readLegacyReportRates(reportRateFeature.index)
      : await this.readSupportedPollingRates(reportRateFeature.index);
    const pollingRateHz = reportRateFeature.legacy
      ? await this.readLegacyReportRate(reportRateFeature.index)
      : await this.readPollingRate(reportRateFeature.index);
    const profileState = await this.readProfileState(profilesFeature.index);
    const firmware = await this.readFirmware(firmwareFeature.index);
    const analogButtonTuning = analogButtonsFeature.index
      ? await this.readAnalogButtonTuning(analogButtonsFeature.index)
      : undefined;
    const modeStatusFeature = await this.getFeature(FEATURE.modeStatus);
    const modeStatus = modeStatusFeature.index ? await this.readModeStatus(modeStatusFeature.index) : null;
    const isSuperstrike = this.isSuperstrike(identity);
    this.isSuperstrikeDevice = isSuperstrike;
    const wired = this.device.productId === 0xc0a8;

    return {
      brand: "Logitech",
      name,
      ui: {
        family: "logitech-hidpp",
        // Logitech allows Lift-off Distance modification only when Gaming Surface Mode is set to "on" or "auto"
        lodRequiresSurface: true,
      },
      batteryPercent: battery.percent,
      batteryVoltageMv: battery.voltageMv ?? null,
      batteryState: battery.state,
      dpi: dpiState.dpi,
      dpiY: dpiState.dpiY,
      supportsSeparateDpiAxes,
      analogButtonTuning,
      liftOffDistance: dpiState.liftOffDistance,
      gamingSurfaceMode: modeStatus === null ? null : decodeModeStatus(modeStatus, MODE_STATUS.gamingSurface),
      lightforceSwitchMode: modeStatus === null ? null : decodeModeStatus(modeStatus, MODE_STATUS.lightforce),
      // The USB connection exposes the Superstrike as a 1 kHz device. Its
      // Lightspeed receiver can use the higher rates advertised by HID++.
      pollingRateHz: isSuperstrike && wired ? Math.min(pollingRateHz, 1000) : pollingRateHz,
      supportedPollingRates: isSuperstrike && wired
        ? supportedPollingRates.filter((rate) => rate <= 1000)
        : supportedPollingRates,
      supportedLiftOffDistances: isSuperstrike ? ["Low", "High"] : undefined,
      connectionType: wired ? "Wired" : "Wireless",
      activeProfile: profileState.activeProfile,
      deviceMode: profileState.deviceMode,
      unitId: identity.unitId,
      modelId: identity.modelId,
      transportIds: identity.transportIds,
      firmware,
    };
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    if (this.device.opened) {
      await this.device.close();
    }
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    if (this.isSuperstrikeDevice && this.device.productId === 0xc0a8 && pollingRateHz > 1000) {
      throw new Error("The Superstrike USB connection supports up to 1000 Hz. Use the Lightspeed receiver for higher rates.");
    }
    const resolved = await this.resolveReportRateFeature();
    if (resolved.legacy) {
      return this.setLegacyReportRate(resolved.index, pollingRateHz);
    }
    const rateIndex = REPORT_RATE_HZ.indexOf(pollingRateHz as (typeof REPORT_RATE_HZ)[number]);
    if (rateIndex < 0) {
      throw new Error("Unsupported polling rate.");
    }

    await this.ensureHostControl();
    const feature = await this.getFeature(FEATURE.extendedReportRate);
    if (!feature.index) {
      throw new Error("This mouse does not expose report-rate controls.");
    }
    const confirmation = this.waitForRateChange(pollingRateHz);
    await this.request(feature.index, 0x30, rateIndex);
    await confirmation;
    return pollingRateHz;
  }

  async getDpiOptions(): Promise<number[]> {
    if (this.dpiOptionsCache) {
      return this.dpiOptionsCache;
    }
    const resolved = await this.resolveDpiFeature();
    if (!resolved.index) {
      throw new Error("This mouse does not expose DPI controls.");
    }
    if (resolved.legacy) {
      this.dpiOptionsCache = await this.readLegacyDpiList(resolved.index);
      return this.dpiOptionsCache;
    }
    const feature = { index: resolved.index };

    const bytes: number[] = [];
    for (let page = 0; page < 32; page += 1) {
      const reply = await this.request(feature.index, 0x20, 0x00, 0x00, page);
      bytes.push(...reply.slice(6));
      if (bytes.some((value, index) => index > 0 && bytes[index - 1] === 0 && value === 0)) {
        break;
      }
    }

    const options: number[] = [];
    for (let index = 0; index + 1 < bytes.length; ) {
      const value = (bytes[index] << 8) | bytes[index + 1];
      if (value === 0) break;
      if (value >> 13 === 0b111) {
        const step = value & 0x1fff;
        const last = ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0);
        const first = options.at(-1);
        if (!first || !last || last <= first) {
          throw new Error("The mouse returned an invalid DPI range.");
        }
        for (let dpi = first + step; dpi <= last; dpi += step) options.push(dpi);
        index += 4;
      } else {
        options.push(value);
        index += 2;
      }
    }
    this.dpiOptionsCache = options;
    return options;
  }

  async setDpi(dpi: number, dpiY = dpi): Promise<number> {
    const resolved = await this.resolveDpiFeature();
    if (resolved.legacy) {
      const legacyOptions = await this.getDpiOptions();
      if (!legacyOptions.includes(dpi)) {
        throw new Error(`${dpi} DPI is not advertised by this mouse.`);
      }
      return this.setLegacyDpi(resolved.index, dpi);
    }
    const options = await this.getDpiOptions();
    if (!options.includes(dpi) || !options.includes(dpiY)) {
      throw new Error(`${dpi}/${dpiY} DPI is not advertised by this mouse.`);
    }

    await this.ensureHostControl();
    const feature = await this.getFeature(FEATURE.extendedDpi);
    const current = await this.readDpiConfiguration(feature.index);
    await this.requestLong(feature.index, 0x60, [
      0x00,
      dpi >> 8,
      dpi & 0xff,
      dpiY >> 8,
      dpiY & 0xff,
      current.lod,
    ]);
    const confirmed = await this.readDpiConfiguration(feature.index);
    if (confirmed.x !== dpi || confirmed.y !== dpiY) {
      throw new Error(`The mouse kept ${confirmed.x}/${confirmed.y} DPI instead of ${dpi}/${dpiY} DPI.`);
    }
    return confirmed.x;
  }

  async setLiftOffDistance(liftOffDistance: NonNullable<LogitechMouseStatus["liftOffDistance"]>): Promise<NonNullable<LogitechMouseStatus["liftOffDistance"]>> {
    if (liftOffDistance === "Low" && !this.isSuperstrikeDevice) {
      throw new Error("This mouse does not support a Low lift-off distance.");
    }
    if (liftOffDistance === "Medium" && this.isSuperstrikeDevice) {
      throw new Error("The Superstrike supports only Low and High lift-off distance.");
    }
    const lod = ({ Low: 0, Medium: 1, High: 2 } as const)[liftOffDistance];
    await this.ensureHostControl();
    const feature = await this.getFeature(FEATURE.extendedDpi);
    if (!feature.index) {
      throw new Error("This mouse does not expose lift-off-distance controls.");
    }
    const current = await this.readDpiConfiguration(feature.index);
    await this.requestLong(feature.index, 0x60, [
      0x00,
      current.x >> 8,
      current.x & 0xff,
      current.y >> 8,
      current.y & 0xff,
      lod,
    ]);
    const confirmed = await this.readDpiConfiguration(feature.index);
    const result = confirmed.lod === 0 ? "Low" : confirmed.lod === 1 ? "Medium" : confirmed.lod === 2 ? "High" : null;
    if (result !== liftOffDistance) {
      throw new Error(`The mouse kept ${result ?? "an unknown"} lift-off distance instead of ${liftOffDistance}.`);
    }
    return result;
  }

  async setAnalogButtonTuning(button: 0 | 1, tuning: { actuation: number; rapidTrigger: number; haptics: number }): Promise<void> {
    const feature = await this.getFeature(FEATURE.analogButtons);
    if (!feature.index) {
      throw new Error("This Logitech mouse does not expose hall-effect button tuning.");
    }
    const current = await this.readAnalogButtonTuning(feature.index);
    const capabilities = current.buttons[button];
    if (!capabilities) {
      throw new Error("This mouse does not expose tuning for that button.");
    }
    if (!Number.isInteger(tuning.actuation) || tuning.actuation < 1 || tuning.actuation > current.maxActuation
      || !Number.isInteger(tuning.rapidTrigger) || tuning.rapidTrigger < 1 || tuning.rapidTrigger > current.maxRapidTrigger
      || !Number.isInteger(tuning.haptics) || tuning.haptics < 0 || tuning.haptics > current.maxHaptics) {
      throw new Error("One or more hall-effect button values are outside the mouse's supported range.");
    }
    // HID++ 0x1B0C stores logical values in bits 7..2. Bit 0 of rapid trigger
    // is a firmware-managed sensitivity flag, so it must survive the write.
    const currentWire = await this.request(feature.index, 0x20, button);
    await this.requestLong(feature.index, 0x10, [
      button,
      tuning.actuation << 2,
      (tuning.rapidTrigger << 2) | ((currentWire[5] ?? 0) & 0x01),
      tuning.haptics << 2,
    ]);
    const confirmed = await this.readAnalogButtonTuning(feature.index);
    const result = confirmed.buttons[button];
    if (!result || result.actuation !== tuning.actuation || result.rapidTrigger !== tuning.rapidTrigger || result.haptics !== tuning.haptics) {
      throw new Error("The mouse did not confirm the hall-effect button settings.");
    }
  }

  async setGamingSurfaceMode(mode: GamingSurfaceMode): Promise<GamingSurfaceMode> {
    return this.setModeStatusField(MODE_STATUS.gamingSurface, mode, "gaming surface mode");
  }

  async setLightforceSwitchMode(mode: LightforceSwitchMode): Promise<LightforceSwitchMode> {
    return this.setModeStatusField(MODE_STATUS.lightforce, mode, "LightForce switch mode");
  }

  /**
   * Read-modify-write of one field of modeStatus1, then verify.
   * The change mask stops the firmware touching other bits.
   * Reading first keeps this correct if a future field spans bits we do not know about.
   */
  private async setModeStatusField<T extends string>(
    field: ModeStatusField<T>,
    mode: T,
    label: string,
  ): Promise<T> {
    const feature = await this.getFeature(FEATURE.modeStatus);
    if (!feature.index) {
      throw new Error(`This mouse does not expose ${label} controls.`);
    }

    const current = await this.readModeStatus(feature.index);
    if (current === null) {
      throw new Error(`The mouse did not report its current ${label}.`);
    }
    await this.requestLong(feature.index, MODE_STATUS.set, buildModeStatusWrite(current, field, mode));

    const readBack = await this.readModeStatus(feature.index);
    const confirmed = readBack === null ? null : decodeModeStatus(readBack, field);
    if (confirmed !== mode) {
      throw new Error(`The mouse kept ${confirmed ?? "an unknown"} ${label} instead of ${mode}.`);
    }
    return confirmed;
  }

  /** Byte 4 of getModeStatus, carrying both the surface and LightForce fields. */
  private async readModeStatus(featureIndex: number): Promise<number | null> {
    const reply = await this.request(featureIndex, MODE_STATUS.get).catch(() => null);
    return reply ? (reply[4] ?? 0) : null;
  }

  private async open(): Promise<void> {
    if (!this.device.opened) {
      await this.device.open();
    }
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  /** Prefer extended DPI (0x2202); fall back to legacy Adjustable DPI (0x2201). */
  private async resolveDpiFeature(): Promise<ResolvedFeature> {
    if (this.dpiFeatureResolved) return this.dpiFeatureResolved;
    const extended = await this.getFeature(FEATURE.extendedDpi);
    if (extended.index) {
      return (this.dpiFeatureResolved = { index: extended.index, legacy: false });
    }
    const legacy = await this.getFeature(FEATURE.adjustableDpi);
    return (this.dpiFeatureResolved = { index: legacy.index, legacy: true });
  }

  /** Prefer extended report rate (0x8061); fall back to legacy Report Rate (0x8060). */
  private async resolveReportRateFeature(): Promise<ResolvedFeature> {
    if (this.rateFeatureResolved) return this.rateFeatureResolved;
    const extended = await this.getFeature(FEATURE.extendedReportRate);
    if (extended.index) {
      return (this.rateFeatureResolved = { index: extended.index, legacy: false });
    }
    const legacy = await this.getFeature(FEATURE.reportRate);
    return (this.rateFeatureResolved = { index: legacy.index, legacy: true });
  }

  // --- Legacy Adjustable DPI (0x2201) ---------------------------------------
  // These mice expose a single sensor and no adjustable lift-off distance.

  private async readLegacyDpi(featureIndex: number): Promise<{
    dpi: number;
    dpiY: number;
    liftOffDistance: LogitechMouseStatus["liftOffDistance"];
  }> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose DPI controls.");
    }
    // getSensorDpi(sensor 0): reply data = [sensorIdx, dpiHi, dpiLo, defaultHi, defaultLo].
    const reply = await this.request(featureIndex, 0x20, 0x00);
    const dpi = ((reply[4] ?? 0) << 8) | (reply[5] ?? 0);
    return { dpi, dpiY: dpi, liftOffDistance: null };
  }

  private async readLegacyDpiList(featureIndex: number): Promise<number[]> {
    if (!featureIndex) return [];
    // getSensorDpiList(sensor 0): reply data = [sensorIdx, ...uint16 BE values].
    // A value with the top three bits set marks a range: (0xE000 | step), with
    // the previous value as the minimum and the following value as the maximum.
    const reply = await this.request(featureIndex, 0x10, 0x00);
    const bytes = [...reply.slice(4)];
    const options: number[] = [];
    for (let index = 0; index + 1 < bytes.length; ) {
      const value = (bytes[index] << 8) | bytes[index + 1];
      if (value === 0) break;
      if (value >> 13 === 0b111) {
        const step = value & 0x1fff;
        const last = ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0);
        const first = options.at(-1);
        if (!first || !last || last <= first) break;
        for (let dpi = first + step; dpi <= last; dpi += step) options.push(dpi);
        index += 4;
      } else {
        options.push(value);
        index += 2;
      }
    }
    return options;
  }

  private async setLegacyDpi(featureIndex: number, dpi: number): Promise<number> {
    await this.ensureHostControl();
    // setSensorDpi(sensor 0, dpi): params = [sensorIdx, dpiHi, dpiLo].
    await this.requestLong(featureIndex, 0x30, [0x00, dpi >> 8, dpi & 0xff]);
    const confirmed = await this.readLegacyDpi(featureIndex);
    if (confirmed.dpi !== dpi) {
      throw new Error(`The mouse kept ${confirmed.dpi} DPI instead of ${dpi} DPI.`);
    }
    return confirmed.dpi;
  }

  // --- Legacy Report Rate (0x8060) ------------------------------------------
  // Rates are expressed in milliseconds (1 ms = 1000 Hz).

  private async readLegacyReportRates(featureIndex: number): Promise<number[]> {
    if (!featureIndex) return [];
    // getReportRateList: reply data byte 0 is a bitmap where bit i => (i + 1) ms.
    const reply = await this.request(featureIndex, 0x00);
    const bitflags = reply[3] ?? 0;
    const rates: number[] = [];
    for (let bit = 0; bit < 8; bit += 1) {
      if ((bitflags & (1 << bit)) !== 0) rates.push(Math.round(1000 / (bit + 1)));
    }
    return rates.sort((left, right) => left - right);
  }

  private async readLegacyReportRate(featureIndex: number): Promise<number> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose report-rate controls.");
    }
    // getReportRate: reply data byte 0 is the current rate in milliseconds.
    const reply = await this.request(featureIndex, 0x10);
    const rateMs = reply[3] ?? 0;
    if (!rateMs) {
      throw new Error("The mouse returned an unknown report-rate value.");
    }
    return Math.round(1000 / rateMs);
  }

  private async setLegacyReportRate(featureIndex: number, pollingRateHz: number): Promise<number> {
    if (!featureIndex) {
      throw new Error("This mouse does not expose report-rate controls.");
    }
    const rateMs = Math.round(1000 / pollingRateHz);
    if (rateMs < 1 || rateMs > 8) {
      throw new Error("Unsupported polling rate.");
    }
    await this.ensureHostControl();
    // setReportRate(rateMs).
    await this.request(featureIndex, 0x20, rateMs);
    const confirmed = await this.readLegacyReportRate(featureIndex);
    if (confirmed !== pollingRateHz) {
      throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
    }
    return confirmed;
  }

  private async getFeature(featureId: number): Promise<FeatureInfo> {
    const reply = await this.request(0x00, 0x00, featureId >> 8, featureId & 0xff);
    const feature = { index: reply[3] ?? 0, version: reply[6] ?? 0 };
    if (featureId === FEATURE.extendedReportRate) this.reportRateFeatureIndex = feature.index;
    return feature;
  }

  private async readName(featureIndex: number): Promise<string> {
    const header = await this.request(featureIndex, 0x00);
    const nameLength = header[3] ?? 0;
    const fragments: number[] = [];

    for (let offset = 0; offset < nameLength; offset += 16) {
      const reply = await this.request(featureIndex, 0x10, offset);
      fragments.push(...reply.slice(3, 3 + Math.min(16, nameLength - offset)));
    }

    return new TextDecoder().decode(new Uint8Array(fragments));
  }

  private async readBattery(featureIndex: number): Promise<BatteryReading> {
    const reply = await this.request(featureIndex, 0x10);
    const percentage = reply[3];
    const state = ({
      0x00: "Discharging",
      0x01: "Charging",
      0x02: "Almost full",
      0x03: "Full",
      0x04: "Charging slowly",
    } as const)[reply[5] ?? -1] ?? "Unknown";
    return { percent: percentage <= 100 ? percentage : null, state };
  }

  private async readBatteryVoltage(featureIndex: number): Promise<BatteryReading> {
    const reply = await this.request(featureIndex, 0x00);
    const voltageMv = ((reply[3] ?? 0) << 8) | (reply[4] ?? 0);
    const flags = reply[5] ?? 0;
    const charging = (flags & 0x80) !== 0;
    const full = charging && (flags & 0x03) === 0x02;
    const state: BatteryReading["state"] = full
      ? "Full"
      : (flags & 0x10) !== 0
        ? "Charging slowly"
        : charging
          ? "Charging"
          : "Discharging";
    return {
      percent: voltageMv ? this.estimateBatteryPercent(voltageMv) : null,
      state,
      voltageMv: voltageMv || null,
    };
  }

  private async readAdcMeasurement(featureIndex: number): Promise<BatteryReading> {
    const reply = await this.request(featureIndex, 0x00);
    const voltageMv = ((reply[3] ?? 0) << 8) | (reply[4] ?? 0);
    const flags = reply[5] ?? 0;
    if ((flags & 0x01) === 0 || voltageMv === 0) {
      return { percent: null, state: "Unknown", voltageMv: null };
    }
    return {
      percent: this.estimateBatteryPercent(voltageMv),
      state: (flags & 0x02) !== 0 ? "Charging" : "Discharging",
      voltageMv,
    };
  }

  private estimateBatteryPercent(voltageMv: number): number {
    if (voltageMv >= BATTERY_VOLTAGE_CURVE[0][0]) return 100;
    if (voltageMv <= BATTERY_VOLTAGE_CURVE.at(-1)![0]) return 0;
    for (let index = 0; index < BATTERY_VOLTAGE_CURVE.length - 1; index += 1) {
      const [highMv, highPercent] = BATTERY_VOLTAGE_CURVE[index];
      const [lowMv, lowPercent] = BATTERY_VOLTAGE_CURVE[index + 1];
      if (voltageMv >= lowMv) {
        return Math.round(lowPercent + ((highPercent - lowPercent) * (voltageMv - lowMv)) / (highMv - lowMv));
      }
    }
    return 0;
  }

  private async readDpi(featureIndex: number): Promise<{ dpi: number; dpiY: number; liftOffDistance: LogitechMouseStatus["liftOffDistance"] }> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose extended DPI controls.");
    }

    const configuration = await this.readDpiConfiguration(featureIndex);
    const dpi = configuration.x;
    const lod = configuration.lod;
    const liftOffDistance = lod === 0 ? "Low" : lod === 1 ? "Medium" : lod === 2 ? "High" : null;
    return { dpi, dpiY: configuration.y, liftOffDistance };
  }

  private async readAnalogButtonTuning(featureIndex: number): Promise<AnalogButtonTuning> {
    const capabilities = await this.request(featureIndex, 0x00);
    const buttonCount = Math.min(capabilities[4] ?? 0, 2);
    const maxActuation = (capabilities[5] ?? 0) >> 2;
    const maxRapidTrigger = (capabilities[6] ?? 0) >> 2;
    const maxHaptics = (capabilities[7] ?? 0) >> 2;
    if (!buttonCount || !maxActuation || !maxRapidTrigger) {
      throw new Error("The mouse returned invalid hall-effect button capabilities.");
    }
    const buttons: AnalogButtonTuning["buttons"] = [];
    for (let button = 0; button < buttonCount; button += 1) {
      const reply = await this.request(featureIndex, 0x20, button);
      buttons.push({
        actuation: (reply[4] ?? 0) >> 2,
        rapidTrigger: (reply[5] ?? 0) >> 2,
        haptics: (reply[6] ?? 0) >> 2,
      });
    }
    return { maxActuation, maxRapidTrigger, maxHaptics, buttons };
  }

  private async readDpiCapabilities(featureIndex: number): Promise<boolean> {
    if (!featureIndex) return false;
    const reply = await this.request(featureIndex, 0x10, 0x00);
    return ((reply[5] ?? 0) & 0x01) !== 0;
  }

  private async readDpiConfiguration(featureIndex: number): Promise<DpiConfiguration> {
    const reply = await this.request(featureIndex, 0x50);
    const x = ((reply[4] ?? 0) << 8) | (reply[5] ?? 0);
    const y = ((reply[8] ?? 0) << 8) | (reply[9] ?? 0);
    return { x, y, lod: reply[12] ?? 0 };
  }

  private async readSupportedPollingRates(featureIndex: number): Promise<number[]> {
    if (!featureIndex) return [];
    const reply = await this.request(featureIndex, 0x10);
    const flags = ((reply[3] ?? 0) << 8) | (reply[4] ?? 0);
    return REPORT_RATE_HZ.filter((_rate, index) => (flags & (1 << index)) !== 0);
  }

  private async readPollingRate(featureIndex: number): Promise<number> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose extended report-rate controls.");
    }

    const reply = await this.request(featureIndex, 0x20);
    const rate = REPORT_RATE_HZ[reply[3] ?? -1];
    if (!rate) {
      throw new Error("The mouse returned an unknown report-rate value.");
    }
    return this.livePollingRateHz ?? rate;
  }

  private waitForRateChange(rate: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const index = this.rateChangeWaiters.findIndex((waiter) => waiter.reject === reject);
        if (index >= 0) this.rateChangeWaiters.splice(index, 1);
        reject(new Error("The mouse acknowledged the rate write but did not confirm the new active rate."));
      }, 6000);
      this.rateChangeWaiters.push({
        rate,
        resolve: () => {
          window.clearTimeout(timeout);
          resolve();
        },
        reject,
      });
    });
  }

  private async readProfileState(featureIndex: number): Promise<{
    activeProfile: number | null;
    deviceMode: NonNullable<LogitechMouseStatus["deviceMode"]>;
  }> {
    if (!featureIndex) {
      return { activeProfile: null, deviceMode: "Unknown" };
    }

    const mode = await this.request(featureIndex, 0x20);
    if (mode[3] !== 0x01) {
      return { activeProfile: null, deviceMode: mode[3] === 0x02 ? "Host" : "Unknown" };
    }

    const active = await this.request(featureIndex, 0x40);
    return {
      activeProfile: ((active[3] ?? 0) << 8) | (active[4] ?? 0),
      deviceMode: "Onboard",
    };
  }

  private async readIdentity(featureIndex: number): Promise<DeviceIdentity> {
    if (!featureIndex) return { unitId: null, modelId: null, transportIds: {} };
    const reply = await this.request(featureIndex, 0x00);
    const payload = reply.slice(3);
    if (payload.length < 13) return { unitId: null, modelId: null, transportIds: {} };
    const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    const unitId = hex(payload.slice(1, 5));
    const modelBytes = payload.slice(7, 13);
    const modelId = hex(modelBytes);
    const transportIds: Record<string, string> = {};
    let offset = 0;
    for (const [name, flag] of [["Bluetooth", 0x01], ["Bluetooth LE", 0x02], ["Wireless", 0x04], ["USB", 0x08]] as const) {
      if ((payload[6] & flag) !== 0 && offset + 2 <= modelBytes.length) {
        transportIds[name] = hex(modelBytes.slice(offset, offset + 2));
        offset += 2;
      }
    }
    return { unitId: unitId === "00000000" ? null : unitId, modelId, transportIds };
  }

  private isSuperstrike(identity: DeviceIdentity): boolean {
    return this.device.productId === 0xc0a8 || identity.modelId?.startsWith("40BD") === true;
  }

  private async ensureHostControl(): Promise<void> {
    const profiles = await this.getFeature(FEATURE.onboardProfiles);
    if (!profiles.index) return;
    const mode = await this.request(profiles.index, 0x20);
    if (mode[3] === 0x02) return;
    await this.request(profiles.index, 0x10, 0x02);
    const confirmed = await this.request(profiles.index, 0x20);
    if (confirmed[3] !== 0x02) {
      throw new Error("The mouse did not enter host-control mode.");
    }
  }

  private async readFirmware(featureIndex: number): Promise<string[]> {
    if (!featureIndex) {
      return [];
    }

    const countReply = await this.request(featureIndex, 0x00);
    const count = countReply[3] ?? 0;
    const decoder = new TextDecoder();
    const firmware: string[] = [];

    for (let item = 0; item < count; item += 1) {
      const reply = await this.request(featureIndex, 0x10, item);
      const name = decoder.decode(reply.slice(4, 7)).replace(/\0/g, "");
      const major = (reply[7] ?? 0).toString(16).padStart(2, "0").toUpperCase();
      const minor = (reply[8] ?? 0).toString(16).padStart(2, "0").toUpperCase();
      firmware.push(`${name} ${major}.${minor}`);
    }
    return firmware;
  }

  private async request(featureIndex: number, functionId: number, ...parameters: number[]): Promise<Uint8Array> {
    if (parameters.length > 3) {
      throw new Error("This WebHID client only sends short, read-only HID++ requests.");
    }

    const report = new Uint8Array([
      DEVICE_INDEX,
      featureIndex,
      withSoftwareId(functionId),
      parameters[0] ?? 0,
      parameters[1] ?? 0,
      parameters[2] ?? 0,
    ]);
    const response = this.waitForResponse(featureIndex, functionId);
    // Keep the timeout rejection observed even when sendReport itself fails
    // (for example, when a browser selected a protected mouse collection).
    // The original sendReport error is then shown by the control panel.
    void response.catch(() => undefined);
    await this.device.sendReport(SHORT_REPORT_ID, report);
    return await response;
  }

  private async requestLong(featureIndex: number, functionId: number, parameters: number[]): Promise<Uint8Array> {
    if (parameters.length > 16) {
      throw new Error("HID++ long requests support at most 16 parameter bytes.");
    }
    const report = new Uint8Array(19);
    report[0] = DEVICE_INDEX;
    report[1] = featureIndex;
    report[2] = withSoftwareId(functionId);
    report.set(parameters, 3);
    const response = this.waitForResponse(featureIndex, functionId);
    void response.catch(() => undefined);
    await this.device.sendReport(LONG_REPORT_ID, report);
    return await response;
  }

  private waitForResponse(featureIndex: number, functionId: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.reject === reject);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error("The mouse did not answer. Move it or click a button, then try again."));
      }, 6000);

      this.waiters.push({
        featureIndex,
        functionId,
        resolve: (report) => {
          window.clearTimeout(timeout);
          resolve(report);
        },
        reject,
      });
    });
  }
}
