import type { MouseStatus } from "../mouse-types";
import {
  EGG_BUTTON_ACTION_OPTIONS,
  EGG_COMMAND_SIZE,
  EGG_CONFIG_SIZE,
  EGG_DEVICE_PROFILES,
  EGG_OFFSET,
  EGG_OPERATION,
  EGG_POLLING_RATES,
  EGG_REPORT,
  EGG_VENDOR_ID,
  eggButtonActionLabel,
  eggButtonControlOffset,
  eggButtonMappingOffset,
  eggClampCpi,
  eggDecodeButtonAction,
  eggDpiOptions,
  eggEncodeButtonAction,
  eggFormatFirmwareVersion,
  eggIsPlainLeftAction,
  eggIsValidCpi,
  eggLodOptions,
  eggNormalizeFeatureReport,
  eggProfileForPid,
  eggReadUint16LE,
  eggWriteUint16LE,
  type EggButtonAction,
  type EggDeviceProfile,
  type EggOp1Status,
} from "./egg-op1-protocol";

const STATUS_OK = 0x01;
const STATUS_BUSY = 0x03;
const FILTER = {
  slamclick: 0x01,
  motionJitter: 0x10,
} as const;
const BUTTON_CONFIG_SIZE = 7;
const SPDT = {
  "Off": 0x08,
  "GX Safe": 0xf0,
  "GX Speed": 0xf1,
} as const;

export type EggSpdtMode = keyof typeof SPDT;
export const EGG_BUTTON_NAMES = ["Left", "Right", "Middle", "Forward", "Back", "Wheel Up", "Wheel Down"] as const;
export type EggButtonIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export { EGG_BUTTON_ACTION_OPTIONS };

interface ReceivedFeature {
  bytes: Uint8Array;
  rawLength: number;
}

export class EggOp1HidClient {
  private chain: Promise<unknown> = Promise.resolve();
  private configPayloadLength = EGG_CONFIG_SIZE - 1;
  private commandPayloadLength = EGG_COMMAND_SIZE - 1;
  private firmwareVersion: string | null | undefined;

  readonly profile: EggDeviceProfile;
  onDeviceChange?: () => void;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (event.reportId !== EGG_REPORT.event || event.data.byteLength < 2) return;
    const type = event.data.getUint8(0);
    if (type === 0x02 || type === 0x06) this.onDeviceChange?.();
  };

  constructor(readonly device: HIDDevice) {
    this.profile = eggProfileForPid(device.productId);
  }

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === EGG_VENDOR_ID
      && EGG_DEVICE_PROFILES.has(device.productId)
      && this.collectionHasFeatureReport(device.collections, EGG_REPORT.command);
  }

  private static collectionHasFeatureReport(collections: readonly HIDCollectionInfo[], reportId: number): boolean {
    return collections.some((collection) =>
      collection.featureReports.some((report) => report.reportId === reportId)
      || this.collectionHasFeatureReport(collection.children, reportId));
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.configPayloadLength = this.featurePayloadLength(EGG_REPORT.config, EGG_CONFIG_SIZE - 1);
    this.commandPayloadLength = this.featurePayloadLength(EGG_REPORT.command, EGG_COMMAND_SIZE - 1);
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  describeCollections(): string {
    return this.device.collections.map((collection) => {
      const reports = collection.featureReports.map((report) => `0x${report.reportId.toString(16)}`);
      return `usage 0x${collection.usagePage.toString(16)}:0x${collection.usage.toString(16)} · feature ${reports.join(", ") || "none"}`;
    }).join(" | ") || "No HID collections reported";
  }

  getDpiOptions(): number[] {
    return eggDpiOptions(this.profile);
  }

  clampDpi(dpi: number): number {
    return eggClampCpi(this.profile, dpi);
  }

  async readStatus(): Promise<EggOp1Status> {
    const config = await this.readConfig();
    const cpiLevels = Math.min(Math.max(config[EGG_OFFSET.cpiLevels], 1), 4);
    const activeCpiStage = Math.min(config[EGG_OFFSET.activeCpiStage], cpiLevels - 1);
    const activeOffset = EGG_OFFSET.firstCpiSplit + activeCpiStage * 5;
    const dpi = eggReadUint16LE(config, activeOffset + 1);
    const dpiY = eggReadUint16LE(config, activeOffset + 3);
    if (!eggIsValidCpi(this.profile, dpi) || !eggIsValidCpi(this.profile, dpiY)) {
      throw new Error(`The mouse reported an unsupported X ${dpi} / Y ${dpiY} CPI value.`);
    }
    if (this.firmwareVersion === undefined) {
      this.firmwareVersion = await this.readFirmware().catch(() => null);
    }
    const glassMode = this.profile.lodGlass !== null && config[EGG_OFFSET.glassMode] !== 0;
    const lodOptions = eggLodOptions(this.profile, glassMode);
    const lodIndex = config[EGG_OFFSET.lod];
    const handedBytes = Array.from(config.slice(EGG_OFFSET.handedButton, EGG_OFFSET.handedButton + 6));
    const leftHanded = !eggIsPlainLeftAction(handedBytes) && handedBytes.some(Boolean);
    const buttonActions = EGG_BUTTON_NAMES.map((_, index) =>
      this.decodePhysicalButtonAction(config, index as EggButtonIndex, leftHanded));
    return {
      brand: "Endgame Gear",
      name: this.profile.name,
      batteryPercent: null,
      batteryState: "Unknown",
      dpi,
      dpiY,
      supportsSeparateDpiAxes: true,
      pollingRateHz: this.decodePollingRate(config[EGG_OFFSET.pollingDivider]),
      supportedPollingRates: [...EGG_POLLING_RATES],
      activeProfile: null,
      connectionType: "Wired",
      connectionDetail: `Wired USB - PID 0x${this.device.productId.toString(16).toUpperCase()} - ${this.profile.sensorFamily.toUpperCase()}`,
      motionSync: config[EGG_OFFSET.motionSync] !== 0,
      angleSnapping: config[EGG_OFFSET.angleSnapping] !== 0,
      rippleControl: config[EGG_OFFSET.rippleControl] !== 0,
      slamclickFilter: (config[EGG_OFFSET.filterFlags] & FILTER.slamclick) !== 0,
      motionJitterFilter: (config[EGG_OFFSET.filterFlags] & FILTER.motionJitter) !== 0,
      leftSpdtMode: this.decodeSpdtMode(config[EGG_OFFSET.firstButton]),
      rightSpdtMode: this.decodeSpdtMode(config[EGG_OFFSET.firstButton + BUTTON_CONFIG_SIZE]),
      eggCpiLevels: cpiLevels,
      eggActiveCpiStage: activeCpiStage,
      eggCpiMin: this.profile.cpiMin,
      eggCpiMax: this.profile.cpiMax,
      eggCpiStepLow: this.profile.cpiStepLow,
      eggCpiStepHigh: this.profile.cpiStepHigh,
      eggCpiStages: Array.from({ length: 4 }, (_, level) => {
        const offset = EGG_OFFSET.firstCpiSplit + level * 5;
        return { x: eggReadUint16LE(config, offset + 1), y: eggReadUint16LE(config, offset + 3) };
      }),
      eggPollingDivider: config[EGG_OFFSET.pollingDivider],
      eggLodIndex: lodIndex,
      eggLodOptions: [...lodOptions],
      eggGlassMode: glassMode,
      eggSupportsGlassMode: this.profile.lodGlass !== null,
      eggMotionSyncAt8k: this.profile.motionSyncAt8k,
      eggAngleTuning: this.profile.configFamily === "v2"
        ? this.decodeInt8(config[EGG_OFFSET.angleTuning])
        : undefined,
      eggForceMaxFps: this.profile.configFamily === "v2"
        ? config[EGG_OFFSET.forceMaxFps] !== 0
        : undefined,
      eggLedLiftOffDisabled: this.profile.configFamily === "v2"
        ? config[EGG_OFFSET.ledLiftOff] === 0
        : undefined,
      eggSupportsV2SensorControls: this.profile.configFamily === "v2",
      eggMulticlickFilters: Array.from({ length: 5 }, (_, index) => {
        const offset = eggButtonControlOffset(index);
        if (offset === null) throw new Error(`Missing multiclick offset for button ${index}.`);
        const value = config[offset];
        return value >= 0xf0 ? 8 : value;
      }),
      eggButtonMappings: buttonActions.map(eggButtonActionLabel),
      eggButtonActions: buttonActions,
      eggLeftHanded: leftHanded,
      liftOffDistance: this.genericLod(lodOptions[lodIndex]),
      firmware: this.firmwareVersion ? [`Firmware ${this.firmwareVersion}`] : ["Firmware unavailable"],
    };
  }

  async setDpi(dpi: number): Promise<number> {
    this.assertCpi(dpi);
    const confirmed = await this.updateConfig((config) => {
      const levels = Math.min(Math.max(config[EGG_OFFSET.cpiLevels], 1), 4);
      const active = Math.min(config[EGG_OFFSET.activeCpiStage], levels - 1);
      const offset = EGG_OFFSET.firstCpiSplit + active * 5;
      config[offset] = 0;
      eggWriteUint16LE(config, offset + 1, dpi);
      eggWriteUint16LE(config, offset + 3, dpi);
    });
    const active = Math.min(confirmed[EGG_OFFSET.activeCpiStage], confirmed[EGG_OFFSET.cpiLevels] - 1);
    const confirmedDpi = eggReadUint16LE(confirmed, EGG_OFFSET.firstCpiSplit + active * 5 + 1);
    if (confirmedDpi !== dpi) throw new Error(`The mouse kept ${confirmedDpi} CPI instead of ${dpi} CPI.`);
    return confirmedDpi;
  }

  async setPollingRate(rate: number): Promise<number> {
    if (!EGG_POLLING_RATES.includes(rate as (typeof EGG_POLLING_RATES)[number])) {
      throw new Error("Unsupported Endgame Gear 8K polling rate.");
    }
    const divider = 8000 / rate;
    const confirmed = await this.updateConfig((config) => {
      if (this.profile.lodGlass !== null && config[EGG_OFFSET.glassMode] !== 0) {
        throw new Error("Polling rate is controlled by firmware while Glass Mode is active.");
      }
      config[EGG_OFFSET.pollingDivider] = divider;
      if (rate === 8000 && !this.profile.motionSyncAt8k) config[EGG_OFFSET.motionSync] = 0;
    });
    const confirmedRate = this.decodePollingRate(confirmed[EGG_OFFSET.pollingDivider]);
    if (confirmedRate !== rate) throw new Error(`The mouse kept ${confirmedRate} Hz instead of ${rate} Hz.`);
    return confirmedRate;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    const target = value === "Low" ? "0.7 mm" : value === "Medium" ? "1.0 mm" : "2.0 mm";
    const fallback = value === "Medium" ? "1 mm" : value === "High" ? "2 mm" : target;
    const config = await this.readConfig();
    const glassMode = this.profile.lodGlass !== null && config[EGG_OFFSET.glassMode] !== 0;
    const options = eggLodOptions(this.profile, glassMode);
    const index = options.findIndex((option) => option === target || option === fallback);
    if (index < 0) throw new Error(`${this.profile.name} does not expose ${target} in its current sensor mode.`);
    await this.setEggLodIndex(index);
  }

  async setEggLodIndex(index: number): Promise<void> {
    const confirmed = await this.updateConfig((config) => {
      const glassMode = this.profile.lodGlass !== null && config[EGG_OFFSET.glassMode] !== 0;
      const options = eggLodOptions(this.profile, glassMode);
      if (!Number.isInteger(index) || index < 0 || index >= options.length) {
        throw new Error("Invalid lift-off distance for this mouse and sensor mode.");
      }
      config[EGG_OFFSET.lod] = index;
    });
    if (confirmed[EGG_OFFSET.lod] !== index) throw new Error("The mouse did not confirm the requested lift-off distance.");
  }

  async setGlassMode(enabled: boolean): Promise<void> {
    if (this.profile.lodGlass === null) throw new Error(`${this.profile.name} does not support Glass Mode.`);
    const confirmed = await this.updateConfig((config) => {
      config[EGG_OFFSET.glassMode] = enabled ? 1 : 0;
      config[EGG_OFFSET.lod] = 0;
    });
    if ((confirmed[EGG_OFFSET.glassMode] !== 0) !== enabled) {
      throw new Error("The mouse did not confirm Glass Mode.");
    }
  }

  async setSensorAngleTuning(value: number): Promise<void> {
    this.assertV2SensorControl("Sensor Angle Tuning");
    if (!Number.isInteger(value) || value < -127 || value > 127) {
      throw new Error("Sensor Angle Tuning must be an integer from -127 to 127.");
    }
    const confirmed = await this.updateConfig((config) => { config[EGG_OFFSET.angleTuning] = value & 0xff; });
    if (this.decodeInt8(confirmed[EGG_OFFSET.angleTuning]) !== value) {
      throw new Error("The mouse did not confirm Sensor Angle Tuning.");
    }
  }

  async setForceMaxSensorFps(enabled: boolean): Promise<void> {
    this.assertV2SensorControl("Force max Sensor FPS");
    await this.setBoolean(EGG_OFFSET.forceMaxFps, enabled, "Force max Sensor FPS");
  }

  async setLedLiftOffDisabled(enabled: boolean): Promise<void> {
    this.assertV2SensorControl("Disable LED on Lift-Off");
    const confirmed = await this.updateConfig((config) => { config[EGG_OFFSET.ledLiftOff] = enabled ? 0 : 1; });
    if ((confirmed[EGG_OFFSET.ledLiftOff] === 0) !== enabled) {
      throw new Error("The mouse did not confirm the lift-off LED setting.");
    }
  }

  async setMotionSync(enabled: boolean): Promise<void> {
    if (enabled && !this.profile.motionSyncAt8k) {
      const config = await this.readConfig();
      if (this.decodePollingRate(config[EGG_OFFSET.pollingDivider]) === 8000) {
        throw new Error(`${this.profile.name} cannot use Motion Sync at 8,000 Hz.`);
      }
    }
    await this.setBoolean(EGG_OFFSET.motionSync, enabled, "Motion Sync");
  }

  async setAngleSnapping(enabled: boolean): Promise<void> {
    await this.setBoolean(EGG_OFFSET.angleSnapping, enabled, "angle snapping");
  }

  async setRippleControl(enabled: boolean): Promise<void> {
    await this.setBoolean(EGG_OFFSET.rippleControl, enabled, "ripple control");
  }

  async setSlamclickFilter(enabled: boolean): Promise<void> {
    await this.setFilterFlag(FILTER.slamclick, enabled, "slamclick filter");
  }

  async setMotionJitterFilter(enabled: boolean): Promise<void> {
    await this.setFilterFlag(FILTER.motionJitter, enabled, "motion-jitter filter");
  }

  async setSpdtMode(button: "left" | "right", mode: EggSpdtMode): Promise<void> {
    const offset = EGG_OFFSET.firstButton + (button === "right" ? BUTTON_CONFIG_SIZE : 0);
    const confirmed = await this.updateConfig((config) => { config[offset] = SPDT[mode]; });
    const actual = this.decodeSpdtMode(confirmed[offset]);
    if (actual !== mode) throw new Error(`The mouse kept the ${button} button in ${actual} mode instead of ${mode}.`);
  }

  async setCpiLevels(levels: number): Promise<void> {
    if (!Number.isInteger(levels) || levels < 1 || levels > 4) throw new Error("The OP1/XM2 supports one to four CPI stages.");
    const confirmed = await this.updateConfig((config) => {
      config[EGG_OFFSET.cpiLevels] = levels;
      if (config[EGG_OFFSET.activeCpiStage] >= levels) config[EGG_OFFSET.activeCpiStage] = levels - 1;
    });
    if (confirmed[EGG_OFFSET.cpiLevels] !== levels) throw new Error("The mouse did not confirm the CPI stage count.");
  }

  async setActiveCpiStage(level: number): Promise<void> {
    const confirmed = await this.updateConfig((config) => {
      const levels = Math.min(Math.max(config[EGG_OFFSET.cpiLevels], 1), 4);
      if (!Number.isInteger(level) || level < 0 || level >= levels) throw new Error("Invalid active CPI stage.");
      config[EGG_OFFSET.activeCpiStage] = level;
    });
    if (confirmed[EGG_OFFSET.activeCpiStage] !== level) throw new Error("The mouse did not confirm the active CPI stage.");
  }

  async setCpiStage(level: number, x: number, y: number): Promise<void> {
    if (!Number.isInteger(level) || level < 0 || level > 3) throw new Error("Invalid CPI stage.");
    this.assertCpi(x);
    this.assertCpi(y);
    const offset = EGG_OFFSET.firstCpiSplit + level * 5;
    const confirmed = await this.updateConfig((config) => {
      config[offset] = x === y ? 0 : 1;
      eggWriteUint16LE(config, offset + 1, x);
      eggWriteUint16LE(config, offset + 3, y);
    });
    if (eggReadUint16LE(confirmed, offset + 1) !== x || eggReadUint16LE(confirmed, offset + 3) !== y) {
      throw new Error(`The mouse did not confirm CPI stage ${level + 1}.`);
    }
  }

  async setCustomPollingDivider(divider: number): Promise<void> {
    if (!Number.isInteger(divider) || divider < 1 || divider > 255) throw new Error("Polling divider must be an integer from 1 to 255.");
    const confirmed = await this.updateConfig((config) => {
      if (this.profile.lodGlass !== null && config[EGG_OFFSET.glassMode] !== 0) {
        throw new Error("Polling rate is controlled by firmware while Glass Mode is active.");
      }
      config[EGG_OFFSET.pollingDivider] = divider;
    });
    if (confirmed[EGG_OFFSET.pollingDivider] !== divider) throw new Error("The mouse did not confirm the custom polling divider.");
  }

  async setMulticlickFilter(button: EggButtonIndex, value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 0 || value > 25) throw new Error("Multiclick filtering must be from 0 to 25.");
    const offset = eggButtonControlOffset(button);
    if (offset === null) throw new Error(`${EGG_BUTTON_NAMES[button]} has no multiclick filter.`);
    const confirmed = await this.updateConfig((config) => {
      if (button < 2 && config[offset] >= 0xf0) {
        throw new Error(`Turn GX mode off for the ${EGG_BUTTON_NAMES[button]} button first.`);
      }
      config[offset] = value;
    });
    if (confirmed[offset] !== value) throw new Error(`The mouse did not confirm the ${EGG_BUTTON_NAMES[button]} multiclick value.`);
  }

  async setButtonMapping(button: EggButtonIndex, action: EggButtonAction): Promise<void> {
    const encoded = eggEncodeButtonAction(action);
    if (!encoded) throw new Error("Unknown mappings are preserved until a supported action is selected.");
    if (action.key === "fixed-cpi") {
      this.assertCpi(action.x ?? 0);
      this.assertCpi(action.y ?? action.x ?? 0);
    }
    const confirmed = await this.updateConfig((config) => {
      const leftHanded = this.configIsLeftHanded(config);
      if ((button === 0 && !leftHanded) || (button === 1 && leftHanded)) {
        throw new Error(`${EGG_BUTTON_NAMES[button]} is the fixed primary button in the current handedness mode.`);
      }
      this.writePhysicalButtonAction(config, button, encoded, leftHanded);
    });
    const actual = this.decodePhysicalButtonAction(confirmed, button, this.configIsLeftHanded(confirmed));
    if (JSON.stringify(eggEncodeButtonAction(actual)) !== JSON.stringify(encoded)) {
      throw new Error(`The mouse kept the ${EGG_BUTTON_NAMES[button]} mapping as ${eggButtonActionLabel(actual)}.`);
    }
  }

  async setLeftHanded(enabled: boolean): Promise<void> {
    const confirmed = await this.updateConfig((config) => {
      if (enabled) {
        this.writeActionAt(config, EGG_OFFSET.handedButton, { type: 0x00, params: [0x02, 0, 0, 0, 0] });
        this.writeActionAt(config, EGG_OFFSET.firstButton + 1, { type: 0x00, params: [0x01, 0, 0, 0, 0] });
      } else {
        this.writeActionAt(config, EGG_OFFSET.handedButton, { type: 0x00, params: [0x01, 0, 0, 0, 0] });
        this.writeActionAt(config, EGG_OFFSET.firstButton + 1, { type: 0x00, params: [0x02, 0, 0, 0, 0] });
      }
    });
    if (this.configIsLeftHanded(confirmed) !== enabled) throw new Error("The mouse did not confirm left-handed mode.");
  }

  async factoryReset(): Promise<void> {
    await this.run(async () => {
      await this.open();
      await this.sendCommand(EGG_OPERATION.factoryReset);
      await this.delay(1100);
      if (!await this.pollCommandOk(8)) throw new Error("The EGG mouse did not acknowledge the factory reset.");
    });
  }

  async close(): Promise<void> {
    this.onDeviceChange = undefined;
    this.device.removeEventListener("inputreport", this.onInputReport);
    if (this.device.opened) await this.device.close();
  }

  private assertCpi(value: number): void {
    if (!eggIsValidCpi(this.profile, value)) {
      throw new Error(
        `${this.profile.name} CPI must be ${this.profile.cpiMin.toLocaleString()} to ${this.profile.cpiMax.toLocaleString()} using the device's supported steps.`,
      );
    }
  }

  private assertV2SensorControl(label: string): void {
    if (this.profile.configFamily !== "v2") throw new Error(`${label} is available only on v2 mice.`);
  }

  private decodeInt8(value: number): number {
    return value > 127 ? value - 256 : value;
  }

  private async setBoolean(offset: number, enabled: boolean, label: string): Promise<void> {
    const confirmed = await this.updateConfig((config) => { config[offset] = enabled ? 1 : 0; });
    if ((confirmed[offset] !== 0) !== enabled) throw new Error(`The mouse did not confirm ${label}.`);
  }

  private async setFilterFlag(flag: number, enabled: boolean, label: string): Promise<void> {
    const confirmed = await this.updateConfig((config) => {
      config[EGG_OFFSET.filterFlags] = enabled
        ? config[EGG_OFFSET.filterFlags] | flag
        : config[EGG_OFFSET.filterFlags] & ~flag;
    });
    if (((confirmed[EGG_OFFSET.filterFlags] & flag) !== 0) !== enabled) {
      throw new Error(`The mouse did not confirm the ${label}.`);
    }
  }

  private decodeSpdtMode(value: number): EggSpdtMode {
    if (value === SPDT["GX Safe"]) return "GX Safe";
    if (value === SPDT["GX Speed"]) return "GX Speed";
    return "Off";
  }

  private configIsLeftHanded(config: Uint8Array): boolean {
    const handed = Array.from(config.slice(EGG_OFFSET.handedButton, EGG_OFFSET.handedButton + 6));
    return !eggIsPlainLeftAction(handed) && handed.some(Boolean);
  }

  private decodePhysicalButtonAction(
    config: Uint8Array,
    button: EggButtonIndex,
    leftHanded: boolean,
  ): EggButtonAction {
    if (button === 0) return this.decodeActionAt(config, EGG_OFFSET.handedButton);
    const offset = eggButtonMappingOffset(button, leftHanded);
    if (offset === null) return { key: "mouse-left" };
    return this.decodeActionAt(config, offset);
  }

  private decodeActionAt(config: Uint8Array, offset: number): EggButtonAction {
    return eggDecodeButtonAction(config[offset], Array.from(config.slice(offset + 1, offset + 6)));
  }

  private writePhysicalButtonAction(
    config: Uint8Array,
    button: EggButtonIndex,
    action: NonNullable<ReturnType<typeof eggEncodeButtonAction>>,
    leftHanded: boolean,
  ): void {
    if (button === 0) {
      this.writeActionAt(config, EGG_OFFSET.handedButton, action);
      if (leftHanded) {
        this.writeActionAt(config, EGG_OFFSET.firstButton + 1, { type: 0x00, params: [0x01, 0, 0, 0, 0] });
      }
      return;
    }
    const offset = eggButtonMappingOffset(button, leftHanded);
    if (offset === null) throw new Error(`${EGG_BUTTON_NAMES[button]} has no writable mapping slot.`);
    this.writeActionAt(config, offset, action);
  }

  private writeActionAt(
    config: Uint8Array,
    offset: number,
    action: NonNullable<ReturnType<typeof eggEncodeButtonAction>>,
  ): void {
    config[offset] = action.type;
    for (let index = 0; index < 5; index += 1) config[offset + index + 1] = action.params[index];
  }

  private genericLod(label: string | undefined): MouseStatus["liftOffDistance"] {
    if (label === "0.7 mm") return "Low";
    if (label === "1 mm" || label === "1.0 mm") return "Medium";
    if (label === "2 mm" || label === "2.0 mm") return "High";
    return null;
  }

  private updateConfig(change: (config: Uint8Array) => void): Promise<Uint8Array> {
    return this.run(async () => {
      const config = await this.readConfigRaw();
      change(config);
      await this.writeConfigRaw(config);
      return this.readConfigRaw();
    });
  }

  private readConfig(): Promise<Uint8Array> {
    return this.run(() => this.readConfigRaw());
  }

  private async readConfigRaw(): Promise<Uint8Array> {
    await this.open();
    const trace: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      await this.sendCommand(EGG_OPERATION.load);
      await this.delay(80);
      let backoff = 60;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        for (const reportId of [EGG_REPORT.command, EGG_REPORT.config]) {
          try {
            const received = await this.receiveFeature(reportId, EGG_CONFIG_SIZE, this.configPayloadLength);
            if (this.isValidConfig(received.bytes, received.rawLength)) {
              received.bytes[0] = EGG_REPORT.config;
              return received.bytes;
            }
            trace.push(`GET 0x${reportId.toString(16)} len=${received.rawLength}`);
          } catch (error) {
            trace.push(error instanceof Error ? error.message : `GET 0x${reportId.toString(16)} failed`);
          }
        }
        await this.delay(backoff);
        backoff = Math.min(backoff * 2, 400);
      }
    }
    throw new Error(`The EGG mouse did not return a valid configuration (${trace.slice(-3).join("; ")}).`);
  }

  private async writeConfigRaw(config: Uint8Array): Promise<void> {
    const payload = new Uint8Array(this.configPayloadLength);
    payload.set(config.subarray(1, 1 + Math.min(config.length - 1, payload.length)));
    payload[0] = EGG_OPERATION.store;
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.device.sendFeatureReport(EGG_REPORT.config, payload);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await this.delay(50);
      }
    }
    if (lastError) throw lastError;
    await this.delay(300);
    const acknowledged = await this.pollCommandOk(8);
    if (!acknowledged) throw new Error("The EGG mouse did not acknowledge the configuration write.");
  }

  private readFirmware(): Promise<string | null> {
    return this.run(async () => {
      await this.open();
      await this.sendCommand(EGG_OPERATION.firmware);
      await this.delay(50);
      let bestEffortVersion: string | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await this.receiveFeature(EGG_REPORT.command, EGG_COMMAND_SIZE, this.commandPayloadLength);
        const version = eggFormatFirmwareVersion(response.bytes);
        if (version !== null) bestEffortVersion = version;
        if (response.bytes[1] === STATUS_OK && version !== null) return version;
        await this.delay(50 * (attempt + 1));
      }
      return bestEffortVersion;
    });
  }

  private async sendCommand(operation: number): Promise<void> {
    const command = new Uint8Array(this.commandPayloadLength);
    command[0] = operation;
    await this.device.sendFeatureReport(EGG_REPORT.command, command);
  }

  private async pollCommandOk(attempts: number): Promise<boolean> {
    let backoff = 60;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await this.receiveFeature(EGG_REPORT.command, EGG_COMMAND_SIZE, this.commandPayloadLength);
      if (response.bytes[1] === STATUS_OK) return true;
      if (response.bytes[1] !== STATUS_BUSY && attempt > 1) return false;
      await this.delay(backoff);
      backoff = Math.min(backoff * 2, 400);
    }
    return false;
  }

  private async receiveFeature(reportId: number, expectedTotal: number, payloadLength: number): Promise<ReceivedFeature> {
    const view = await Promise.race([
      this.device.receiveFeatureReport(reportId),
      new Promise<never>((_, reject) => window.setTimeout(
        () => reject(new Error(`GET 0x${reportId.toString(16)} timed out`)),
        3000,
      )),
    ]);
    const raw = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    return {
      bytes: this.normalizeFeature(raw, reportId, expectedTotal, payloadLength),
      rawLength: raw.length,
    };
  }

  private normalizeFeature(raw: Uint8Array, reportId: number, expectedTotal: number, payloadLength: number): Uint8Array {
    if (expectedTotal === EGG_CONFIG_SIZE
      && raw.length === payloadLength
      && (raw[0] === 0 || raw[0] === EGG_REPORT.config || raw[0] === EGG_REPORT.command)
      && (raw[1] === STATUS_OK || raw[1] === STATUS_BUSY)) {
      const result = new Uint8Array(expectedTotal);
      result.set(raw);
      result[0] = reportId;
      return result;
    }
    return eggNormalizeFeatureReport(raw, reportId, expectedTotal, payloadLength);
  }

  private isValidConfig(config: Uint8Array, rawLength: number): boolean {
    const stages = config[EGG_OFFSET.cpiLevels];
    const active = config[EGG_OFFSET.activeCpiStage];
    const divider = config[EGG_OFFSET.pollingDivider];
    const cpi = eggReadUint16LE(config, EGG_OFFSET.firstCpiSplit + 1);
    return rawLength >= 131
      && config[1] === STATUS_OK
      && stages >= 1 && stages <= 4
      && active <= 3
      && divider >= 1 && divider <= 255
      && eggIsValidCpi(this.profile, cpi);
  }

  private featurePayloadLength(reportId: number, fallback: number): number {
    const reports: HIDReportInfo[] = [];
    const collect = (collections: readonly HIDCollectionInfo[]): void => {
      for (const collection of collections) {
        reports.push(...collection.featureReports.filter((report) => report.reportId === reportId));
        collect(collection.children);
      }
    };
    collect(this.device.collections);
    for (const report of reports) {
      const bits = report.items.reduce((sum, item) => sum + item.reportSize * item.reportCount, 0);
      if (bits > 0) return Math.ceil(bits / 8);
    }
    return fallback;
  }

  private decodePollingRate(divider: number): number {
    if (!divider) throw new Error("The mouse reported an invalid polling-rate divider.");
    return 8000 / divider;
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.chain.then(operation, operation);
    this.chain = pending.catch(() => undefined);
    return pending;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
