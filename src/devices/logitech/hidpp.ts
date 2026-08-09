import type { MouseStatus } from "../mouse-types.ts";
import { LOGITECH_RECEIVER_PRODUCT_IDS } from "../vendors.ts";
import {
  BOLT_INDEX_PROBE_TIMEOUT_MS,
  boltSupportScore,
  classifyHidpp20Probe,
  collapseBoltPeers,
  hasHidppLongCollection,
  hasHidppShortCollection,
  resolveBoltReportDevice,
} from "./bolt.ts";
import {
  DEVICE_INDEX_DIRECT,
  decodeBatteryLevelState,
  decodeReportRateBitmap,
  decodeUnifiedBatteryState,
  hidppDeviceIndexCandidates,
  hidppErrorForRequest,
  isBoltReceiverProduct,
  isDirectConnectProduct,
  isDirectConnection,
  OnboardOnlyError,
  withSoftwareId,
} from "./protocol.ts";

export {
  collapseBoltPeers,
  hasHidppLongCollection,
  hasHidppShortCollection,
} from "./bolt.ts";
import {
  MODE_STATUS,
  buildModeStatusWriteMany,
  decodeModeStatus,
  type GamingSurfaceMode,
  type LightforceSwitchMode,
  type ModeStatusField,
} from "./mode-status.ts";
import {
  ONBOARD_MODE,
  PROFILE_FN,
  PROFILE_NAME_MAX_CHARS,
  applyCrc,
  capabilitiesForFormat,
  decodeLiftOffLevel,
  decodeOnboardProfile,
  describeProfileFormat,
  dpiStageCapabilitiesForOptions,
  encodeDpiStages,
  encodeProfileName,
  encodeReportRate,
  factoryProfileForFormat,
  validateDpiStagePlan,
  type DpiStagePlan,
  layoutForFormat,
  parseDirectory,
  parseProfilesInfo,
  profileCrc,
  reportRatesForDevice,
  setDirectoryEnabled,
  storedCrc,
  supportsProfileWriteProbe,
  validateBunnyHoppingMs,
  type OnboardProfile,
  type ProfileFormatCapabilities,
} from "./onboard-profiles.ts";

export type { OnboardProfile };

/** Raw, read-only evidence used to confirm an onboard-profile format. */
export interface OnboardProfileVerification {
  info: ReturnType<typeof parseProfilesInfo>;
  infoReply: Uint8Array;
  mode: "Onboard" | "Host" | "Unknown";
  modeValue: number;
  modeReply: Uint8Array;
  currentSector: number;
  currentProfileReply: Uint8Array;
  directory: Uint8Array;
  directoryCrcValid: boolean;
  profiles: OnboardProfile[];
  dpiCapabilities: VerificationCapability | null;
  reportRateCapabilities: VerificationCapability | null;
}

export interface VerificationCapability {
  featureId: number;
  featureIndex: number;
  featureVersion: number;
  kind: "legacy" | "extended";
  replies: Array<{ name: string; bytes: Uint8Array }>;
  decodedValues: number[];
  error: string | null;
}

/**
 * Master switch for writing DPI slots into profile flash.
 *
 * Enabled after probeProfileWriteSequence passed on a Pro X Superlight 2
 * (format 7): writing a changed byte to sector 0x0002 appeared on read-back,
 * and restoring it appeared too, both with valid checksums. That proves the
 * memoryAddrWrite/memoryWrite/memoryWriteEnd sequence lands rather than being
 * silently dropped. Run the probe again before trusting a new format.
 */
export const PROFILE_DPI_WRITES_ENABLED = true;

export interface ProfileWriteProbeMismatch {
  offset: number;
  expected: number;
  actual: number;
}

export interface ProfileWriteProbeStep {
  name: string;
  ok: boolean;
  checksumValid: boolean;
  mismatches: ProfileWriteProbeMismatch[];
}

export interface ProfileWriteProbe {
  sector: number;
  sectorSize: number;
  offset: number;
  originalByte: number;
  probeByte: number;
  steps: ProfileWriteProbeStep[];
  ok: boolean;
  restored: boolean;
}

export interface ProfileContentWriteProbeBackup {
  formatId: number;
  sector: number;
  sectorSize: number;
  originalMode: "Onboard" | "Host";
  originalCurrentSector: number;
  directory: Uint8Array;
  profile: Uint8Array;
  dpiOptions: number[];
  reportRates: number[];
}

export interface ProfileContentWriteProbeStep {
  setting: "name" | "dpi" | "polling";
  intended: string;
  storedExactly: boolean;
  liveConfirmed: boolean | null;
  restored: boolean;
  error: string | null;
}

export interface ProfileContentWriteProbeReport {
  backup: ProfileContentWriteProbeBackup;
  steps: ProfileContentWriteProbeStep[];
  restored: boolean;
  modeRestored: boolean;
  ok: boolean;
}

/**
 * A Logitech device that speaks HID++ but exposes no sensor, so it is not a
 * mouse. Its own type so the shell can report it as a wrong choice rather than
 * as a device that failed to read.
 */
/** No reply within the request window — nothing is listening on this index. */
class HidppTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HidppTimeoutError";
  }
}

export class NotAMouseError extends Error {
  constructor(name: string) {
    super(`${name} is not a mouse — it speaks Logitech's protocol but has no sensor to configure. Pick your mouse, or its receiver, instead.`);
    this.name = "NotAMouseError";
  }
}

const LOGITECH_VENDOR_ID = 0x046d;
const KNOWN_RECEIVER_PRODUCT_IDS: ReadonlySet<number> = new Set(LOGITECH_RECEIVER_PRODUCT_IDS);

/**
 * Models whose 0x8090 mode-status feature drives the power-mode switch only.
 * The status1 byte that carries the gaming-surface and LightForce fields is
 * reserved on them and reads 0, which would otherwise decode as "Auto" and
 * "Optical" and offer controls the mouse does not have. Keyed on the firmware
 * model id, like the Superstrike detection.
 */
const MODE_STATUS_POWER_ONLY_MODEL_IDS: ReadonlySet<string> = new Set([
  "B03C40B10000", // G309 LIGHTSPEED
  "407400000000", // G305 LIGHTSPEED
]);

/** Whether 0x8090 on this model is the power-mode-only variant. */
export function isPowerOnlyModeStatus(modelId: string | null | undefined): boolean {
  return MODE_STATUS_POWER_ONLY_MODEL_IDS.has(modelId ?? "");
}

/**
 * Whether the mouse exposes lift-off levels it can drive: only extended DPI
 * (0x2202) carries one, and its byte 0 is the "no lift-off control" value, so
 * a legacy-DPI mouse or a sensor reporting 0 advertises no levels.
 */
export function hasLiftOffControl(legacyDpi: boolean, lodByte: number | null): boolean {
  return !legacyDpi && lodByte !== null && lodByte !== 0;
}
const SHORT_REPORT_ID = 0x10;
const LONG_REPORT_ID = 0x11;
const REQUEST_TIMEOUT_MS = 6000;
const FEATURE = {
  deviceName: 0x0005,
  firmware: 0x0003,
  unifiedBattery: 0x1004,
  // Pre-unified battery reporting, still the only one on HERO-era mice.
  batteryStatus: 0x1000,
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

/**
 * Extended DPI alone does not imply adjustable lift-off distance. Some mice,
 * including the G309, expose 0x2202 but return the protocol's "no LOD control"
 * value. Legacy DPI never carries LOD either.
 */
export function supportsLiveLiftOffControl(
  legacyDpi: boolean,
  liftOffDistance: LogitechMouseStatus["liftOffDistance"],
): boolean {
  return !legacyDpi && liftOffDistance !== null;
}

/**
 * Resolves the active physical link from HID++ identity transport IDs. A
 * receiver's USB PID does not match the paired mouse's Wireless transport ID;
 * a mouse connected by cable matches its own USB transport ID. Direct-index
 * probing remains the fallback for older devices that omit identity data.
 */
export function isWiredHidppConnection(
  productId: number,
  transportIds: Record<string, string>,
  directIndex: boolean,
): boolean {
  const activeId = productId.toString(16).padStart(4, "0").toUpperCase();
  const activeTransport = Object.entries(transportIds)
    .find(([, transportId]) => transportId.toUpperCase() === activeId)?.[0];
  if (activeTransport !== undefined) return activeTransport === "USB";
  return directIndex;
}

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
  private supportedPollingRatesCache: number[] | null = null;
  private livePollingRateHz: number | null = null;
  /** Discovered by resolveDeviceIndex; null until the mouse has answered. */
  private resolvedDeviceIndex: number | null = null;
  /** Last format read from 0x8100, so a refusal can name it. */
  private profileFormatId: number | null = null;
  private wiredConnection = false;
  /** Lift-off levels this device advertised; the single source of truth for both UI and validation. */
  private lodCapabilities: ProfileFormatCapabilities = capabilitiesForFormat(null);
  private supportedLods: Array<NonNullable<LogitechMouseStatus["liftOffDistance"]>> = ["Medium", "High"];
  private readonly rateChangeWaiters: Array<{ rate: number; resolve: () => void; reject: (reason: Error) => void }> = [];
  /**
   * Device used for HID++ feature sendReport. On Bolt this is the long-report
   * collection (usage 2); elsewhere it is `device` itself.
   */
  private ioDevice: HIDDevice | null = null;
  private listeningDevices = new Set<HIDDevice>();
  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (event.reportId !== SHORT_REPORT_ID && event.reportId !== LONG_REPORT_ID) {
      return;
    }

    const report = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
    if (report[0] === this.deviceIndex && report[1] === this.reportRateFeatureIndex && report[2] === 0x00 && report[3] === 0x01) {
      const rate = REPORT_RATE_HZ[report[4] ?? -1];
      if (rate) {
        this.livePollingRateHz = rate;
        const matchingRateWaiters = this.rateChangeWaiters.filter((waiter) => waiter.rate === rate);
        this.rateChangeWaiters.splice(0, this.rateChangeWaiters.length, ...this.rateChangeWaiters.filter((waiter) => waiter.rate !== rate));
        matchingRateWaiters.forEach((waiter) => waiter.resolve());
      }
    }
    const matchingIndex = this.waiters.findIndex(
      (waiter) => report[0] === this.deviceIndex
        && report[1] === waiter.featureIndex
        && report[2] === withSoftwareId(waiter.functionId),
    );
    if (matchingIndex >= 0) {
      this.waiters.splice(matchingIndex, 1)[0].resolve(report);
      return;
    }

    // HID++ can emit a status notification between a write acknowledgement and
    // the matching read response. Leave the pending request in place and wait.
    if (report[0] === this.deviceIndex && (report[1] === 0x8f || report[1] === 0xff)) {
      let failure: string | null = null;
      const failedIndex = this.waiters.findIndex((waiter) => {
        failure = hidppErrorForRequest(report, waiter.featureIndex, waiter.functionId);
        return failure !== null;
      });
      if (failedIndex >= 0) {
        this.waiters.splice(failedIndex, 1)[0].reject(new Error(failure ?? "The mouse rejected that request."));
      }
      return;
    }
  };

  private readonly waiters: Array<{
    featureIndex: number;
    functionId: number;
    resolve: (report: Uint8Array) => void;
    reject: (reason: Error) => void;
  }> = [];

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  /**
   * True when the vendor interface belongs to the mouse itself instead of a
   * receiver. Written as a getter because `useDefineForClassFields` runs
   * field initializers before the `device` parameter property is assigned.
   */
  private get isDirectConnect(): boolean {
    return isDirectConnection(this.resolvedDeviceIndex);
  }

  private get isBoltReceiver(): boolean {
    return isBoltReceiverProduct(this.device.productId);
  }

  /** HID++ device index: a receiver pairing slot, or the mouse itself. */
  private get deviceIndex(): number {
    return this.resolvedDeviceIndex ?? DEVICE_INDEX_DIRECT;
  }

  private get reportDevice(): HIDDevice {
    return this.ioDevice ?? this.device;
  }

  /**
   * Finds which HID++ device index this connection answers on.
   *
   * A mouse reached through its receiver answers on a pairing slot (usually
   * 0x01 on Lightspeed; any of 1..6 on Bolt). The same mouse plugged in by
   * cable answers as itself (0xFF). That cannot be read from the descriptors.
   *
   * Only a HID++ 2.0 reply (success or 2.0 error) counts. Bolt receivers answer
   * HID++ 1.0 errors on empty slots and on 0xFF; treating those as "answered"
   * made OpenMouse lock onto the receiver and report "invalid command".
   * A G HUB merge can also push the mouse off slot 0x01, so receivers probe
   * every pairing slot, not just the first.
   *
   * So ask. The root feature query is the cheapest request there is, and the
   * wrong index simply times out.
   */
  private async resolveDeviceIndex(): Promise<void> {
    if (this.resolvedDeviceIndex !== null) return;
    const receiverAttached = KNOWN_RECEIVER_PRODUCT_IDS.has(this.device.productId);
    const candidates = hidppDeviceIndexCandidates(receiverAttached);

    // A merged receiver can carry a keyboard on a lower slot than the mouse.
    // Keyboards answer the same HID++ queries, so an answering slot only counts
    // once it proves it has a sensor; a direct connection has a single endpoint
    // and is latched as before, with readStatus deciding whether it is a mouse.
    let answeredWithoutSensor = false;
    for (const candidate of candidates) {
      this.resolvedDeviceIndex = candidate;
      const outcome = await this.probeHidpp20Root();
      if (outcome !== "hidpp20") continue;
      if (!receiverAttached) return;
      answeredWithoutSensor = true;
      if (await this.hasDpiFeature()) return;
    }
    this.resolvedDeviceIndex = null;
    if (answeredWithoutSensor) {
      throw new NotAMouseError(this.device.productName || "That Logitech device");
    }
    throw new Error(this.isBoltReceiver
      ? "No mouse answered on this Logi Bolt receiver. Move the mouse, then try again. Close Logi Options+ if it is open."
      : "The mouse did not answer on any HID++ device index.");
  }

  /** Root getFeature(firmware) distinguishes HID++ 2.0 from receiver noise. */
  private async probeHidpp20Root(): Promise<"hidpp20" | "absent"> {
    try {
      await this.requestWithOptions(
        0x00,
        0x00,
        [FEATURE.firmware >> 8, FEATURE.firmware & 0xff],
        { timeoutMs: this.isBoltReceiver ? BOLT_INDEX_PROBE_TIMEOUT_MS : REQUEST_TIMEOUT_MS },
      );
      return "hidpp20";
    } catch (error: unknown) {
      return classifyHidpp20Probe(error, error instanceof HidppTimeoutError);
    }
  }

  /**
   * Whether the slot currently probed exposes a DPI feature — the same sensor
   * check readStatus uses, so a keyboard paired to a merged receiver is never
   * mistaken for the mouse.
   */
  private async hasDpiFeature(): Promise<boolean> {
    const extended = await this.getFeature(FEATURE.extendedDpi).catch(() => null);
    if (extended?.index) return true;
    const legacy = await this.getFeature(FEATURE.adjustableDpi).catch(() => null);
    return (legacy?.index ?? 0) !== 0;
  }

  /**
   * Any Logitech device speaking HID++, not just the receivers we happen to
   * have listed. Whether it is a *mouse* cannot be told from descriptors —
   * keyboards and headsets use the same transport — so that is decided after
   * connecting, by asking for a DPI feature. See readStatus.
   */
  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== LOGITECH_VENDOR_ID) return false;
    return hasHidppShortCollection(device) || hasHidppLongCollection(device);
  }

  /**
   * Prefer Bolt's long-report collection when both HID++ endpoints are present
   * so feature traffic lands on the interface that can carry it.
   */
  static supportScore(device: HIDDevice): number {
    return boltSupportScore(device, this.isSupported(device));
  }

  /** @see collapseBoltPeers */
  static collapseBoltPeers(devices: readonly HIDDevice[]): HIDDevice[] {
    return collapseBoltPeers(devices);
  }

  /** Known receivers, kept as the fast path for the WebHID picker's filters. */
  static isKnownReceiver(device: HIDDevice): boolean {
    return device.vendorId === LOGITECH_VENDOR_ID
      && (KNOWN_RECEIVER_PRODUCT_IDS.has(device.productId) || isDirectConnectProduct(device.productId));
  }

  static async requestReceiver(): Promise<LogitechHidppClient | null> {
    if (!navigator.hid) {
      throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
    }

    const devices = await navigator.hid.requestDevice({
      filters: [
        { vendorId: LOGITECH_VENDOR_ID, usagePage: 0xff00, usage: 0x0001 },
        { vendorId: LOGITECH_VENDOR_ID, usagePage: 0xff00, usage: 0x0002 },
      ],
    });
    const ranked = [...devices]
      .filter((device) => this.isSupported(device))
      .sort((left, right) => this.supportScore(right) - this.supportScore(left));
    const device = ranked[0];
    return device ? new LogitechHidppClient(device) : null;
  }

  static async reconnectAuthorizedReceiver(): Promise<LogitechHidppClient | null> {
    if (!navigator.hid) {
      return null;
    }

    const devices = this.collapseBoltPeers(
      (await navigator.hid.getDevices()).filter((candidate) => this.isSupported(candidate)),
    );
    const ranked = [...devices].sort((left, right) => this.supportScore(right) - this.supportScore(left));
    const device = ranked[0];
    return device ? new LogitechHidppClient(device) : null;
  }

  async readStatus(): Promise<LogitechMouseStatus> {
    await this.open();
    // Which index answers depends on how the mouse is attached, not on which
    // mouse it is, so it is discovered once per connection before anything else.
    await this.resolveDeviceIndex();

    const nameFeature = await this.getFeature(FEATURE.deviceName);
    const firmwareFeature = await this.getFeature(FEATURE.firmware);
    const batteryFeature = await this.getFeature(FEATURE.unifiedBattery);
    const batteryStatusFeature = await this.getFeature(FEATURE.batteryStatus);
    const batteryVoltageFeature = await this.getFeature(FEATURE.batteryVoltage);
    const adcMeasurementFeature = await this.getFeature(FEATURE.adcMeasurement);
    const dpiFeature = await this.resolveDpiFeature();
    // Keyboards, headsets and receivers for other devices all speak HID++, so
    // the picker cannot filter them out by descriptor. A sensor feature is what
    // actually distinguishes a mouse, and it is only knowable once connected.
    if (!dpiFeature.index) {
      throw new NotAMouseError(this.device.productName || "That Logitech device");
    }
    const reportRateFeature = await this.resolveReportRateFeature();
    const profilesFeature = await this.getFeature(FEATURE.onboardProfiles);
    const analogButtonsFeature = await this.getFeature(FEATURE.analogButtons);

    // HID++ receivers expect one request at a time. Keeping the sequence serial
    // also makes every input report unambiguous to the WebHID event handler.
    const name = await this.readName(nameFeature.index);
    const identity = await this.readIdentity(firmwareFeature.index);
    const battery = batteryFeature.index
      // Ordered by how directly each reports charge: 0x1004 and 0x1000 give a
      // percentage outright, while the voltage features only allow an estimate.
      ? await this.readBattery(batteryFeature.index)
      : batteryStatusFeature.index
        ? await this.readBatteryLevelStatus(batteryStatusFeature.index)
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
    // Productivity Bolt mice (MX Master 3S) expose DPI and battery but no
    // 0x8060/0x8061 report-rate feature. Skip rather than throwing.
    const supportedPollingRates = reportRateFeature.index
      ? reportRateFeature.legacy
        ? await this.readLegacyReportRates(reportRateFeature.index)
        : await this.readSupportedPollingRates(reportRateFeature.index)
      : [];
    const pollingRateHz = reportRateFeature.index
      ? reportRateFeature.legacy
        ? await this.readLegacyReportRate(reportRateFeature.index)
        : await this.readPollingRate(reportRateFeature.index)
      : 0;
    const profileState = await this.readProfileState(profilesFeature.index);
    const firmware = await this.readFirmware(firmwareFeature.index);
    const analogButtonTuning = analogButtonsFeature.index
      ? await this.readAnalogButtonTuning(analogButtonsFeature.index)
      : undefined;
    const modeStatusFeature = await this.getFeature(FEATURE.modeStatus);
    const modeStatus = modeStatusFeature.index ? await this.readModeStatus(modeStatusFeature.index) : null;
    // One extra request; the layout it selects is worth surfacing in diagnostics.
    const onboardProfileFormat = profilesFeature.index
      ? await this.request(profilesFeature.index, PROFILE_FN.getInfo)
        .then((reply) => describeProfileFormat(parseProfilesInfo(reply).profileFormatId))
        .catch(() => null)
      : null;
    // Keyed on the reported profile format, not the model, so another mouse on
    // the same format gets the same limits without being named here.
    this.profileFormatId = onboardProfileFormat?.id ?? null;
    this.lodCapabilities = capabilitiesForFormat(onboardProfileFormat?.id);
    this.supportedLods = [...this.lodCapabilities.supportedLods];
    const wired = isWiredHidppConnection(this.device.productId, identity.transportIds, this.isDirectConnect);
    this.wiredConnection = wired;
    // A direct-connect mouse keeps its rate in the onboard profile, so it can
    // only change once that format is verified and actually carries a
    // report-rate field. Anything else stays read-only.
    const profileRateWritable = this.isDirectConnect
      && this.profileFormatId !== null
      && describeProfileFormat(this.profileFormatId).writable
      && capabilitiesForFormat(this.profileFormatId).reportRates !== null;
    const liftOffDistance = decodeLiftOffLevel(dpiState.lod, this.lodCapabilities);
    const hasLiveLiftOffControl = supportsLiveLiftOffControl(dpiFeature.legacy, liftOffDistance);
    const rateLimits = this.lodCapabilities.reportRates;
    const connectionRateCeiling = rateLimits
      ? (wired ? rateLimits.wiredMaxHz : rateLimits.wirelessMaxHz)
      : null;
    const effectiveSupportedPollingRates = connectionRateCeiling
      ? supportedPollingRates.filter((rate) => rate <= connectionRateCeiling)
      : supportedPollingRates;

    return {
      brand: "Logitech",
      name,
      ui: {
        family: "logitech-hidpp",
        // Logitech allows Lift-off Distance modification only when Gaming Surface Mode is set to "on" or "auto"
        lodRequiresSurface: true,
        // Direct-connect mice report their rate but keep the writable copy in
        // the onboard profile. It is editable again once the profile write path
        // is available for that format.
        pollingReadOnly: !reportRateFeature.index || (this.isDirectConnect && !profileRateWritable) ? true : undefined,
        pollingNote: this.isDirectConnect
          ? profileRateWritable
            ? "Stored in this mouse's onboard profile — OpenMouse writes it there."
            : "This mouse stores its polling rate in the onboard profile, so OpenMouse reads it without changing it."
          : !reportRateFeature.index
            ? "This mouse does not expose a HID++ polling-rate control."
            : undefined,
        hideUnsupportedPollingRates: !reportRateFeature.index ? true : undefined,
      },
      batteryPercent: battery.percent,
      batteryVoltageMv: battery.voltageMv ?? null,
      batteryState: battery.state,
      dpi: dpiState.dpi,
      dpiY: dpiState.dpiY,
      supportsSeparateDpiAxes,
      analogButtonTuning,
      liftOffDistance,
      onboardProfileFormat,
      // HID++ exposes no per-field support mask for status1. A power-only
      // variant can leave it reserved at zero, which would falsely decode as
      // Surface Auto and LightForce Optical. Only expose that control bank when
      // the sensor positively reports the related live LOD capability; this is
      // deliberately conservative and avoids a product/model exception.
      gamingSurfaceMode: modeStatus === null || !hasLiveLiftOffControl
        ? null
        : decodeModeStatus(modeStatus, MODE_STATUS.gamingSurface),
      lightforceSwitchMode: modeStatus === null || !hasLiveLiftOffControl
        ? null
        : decodeModeStatus(modeStatus, MODE_STATUS.lightforce),
      // Some profile formats have different wired and wireless ceilings. The
      // active transport comes from HID++ identity rather than a USB PID.
      pollingRateHz: connectionRateCeiling ? Math.min(pollingRateHz, connectionRateCeiling) : pollingRateHz,
      supportedPollingRates: effectiveSupportedPollingRates,
      // Lift-off distance is only reachable through extended DPI (0x2202). On a
      // mouse that exposes just legacy 0x2201 there is nothing to drive, so
      // report an empty set rather than offering buttons that can only fail.
      // Otherwise the levels come from the profile format, which is where the
      // count and the byte encoding are both established.
      supportedLiftOffDistances: hasLiveLiftOffControl ? this.supportedLods : [],
      connectionType: wired ? "Wired" : "Wireless",
      // Without this the shell falls back to its "2.4 GHz receiver" wording,
      // which is wrong for a mouse plugged straight into USB, and imprecise
      // for Logi Bolt (BLE-based) versus Lightspeed.
      connectionDetail: this.isDirectConnect
        ? "Wired USB"
        : this.isBoltReceiver
          ? "Logi Bolt"
          : undefined,
      activeProfile: profileState.activeProfile,
      deviceMode: profileState.deviceMode,
      unitId: identity.unitId,
      modelId: identity.modelId,
      transportIds: identity.transportIds,
      firmware,
    };
  }

  async close(): Promise<void> {
    for (const device of this.listeningDevices) {
      device.removeEventListener("inputreport", this.onInputReport);
      if (device.opened) {
        await device.close().catch(() => undefined);
      }
    }
    this.listeningDevices.clear();
    this.ioDevice = null;
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    if (this.isDirectConnect) {
      // 0x8060's setter rejects live writes on this generation (HID++ error
      // 0x02), and the persistent rate lives in the onboard profile anyway.
      // Write the active profile's report-rate byte; encodeReportRate validates
      // the value against the format the mouse reported. This costs one sector
      // erase/write cycle.
      await this.writeActiveProfile({ reportRateWiredHz: pollingRateHz });
      return pollingRateHz;
    }
    const rateLimits = this.lodCapabilities.reportRates;
    const connectionRateCeiling = rateLimits
      ? (this.wiredConnection ? rateLimits.wiredMaxHz : rateLimits.wirelessMaxHz)
      : null;
    if (connectionRateCeiling !== null && pollingRateHz > connectionRateCeiling) {
      throw new Error(`This connection supports up to ${connectionRateCeiling} Hz.`);
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
      const advertised = await this.readLegacyDpiList(resolved.index);
      const formatLimits = capabilitiesForFormat(this.profileFormatId).dpiStages;
      // Empty legacy lists fall back to the profile format's captured grid,
      // never to a model/PID-specific table.
      this.dpiOptionsCache = advertised.length === 0 && formatLimits
        ? Array.from(
          { length: Math.floor((formatLimits.maxDpi - formatLimits.minDpi) / formatLimits.stepDpi) + 1 },
          (_, step) => formatLimits.minDpi + step * formatLimits.stepDpi,
        )
        : advertised;
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
    // Validate against the levels this device advertised, so adding a model
    // means describing it in readStatus rather than editing this check.
    if (!this.supportedLods.includes(liftOffDistance)) {
      throw new Error(`This mouse supports only ${this.supportedLods.join(" and ")} lift-off distance.`);
    }
    const lod = this.lodCapabilities.lodEncoding[liftOffDistance];
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
    const result = decodeLiftOffLevel(confirmed.lod, this.lodCapabilities);
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

  /**
   * Switches the mouse between running from profile flash and being driven live
   * by software. This is what G HUB's "Onboard Memory Mode" toggle does.
   */
  async setOnboardMode(mode: "Onboard" | "Host"): Promise<"Onboard" | "Host"> {
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) {
      throw new Error("This mouse does not expose onboard-profile controls.");
    }
    const target = mode === "Onboard" ? ONBOARD_MODE.onboard : ONBOARD_MODE.host;
    await this.request(feature.index, PROFILE_FN.setMode, target);

    const confirmed = (await this.request(feature.index, PROFILE_FN.getMode))[3];
    if (confirmed !== target) {
      throw new Error(`The mouse stayed in ${confirmed === ONBOARD_MODE.onboard ? "onboard" : "host"} mode.`);
    }
    return mode;
  }

  /** Switches which stored profile the mouse runs. Volatile — no flash write. */
  async setCurrentProfile(sector: number): Promise<void> {
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) {
      throw new Error("This mouse does not expose onboard-profile controls.");
    }
    await this.request(feature.index, PROFILE_FN.setCurrentProfile, (sector >> 8) & 0xff, sector & 0xff);
  }

  /**
   * Enables or disables a profile slot.
   *
   * WRITES FLASH. The directory sector is read, one flag byte changed, the
   * checksum recomputed and the whole sector written back — one erase/write
   * cycle per call. See docs/logitech-onboard-profiles.md. The write sequence
   * itself has not been verified on hardware; callers should confirm with the
   * user first.
   */
  async setProfileEnabled(sector: number, enabled: boolean): Promise<void> {
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) {
      throw new Error("This mouse does not expose onboard-profile controls.");
    }
    const info = parseProfilesInfo(await this.request(feature.index, PROFILE_FN.getInfo));
    const format = describeProfileFormat(info.profileFormatId);
    if (!format.verified) {
      throw new Error(`Profile format ${format.id} has not been verified on hardware; refusing to write.`);
    }
    const sectorSize = info.sectorSize > 0 && info.sectorSize <= 1024 ? info.sectorSize : 255;

    const directory = await this.readProfileSector(feature.index, 0x0000, sectorSize);
    if (profileCrc(directory) !== storedCrc(directory)) {
      throw new Error("The profile directory failed its checksum; refusing to write.");
    }
    const updated = setDirectoryEnabled(directory, sector, enabled);
    if (updated.every((byte, index) => byte === directory[index])) {
      return; // already in the requested state: never spend a write cycle on a no-op
    }

    await this.writeProfileSector(feature.index, 0x0000, updated);

    const confirmed = await this.readProfileSector(feature.index, 0x0000, sectorSize);
    const entry = parseDirectory(confirmed).find((candidate) => candidate.sector === sector);
    if (!entry || entry.enabled !== enabled) {
      throw new Error("The mouse did not confirm the new profile state.");
    }
  }

  /**
   * Restores every onboard profile byte-for-byte to the vendor's captured
   * defaults, then leaves only the first profile enabled and running.
   *
   * WRITES FLASH. Support is deliberately limited to a profile format and
   * sector geometry for which a complete vendor reset was captured. Using a
   * decoded subset here would leave unknown button or lighting settings behind.
   */
  async resetAllOnboardProfiles(): Promise<void> {
    await this.open();
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) {
      throw new Error("This Logitech mouse does not expose onboard-profile controls.");
    }

    const info = parseProfilesInfo(await this.request(feature.index, PROFILE_FN.getInfo));
    const sectorSize = info.sectorSize > 0 && info.sectorSize <= 1024 ? info.sectorSize : 255;
    const factoryProfile = factoryProfileForFormat(info.profileFormatId, sectorSize);
    if (!factoryProfile) {
      throw new Error(`A complete factory reset has not been captured for profile format ${info.profileFormatId}.`);
    }
    if (profileCrc(factoryProfile) !== storedCrc(factoryProfile)) {
      throw new Error("The built-in factory profile failed its checksum; refusing to write.");
    }

    const directory = await this.readProfileSector(feature.index, 0x0000, sectorSize);
    if (profileCrc(directory) !== storedCrc(directory)) {
      throw new Error("The profile directory failed its checksum; refusing to reset.");
    }
    const entries = parseDirectory(directory);
    if (entries.length === 0) throw new Error("The mouse reported no onboard profiles to reset.");
    const firstSector = entries[0].sector;

    // Host mode keeps the mouse from loading a sector while it is being
    // replaced. The operation deliberately finishes in the vendor-reset state:
    // onboard mode, first sector current, and only that sector enabled.
    await this.setOnboardMode("Host");
    let finished = false;
    try {
      for (const entry of entries) {
        const existing = await this.readProfileSector(feature.index, entry.sector, sectorSize);
        if (!existing.every((byte, index) => byte === factoryProfile[index])) {
          await this.writeProfileSector(feature.index, entry.sector, factoryProfile);
        }
        const confirmed = await this.readProfileSector(feature.index, entry.sector, sectorSize);
        if (!confirmed.every((byte, index) => byte === factoryProfile[index])) {
          throw new Error(`Profile ${entry.sector} did not confirm its factory reset.`);
        }
      }

      // Make the future current profile selectable before disabling the others.
      let updatedDirectory = setDirectoryEnabled(directory, firstSector, true);
      if (!updatedDirectory.every((byte, index) => byte === directory[index])) {
        await this.writeProfileSector(feature.index, 0x0000, updatedDirectory);
      }
      await this.request(feature.index, PROFILE_FN.setCurrentProfile, (firstSector >> 8) & 0xff, firstSector & 0xff);

      for (const entry of entries) {
        updatedDirectory = setDirectoryEnabled(updatedDirectory, entry.sector, entry.sector === firstSector);
      }
      if (!updatedDirectory.every((byte, index) => byte === directory[index])) {
        await this.writeProfileSector(feature.index, 0x0000, updatedDirectory);
      }
      const confirmedDirectory = await this.readProfileSector(feature.index, 0x0000, sectorSize);
      if (!confirmedDirectory.every((byte, index) => byte === updatedDirectory[index])) {
        throw new Error("The mouse did not confirm the reset profile directory.");
      }

      await this.setOnboardMode("Onboard");
      const current = await this.request(feature.index, PROFILE_FN.getCurrentProfile);
      const currentSector = ((current[3] ?? 0) << 8) | (current[4] ?? 0);
      if (currentSector !== firstSector) {
        throw new Error("The profiles were reset, but the mouse did not select the first profile.");
      }
      finished = true;
    } finally {
      // A failed sector write must not strand the mouse in software-controlled
      // host mode. Preserve the original error if recovery also fails.
      if (!finished) await this.setOnboardMode("Onboard").catch(() => undefined);
    }
  }

  /**
   * Sets the bunny-hop timeout on the active profile.
   *
   * WRITES FLASH — one erase/write cycle. Stored as ms / 10, with 0 meaning
   * off; G HUB's range is 100-1000 ms. The encoding is confirmed on hardware,
   * but the write sequence itself is not, so callers should confirm first.
   */
  /**
   * Reads the active profile and the context needed to write it back. Every
   * profile write starts here so the format check, the checksum check and the
   * sector-size fallback cannot drift apart between settings.
   */
  private async openActiveProfile(targetSector?: number): Promise<{
    featureIndex: number;
    sector: number;
    sectorSize: number;
    formatId: number;
    profile: Uint8Array;
  }> {
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) {
      throw new Error("This mouse does not expose onboard-profile controls.");
    }
    const info = parseProfilesInfo(await this.request(feature.index, PROFILE_FN.getInfo));
    const format = describeProfileFormat(info.profileFormatId);
    if (!format.writable) {
      throw new Error(`Profile format ${format.id} profile-content writes have not been verified on hardware.`);
    }

    // A profile can be edited without the mouse being switched to it, so the
    // caller names the sector; only the default follows the running profile.
    let sector = targetSector;
    if (sector === undefined) {
      const active = await this.request(feature.index, PROFILE_FN.getCurrentProfile);
      sector = ((active[3] ?? 0) << 8) | (active[4] ?? 0);
    }
    const sectorSize = info.sectorSize > 0 && info.sectorSize <= 1024 ? info.sectorSize : 255;

    const profile = await this.readProfileSector(feature.index, sector, sectorSize);
    if (profileCrc(profile) !== storedCrc(profile)) {
      throw new Error("The profile failed its checksum; refusing to write.");
    }
    return { featureIndex: feature.index, sector, sectorSize, formatId: format.id, profile };
  }

  /**
   * Writes every changed setting of the active profile in one sector write.
   *
   * Flash is erased a whole sector at a time, so settings that share the sector
   * must be applied together: writing them one at a time would cost an erase
   * cycle each, and each write would be built from a read the previous one had
   * already invalidated.
   */
  async writeActiveProfile(values: {
    bunnyHoppingMs?: number | null;
    dpiStages?: DpiStagePlan | null;
    reportRateWirelessHz?: number | null;
    reportRateWiredHz?: number | null;
    name?: string | null;
    /** Defaults to the running profile when omitted. */
    sector?: number;
  }): Promise<void> {
    const { featureIndex, sector, sectorSize, formatId, profile } = await this.openActiveProfile(values.sector);
    let updated: Uint8Array = profile.slice();

    if (values.bunnyHoppingMs !== null && values.bunnyHoppingMs !== undefined) {
      const invalid = validateBunnyHoppingMs(values.bunnyHoppingMs);
      if (invalid) throw new Error(invalid);
      const offset = layoutForFormat(formatId).bunnyHopping;
      if (offset === null) {
        throw new Error("This profile format has no bunny-hop setting.");
      }
      updated[offset] = values.bunnyHoppingMs / 10;
    }

    if (values.dpiStages) {
      const liveDpiOptions = await this.getDpiOptions();
      const dpiCapabilities = dpiStageCapabilitiesForOptions(
        capabilitiesForFormat(formatId).dpiStages,
        liveDpiOptions,
      );
      const invalid = validateDpiStagePlan(
        values.dpiStages,
        dpiCapabilities,
        formatId < 6,
      );
      if (invalid) throw new Error(invalid);
      for (const [index, stage] of values.dpiStages.stages.entries()) {
        if (!liveDpiOptions.includes(stage.x) || !liveDpiOptions.includes(stage.y)) {
          throw new Error(`Slot ${index + 1} uses a DPI value the connected mouse did not advertise.`);
        }
      }
      updated = encodeDpiStages(updated, formatId, values.dpiStages, dpiCapabilities);
    }

    // The two links are stored separately, so each is set on its own.
    if (values.reportRateWirelessHz) {
      const liveRates = await this.getSupportedPollingRateOptions();
      const allowed = reportRatesForDevice(
        capabilitiesForFormat(formatId).reportRates,
        "wireless",
        liveRates,
        this.wiredConnection ? "wired" : "wireless",
        formatId < 6,
      );
      if (!allowed.includes(values.reportRateWirelessHz)) {
        throw new Error("The connected mouse did not advertise that profile report rate.");
      }
      updated = encodeReportRate(updated, formatId, "wireless", values.reportRateWirelessHz);
    }
    if (values.reportRateWiredHz) {
      const liveRates = await this.getSupportedPollingRateOptions();
      const allowed = reportRatesForDevice(
        capabilitiesForFormat(formatId).reportRates,
        "wired",
        liveRates,
        this.wiredConnection ? "wired" : "wireless",
        formatId < 6,
      );
      if (!allowed.includes(values.reportRateWiredHz)) {
        throw new Error("The connected mouse did not advertise that profile report rate.");
      }
      updated = encodeReportRate(updated, formatId, "wired", values.reportRateWiredHz);
    }

    if (values.name !== null && values.name !== undefined) {
      updated = encodeProfileName(updated, formatId, values.name);
    }

    applyCrc(updated);
    // Encoding is deterministic, so an identical result means nothing changed
    // and the write cycle can be skipped entirely.
    if (updated.every((byte, index) => byte === profile[index])) return;

    await this.writeProfileSector(featureIndex, sector, updated);
    const confirmed = await this.readProfileSector(featureIndex, sector, sectorSize);
    if (!confirmed.every((byte, index) => byte === updated[index])) {
      throw new Error("The mouse did not store the profile as written.");
    }
  }

  async setBunnyHoppingMs(milliseconds: number): Promise<void> {
    await this.writeActiveProfile({ bunnyHoppingMs: milliseconds });
  }

  async setProfileDpiStages(plan: DpiStagePlan): Promise<void> {
    await this.writeActiveProfile({ dpiStages: plan });
  }

  /**
   * memoryAddrWrite declares the destination and length, memoryWrite streams
   * 16 bytes at a time, memoryWriteEnd commits and validates the checksum.
   */
  private async writeProfileSector(featureIndex: number, sector: number, bytes: Uint8Array): Promise<void> {
    await this.requestLong(featureIndex, PROFILE_FN.memoryAddrWrite, [
      (sector >> 8) & 0xff,
      sector & 0xff,
      0x00,
      0x00,
      (bytes.length >> 8) & 0xff,
      bytes.length & 0xff,
    ]);

    for (let offset = 0; offset < bytes.length; offset += 16) {
      const chunk = new Uint8Array(16).fill(0xff);
      chunk.set(bytes.slice(offset, offset + 16));
      await this.requestLong(featureIndex, PROFILE_FN.memoryWrite, [...chunk]);
    }

    await this.request(featureIndex, PROFILE_FN.memoryWriteEnd);
  }

  /**
   * Proves the profile write sequence on hardware.
   *
   * A no-op rewrite would be useless: writing a sector's own bytes back reads
   * identical whether the write landed or was silently ignored. So this flips
   * one byte, checks the change actually appears, then restores it and checks
   * the restore appears too. Both halves must pass.
   *
   * The target is an unused sector — disabled, and never the active profile —
   * so nothing the user relies on is at risk, and the original bytes are held
   * in memory for restore if a step fails midway. Cost is two erase cycles of
   * roughly 100,000, on a sector that is not in use.
   */
  async probeProfileWriteSequence(): Promise<ProfileWriteProbe> {
    await this.open();
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) {
      throw new Error("This mouse does not expose onboard-profile controls.");
    }
    const info = parseProfilesInfo(await this.request(feature.index, PROFILE_FN.getInfo));
    const sectorSize = info.sectorSize > 0 && info.sectorSize <= 1024 ? info.sectorSize : 255;

    const active = await this.request(feature.index, PROFILE_FN.getCurrentProfile);
    const currentSector = ((active[3] ?? 0) << 8) | (active[4] ?? 0);
    const directory = parseDirectory(await this.readProfileSector(feature.index, 0x0000, sectorSize));
    const target = directory.find((entry) => !entry.enabled && entry.sector !== currentSector);
    if (!target) {
      throw new Error(
        "No spare profile to test on. Disable a profile you are not using, then run this again.",
      );
    }

    const original = await this.readProfileSector(feature.index, target.sector, sectorSize);
    if (profileCrc(original) !== storedCrc(original)) {
      throw new Error("The spare profile failed its checksum; refusing to write to it.");
    }

    // Padding is the safest byte to disturb: it carries no setting, and if the
    // restore fails the profile is disabled anyway.
    let offset = -1;
    for (let index = original.length - 3; index >= 0; index -= 1) {
      if (original[index] === 0xff) { offset = index; break; }
    }
    if (offset < 0) offset = original.length - 3;
    const originalByte = original[offset] ?? 0xff;
    const probeByte = originalByte ^ 0x01;

    const probe = original.slice();
    probe[offset] = probeByte;
    applyCrc(probe);

    const steps: ProfileWriteProbeStep[] = [];
    const runStep = async (name: string, expected: Uint8Array): Promise<boolean> => {
      await this.writeProfileSector(feature.index, target.sector, expected);
      const readBack = await this.readProfileSector(feature.index, target.sector, sectorSize);
      const mismatches: ProfileWriteProbeMismatch[] = [];
      for (let index = 0; index < expected.length; index += 1) {
        const want = expected[index] ?? 0;
        const got = readBack[index] ?? 0;
        if (want !== got && mismatches.length < 16) mismatches.push({ offset: index, expected: want, actual: got });
      }
      const checksumValid = profileCrc(readBack) === storedCrc(readBack);
      steps.push({ name, ok: mismatches.length === 0 && checksumValid, checksumValid, mismatches });
      return mismatches.length === 0;
    };

    const changed = await runStep("write probe byte", probe);
    const restored = await runStep("restore original", original);

    return {
      sector: target.sector,
      sectorSize,
      offset,
      originalByte,
      probeByte,
      steps,
      // Both halves matter: the first shows a write takes effect, the second
      // shows it is repeatable and leaves the sector as it was found.
      ok: changed && restored,
      restored,
    };
  }

  /**
   * Reads and retains everything required to recover a legacy format-2/3/4 profile before
   * the semantic write probe starts. The UI copies this object first.
   */
  async prepareProfileContentWriteProbe(): Promise<ProfileContentWriteProbeBackup> {
    await this.open();
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) throw new Error("This mouse does not expose onboard-profile controls.");
    const info = parseProfilesInfo(await this.request(feature.index, PROFILE_FN.getInfo));
    if (!supportsProfileWriteProbe(info.profileFormatId)) {
      throw new Error(`The guided content probe currently supports profile formats 2, 3, and 4, not ${info.profileFormatId}.`);
    }
    const sectorSize = info.sectorSize > 0 && info.sectorSize <= 1024 ? info.sectorSize : 255;
    const modeReply = await this.request(feature.index, PROFILE_FN.getMode);
    const originalMode = modeReply[3] === ONBOARD_MODE.onboard ? "Onboard" : "Host";
    const currentReply = await this.request(feature.index, PROFILE_FN.getCurrentProfile);
    const originalCurrentSector = ((currentReply[3] ?? 0) << 8) | (currentReply[4] ?? 0);
    const directory = await this.readProfileSector(feature.index, 0x0000, sectorSize);
    if (profileCrc(directory) !== storedCrc(directory)) throw new Error("The profile directory checksum is invalid.");
    const target = parseDirectory(directory).find((entry) => entry.enabled) ?? parseDirectory(directory)[0];
    if (!target) throw new Error("The mouse reported no profile to test.");
    const profile = await this.readProfileSector(feature.index, target.sector, sectorSize);
    if (profileCrc(profile) !== storedCrc(profile)) throw new Error("The profile checksum is invalid.");

    const dpiFeature = await this.resolveDpiFeature();
    const rateFeature = await this.resolveReportRateFeature();
    if (!dpiFeature.index || !dpiFeature.legacy || !rateFeature.index || !rateFeature.legacy) {
      throw new Error("Format-4 verification requires legacy DPI and report-rate features.");
    }
    return {
      formatId: info.profileFormatId,
      sector: target.sector,
      sectorSize,
      originalMode,
      originalCurrentSector,
      directory,
      profile,
      dpiOptions: await this.getDpiOptions(),
      reportRates: await this.readLegacyReportRates(rateFeature.index),
    };
  }

  /**
   * Applies temporary format-2/3/4 name, DPI and rate values, confirms each sector
   * read-back, confirms live DPI/rate, and restores the original after every
   * step. The caller must copy the backup before invoking this method.
   */
  async runProfileContentWriteProbe(
    backup: ProfileContentWriteProbeBackup,
  ): Promise<ProfileContentWriteProbeReport> {
    await this.open();
    if (!supportsProfileWriteProbe(backup.formatId)) {
      throw new Error("Only profile formats 2, 3, and 4 are supported by this probe.");
    }
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) throw new Error("This mouse does not expose onboard-profile controls.");
    const info = parseProfilesInfo(await this.request(feature.index, PROFILE_FN.getInfo));
    if (info.profileFormatId !== backup.formatId || info.sectorSize !== backup.sectorSize) {
      throw new Error("The connected mouse no longer matches the copied backup.");
    }
    const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
      left.length === right.length && left.every((byte, index) => byte === right[index]);
    const currentDirectory = await this.readProfileSector(feature.index, 0x0000, backup.sectorSize);
    const currentProfile = await this.readProfileSector(feature.index, backup.sector, backup.sectorSize);
    if (!sameBytes(currentDirectory, backup.directory) || !sameBytes(currentProfile, backup.profile)) {
      throw new Error("The profile changed after the recovery backup was copied; take a new backup.");
    }

    const dpiFeature = await this.resolveDpiFeature();
    const rateFeature = await this.resolveReportRateFeature();
    if (!dpiFeature.index || !dpiFeature.legacy || !rateFeature.index || !rateFeature.legacy) {
      throw new Error("The required legacy DPI or report-rate feature disappeared.");
    }

    const original = decodeOnboardProfile(
      backup.profile,
      backup.formatId,
      { sector: backup.sector, enabled: true },
      false,
    );
    const temporaryName = original.name === "OM_VERIFY" ? "OM_VERIFY_2" : "OM_VERIFY";
    const currentDpi = original.dpiStages[original.defaultDpiIndex ?? 0]?.x;
    const temporaryDpi = backup.dpiOptions.includes(1000) && currentDpi !== 1000
      ? 1000
      : backup.dpiOptions.find((dpi) => dpi !== currentDpi);
    const currentRate = original.reportRateWired;
    const temporaryRate = backup.reportRates.includes(500) && currentRate !== 500
      ? 500
      : backup.reportRates.find((rate) => rate !== currentRate);
    if (!temporaryDpi || !temporaryRate || original.defaultDpiIndex === null || original.dpiStages.length === 0) {
      throw new Error("The mouse did not advertise an alternate safe DPI and polling rate.");
    }

    const dpiStages = original.dpiStages.map((stage) => ({ ...stage }));
    dpiStages[original.defaultDpiIndex] = { x: temporaryDpi, y: temporaryDpi, lod: 0 };
    const runtimeDpiLimits = {
      maxStages: 5,
      minDpi: Math.min(...backup.dpiOptions),
      maxDpi: Math.max(...backup.dpiOptions),
      // The selected probe value is checked against the exact advertised list
      // above. A unit step avoids pretending a sparse device list is uniform.
      stepDpi: 1,
    };
    const maximumRate = Math.max(...backup.reportRates);
    const runtimeRateLimits = { wirelessMaxHz: maximumRate, wiredMaxHz: maximumRate };
    const candidates = [
      {
        setting: "name" as const,
        intended: temporaryName,
        bytes: encodeProfileName(backup.profile, backup.formatId, temporaryName, PROFILE_NAME_MAX_CHARS),
        confirmLive: null,
      },
      {
        setting: "dpi" as const,
        intended: `${temporaryDpi} DPI`,
        bytes: encodeDpiStages(
          backup.profile,
          backup.formatId,
          { stages: dpiStages, defaultIndex: original.defaultDpiIndex },
          runtimeDpiLimits,
        ),
        confirmLive: async () => (await this.readLegacyDpi(dpiFeature.index)).dpi === temporaryDpi,
      },
      {
        setting: "polling" as const,
        intended: `${temporaryRate} Hz`,
        bytes: encodeReportRate(backup.profile, backup.formatId, "wired", temporaryRate, runtimeRateLimits),
        confirmLive: async () => (await this.readLegacyReportRate(rateFeature.index)) === temporaryRate,
      },
    ];

    const steps: ProfileContentWriteProbeStep[] = [];
    for (const candidate of candidates) {
      const step: ProfileContentWriteProbeStep = {
        setting: candidate.setting,
        intended: candidate.intended,
        storedExactly: false,
        liveConfirmed: null,
        restored: false,
        error: null,
      };
      try {
        await this.setOnboardMode("Host");
        await this.writeProfileSector(feature.index, backup.sector, candidate.bytes);
        const readBack = await this.readProfileSector(feature.index, backup.sector, backup.sectorSize);
        step.storedExactly = sameBytes(readBack, candidate.bytes)
          && profileCrc(readBack) === storedCrc(readBack);
        if (!step.storedExactly) throw new Error("The temporary sector did not read back exactly.");
        if (candidate.confirmLive) {
          // Legacy devices reject setCurrentProfile while host mode is active.
          // Enter onboard mode first, matching the normal profile selector.
          await this.setOnboardMode("Onboard");
          await this.setCurrentProfile(backup.sector);
          step.liveConfirmed = await candidate.confirmLive();
          if (!step.liveConfirmed) throw new Error("The live HID++ value did not match the temporary profile value.");
        }
      } catch (error) {
        step.error = error instanceof Error ? error.message : "The verification step failed.";
      } finally {
        await this.setOnboardMode("Host").catch(() => undefined);
        try {
          await this.writeProfileSector(feature.index, backup.sector, backup.profile);
          const restored = await this.readProfileSector(feature.index, backup.sector, backup.sectorSize);
          step.restored = sameBytes(restored, backup.profile)
            && profileCrc(restored) === storedCrc(restored);
        } catch (error) {
          step.error ??= error instanceof Error ? error.message : "Could not restore the original profile.";
        }
      }
      steps.push(step);
      if (!step.restored) break;
    }

    let modeRestored = false;
    try {
      // setCurrentProfile is an onboard-mode operation on legacy hardware. If
      // the mouse started in host mode, briefly select its original sector in
      // onboard mode and only then return it to host mode.
      await this.setOnboardMode("Onboard");
      if (backup.originalCurrentSector > 0) await this.setCurrentProfile(backup.originalCurrentSector);
      if (backup.originalMode === "Host") await this.setOnboardMode("Host");
      const mode = await this.request(feature.index, PROFILE_FN.getMode);
      modeRestored = mode[3] === (backup.originalMode === "Onboard" ? ONBOARD_MODE.onboard : ONBOARD_MODE.host);
    } catch {
      modeRestored = false;
    }
    const finalProfile = await this.readProfileSector(feature.index, backup.sector, backup.sectorSize).catch(() => null);
    const restored = finalProfile !== null && sameBytes(finalProfile, backup.profile)
      && profileCrc(finalProfile) === storedCrc(finalProfile);
    const ok = steps.length === candidates.length
      && steps.every((step) => step.storedExactly && step.restored && step.error === null
        && (step.liveConfirmed === null || step.liveConfirmed))
      && restored && modeRestored;
    return { backup, steps, restored, modeRestored, ok };
  }

  /**
   * Reads and decodes every onboard profile. Deliberately not part of
   * readStatus: a full pass is ~80 HID++ round trips, far too slow for the
   * refresh loop, so the UI loads it on demand.
   */
  async readOnboardProfiles(): Promise<OnboardProfile[]> {
    await this.open();
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) return [];

    const info = parseProfilesInfo(await this.request(feature.index, PROFILE_FN.getInfo));
    if (!info.profileFormatId) return [];

    const active = await this.request(feature.index, PROFILE_FN.getCurrentProfile);
    const currentSector = ((active[3] ?? 0) << 8) | (active[4] ?? 0);
    const sectorSize = info.sectorSize > 0 && info.sectorSize <= 1024 ? info.sectorSize : 255;

    const directory = parseDirectory(await this.readProfileSector(feature.index, 0x0000, Math.min(sectorSize, 64)));
    const profiles: OnboardProfile[] = [];
    for (const entry of directory) {
      const bytes = await this.readProfileSector(feature.index, entry.sector, sectorSize);
      profiles.push(decodeOnboardProfile(bytes, info.profileFormatId, entry, entry.sector === currentSector));
    }
    return profiles;
  }

  /**
   * Collects a self-contained, read-only dump for validating any profile
   * format. Unlike readOnboardProfiles, this keeps the full directory and the
   * raw protocol replies so a maintainer can verify geometry and parsing rather
   * than trusting OpenMouse's current assumptions.
   */
  async readOnboardProfileVerification(): Promise<OnboardProfileVerification> {
    await this.open();
    const feature = await this.getFeature(FEATURE.onboardProfiles);
    if (!feature.index) {
      throw new Error("This mouse does not expose onboard-profile controls.");
    }

    const infoReply = await this.request(feature.index, PROFILE_FN.getInfo);
    const info = parseProfilesInfo(infoReply);
    if (!info.profileFormatId) {
      throw new Error("The mouse did not report an onboard-profile format.");
    }
    const sectorSize = info.sectorSize > 0 && info.sectorSize <= 1024 ? info.sectorSize : 255;
    const modeReply = await this.request(feature.index, PROFILE_FN.getMode);
    const modeValue = modeReply[3] ?? 0;
    const mode = modeValue === ONBOARD_MODE.onboard
      ? "Onboard" as const
      : modeValue === ONBOARD_MODE.host
        ? "Host" as const
        : "Unknown" as const;
    const currentProfileReply = await this.request(feature.index, PROFILE_FN.getCurrentProfile);
    const currentSector = ((currentProfileReply[3] ?? 0) << 8) | (currentProfileReply[4] ?? 0);

    // The directory is evidence too: its flags establish which sectors exist,
    // and its checksum confirms that the complete sector was read correctly.
    const directory = await this.readProfileSector(feature.index, 0x0000, sectorSize);
    const entries = parseDirectory(directory);
    const profiles: OnboardProfile[] = [];
    for (const entry of entries) {
      const bytes = await this.readProfileSector(feature.index, entry.sector, sectorSize);
      profiles.push(decodeOnboardProfile(bytes, info.profileFormatId, entry, entry.sector === currentSector));
    }

    const dpiCapabilities = await this.readDpiVerificationCapability();
    const reportRateCapabilities = await this.readReportRateVerificationCapability();

    return {
      info,
      infoReply,
      mode,
      modeValue,
      modeReply,
      currentSector,
      currentProfileReply,
      directory,
      directoryCrcValid: profileCrc(directory) === storedCrc(directory),
      profiles,
      dpiCapabilities,
      reportRateCapabilities,
    };
  }

  private async verificationFeature(
    extendedId: number,
    legacyId: number,
  ): Promise<VerificationCapability | null> {
    for (const [featureId, kind] of [[extendedId, "extended"], [legacyId, "legacy"]] as const) {
      try {
        const featureReply = await this.request(0x00, 0x00, featureId >> 8, featureId & 0xff);
        const featureIndex = featureReply[3] ?? 0;
        if (!featureIndex) continue;
        return {
          featureId,
          featureIndex,
          featureVersion: featureReply[6] ?? 0,
          kind,
          replies: [{ name: "getFeature", bytes: featureReply }],
          decodedValues: [],
          error: null,
        };
      } catch {
        // Missing optional features must not prevent the profile dump.
      }
    }
    return null;
  }

  private async readDpiVerificationCapability(): Promise<VerificationCapability | null> {
    const resolved = await this.verificationFeature(FEATURE.extendedDpi, FEATURE.adjustableDpi);
    if (!resolved) return null;
    const result = resolved;
    try {
      if (result.kind === "legacy") {
        result.replies.push({
          name: "getSensorDpiList",
          bytes: await this.request(result.featureIndex, 0x10, 0x00),
        });
        result.replies.push({
          name: "getSensorDpi",
          bytes: await this.request(result.featureIndex, 0x20, 0x00),
        });
      } else {
        result.replies.push({
          name: "getSensorCapabilities",
          bytes: await this.request(result.featureIndex, 0x10, 0x00),
        });
        const listBytes: number[] = [];
        for (let page = 0; page < 32; page += 1) {
          const reply = await this.request(result.featureIndex, 0x20, 0x00, 0x00, page);
          result.replies.push({ name: `getSensorDpiList page ${page}`, bytes: reply });
          listBytes.push(...reply.slice(6));
          if (listBytes.some((value, index) => index > 0 && listBytes[index - 1] === 0 && value === 0)) break;
        }
        result.replies.push({
          name: "getSensorDpi",
          bytes: await this.request(result.featureIndex, 0x50),
        });
      }
      result.decodedValues = await this.getDpiOptions();
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Could not read DPI capabilities.";
    }
    return result;
  }

  private async readReportRateVerificationCapability(): Promise<VerificationCapability | null> {
    const resolved = await this.verificationFeature(FEATURE.extendedReportRate, FEATURE.reportRate);
    if (!resolved) return null;
    const result = resolved;
    try {
      if (result.kind === "legacy") {
        const listReply = await this.request(result.featureIndex, 0x00);
        result.replies.push({ name: "getReportRateList", bytes: listReply });
        result.replies.push({
          name: "getReportRate",
          bytes: await this.request(result.featureIndex, 0x10),
        });
        result.decodedValues = decodeReportRateBitmap(listReply[3] ?? 0);
      } else {
        const listReply = await this.request(result.featureIndex, 0x10);
        result.replies.push({ name: "getSupportedReportRates", bytes: listReply });
        result.replies.push({
          name: "getReportRate",
          bytes: await this.request(result.featureIndex, 0x20),
        });
        const flags = ((listReply[3] ?? 0) << 8) | (listReply[4] ?? 0);
        result.decodedValues = REPORT_RATE_HZ.filter((_rate, index) => (flags & (1 << index)) !== 0);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Could not read report-rate capabilities.";
    }
    return result;
  }

  /**
   * memoryRead returns 16 bytes per call and rejects a read running past the
   * end of the sector, so a sector length that is not a multiple of 16 needs its
   * tail fetched from `length - 16`, overlapping the previous chunk.
   */
  private async readProfileSector(featureIndex: number, sector: number, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length);
    const readChunk = async (offset: number): Promise<void> => {
      const reply = await this.requestLong(featureIndex, PROFILE_FN.memoryRead, [
        (sector >> 8) & 0xff,
        sector & 0xff,
        (offset >> 8) & 0xff,
        offset & 0xff,
      ]);
      buffer.set(reply.slice(3, 3 + Math.min(16, length - offset)), offset);
    };

    let offset = 0;
    for (; offset + 16 <= length; offset += 16) {
      await readChunk(offset);
    }
    if (offset < length) {
      await readChunk(length - 16);
    }
    return buffer;
  }

  async setGamingSurfaceMode(mode: GamingSurfaceMode): Promise<GamingSurfaceMode> {
    await this.setModeStatus({ gamingSurface: mode });
    return mode;
  }

  async setLightforceSwitchMode(mode: LightforceSwitchMode): Promise<LightforceSwitchMode> {
    await this.setModeStatus({ lightforce: mode });
    return mode;
  }

  /**
   * Read-modify-write of modeStatus1, then verify. Both fields share the byte,
   * so passing them together writes once instead of twice; the change mask
   * stops the firmware touching bits neither field names.
   * Reading first keeps this correct if a future field spans bits we do not know about.
   */
  async setModeStatus(values: {
    gamingSurface?: GamingSurfaceMode | null;
    lightforce?: LightforceSwitchMode | null;
  }): Promise<void> {
    const requested: Array<{ field: ModeStatusField<string>; mode: string; label: string }> = [];
    if (values.gamingSurface) {
      requested.push({ field: MODE_STATUS.gamingSurface, mode: values.gamingSurface, label: "gaming surface mode" });
    }
    if (values.lightforce) {
      requested.push({ field: MODE_STATUS.lightforce, mode: values.lightforce, label: "LightForce switch mode" });
    }
    if (requested.length === 0) return;

    const label = requested[0]?.label ?? "mode status";
    const feature = await this.getFeature(FEATURE.modeStatus);
    if (!feature.index) {
      throw new Error(`This mouse does not expose ${label} controls.`);
    }

    const current = await this.readModeStatus(feature.index);
    if (current === null) {
      throw new Error(`The mouse did not report its current ${label}.`);
    }
    // Where the firmware persists 0x8090 is unknown, so it may cost a write
    // cycle. Re-selecting the current value is a no-op worth skipping.
    const changes = requested.filter((update) => decodeModeStatus(current, update.field) !== update.mode);
    if (changes.length === 0) return;

    await this.requestLong(feature.index, MODE_STATUS.set, buildModeStatusWriteMany(current, changes));

    const readBack = await this.readModeStatus(feature.index);
    for (const update of changes) {
      const confirmed = readBack === null ? null : decodeModeStatus(readBack, update.field);
      if (confirmed !== update.mode) {
        throw new Error(`The mouse kept ${confirmed ?? "an unknown"} ${update.label} instead of ${update.mode}.`);
      }
    }
  }

  /** Byte 4 of getModeStatus, carrying both the surface and LightForce fields. */
  private async readModeStatus(featureIndex: number): Promise<number | null> {
    const reply = await this.request(featureIndex, MODE_STATUS.get).catch(() => null);
    return reply ? (reply[4] ?? 0) : null;
  }

  private async open(): Promise<void> {
    await this.bindBoltIoDevice();
    const devices = new Set<HIDDevice>([this.device, this.reportDevice]);
    for (const device of devices) {
      if (!device.opened) {
        await device.open();
      }
      if (!this.listeningDevices.has(device)) {
        device.addEventListener("inputreport", this.onInputReport);
        this.listeningDevices.add(device);
      }
    }
  }

  private async bindBoltIoDevice(): Promise<void> {
    const peers = typeof navigator !== "undefined" && navigator.hid
      ? await navigator.hid.getDevices()
      : [];
    this.ioDevice = resolveBoltReportDevice(this.device, peers);
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

  private async readLegacyDpi(featureIndex: number): Promise<{ dpi: number; dpiY: number; lod: number | null }> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose DPI controls.");
    }
    // getSensorDpi(sensor 0): reply data = [sensorIdx, dpiHi, dpiLo, defaultHi, defaultLo].
    const reply = await this.request(featureIndex, 0x20, 0x00);
    const dpi = ((reply[4] ?? 0) << 8) | (reply[5] ?? 0);
    return { dpi, dpiY: dpi, lod: null };
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
    // setSensorDpi(sensor 0, dpi): params = [sensorIdx, dpiHi, dpiLo]. Three
    // Direct endpoints use the short form; receiver-attached mice use long.
    if (this.isDirectConnect) {
      await this.request(featureIndex, 0x30, 0x00, dpi >> 8, dpi & 0xff);
    } else {
      await this.requestLong(featureIndex, 0x30, [0x00, dpi >> 8, dpi & 0xff]);
    }
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
    return decodeReportRateBitmap(reply[3] ?? 0);
  }

  private async getSupportedPollingRateOptions(): Promise<number[]> {
    if (this.supportedPollingRatesCache !== null) return this.supportedPollingRatesCache;
    const feature = await this.resolveReportRateFeature();
    const rates = feature.legacy
      ? await this.readLegacyReportRates(feature.index)
      : await this.readSupportedPollingRates(feature.index);
    this.supportedPollingRatesCache = rates;
    return rates;
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

  /**
   * 0x1004 UNIFIED_BATTERY getStatus: [stateOfCharge, batteryLevel,
   * chargingStatus, externalPower].
   *
   * The charging enum here is NOT the one 0x1000 uses, which is what this
   * previously decoded: on 0x1004, 2 means charging slowly and 4 means a
   * charging fault, where on 0x1000 those are "almost full" and "charging
   * slowly". A slow charge was therefore reported as almost full.
   */
  private async readBattery(featureIndex: number): Promise<BatteryReading> {
    const reply = await this.request(featureIndex, 0x10);
    const percentage = reply[3];
    return {
      percent: percentage <= 100 ? percentage : null,
      state: decodeUnifiedBatteryState(reply[5] ?? -1),
    };
  }

  /**
   * 0x1000 BATTERY_LEVEL_STATUS getBatteryLevelStatus:
   * [dischargeLevel, nextLevel, batteryStatus].
   *
   * Older mice expose only this. Without it they reported no battery at all,
   * because the driver probed 0x1004, 0x1001 and 0x1f20 and nothing else.
   */
  private async readBatteryLevelStatus(featureIndex: number): Promise<BatteryReading> {
    const reply = await this.request(featureIndex, 0x00);
    const percentage = reply[3] ?? 0xff;
    // A mouse that reports level in coarse steps sends 0 with a status, which
    // is a real reading; only an out-of-range value means "no percentage".
    return {
      percent: percentage <= 100 ? percentage : null,
      state: decodeBatteryLevelState(reply[5] ?? -1),
    };
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

  private async readDpi(featureIndex: number): Promise<{ dpi: number; dpiY: number; lod: number | null }> {
    if (!featureIndex) {
      throw new Error("This Logitech mouse does not expose extended DPI controls.");
    }

    const configuration = await this.readDpiConfiguration(featureIndex);
    // The raw byte is returned rather than a level: which byte means which
    // level depends on the profile format, which is read later in readStatus.
    return { dpi: configuration.x, dpiY: configuration.y, lod: configuration.lod };
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

  private async ensureHostControl(): Promise<void> {
    // Direct-connect mice accept live 0x2201 DPI writes while still in onboard
    // mode. Switching them to host control is a persistent state change that
    // would leave the onboard profile bypassed after the tab closes, so leave
    // the mouse in whichever mode the user's own software left it in.
    if (this.isDirectConnect) return;
    const profiles = await this.getFeature(FEATURE.onboardProfiles);
    if (!profiles.index) return;
    const mode = await this.request(profiles.index, 0x20);
    if (mode[3] === 0x02) return;

    // Some mice refuse to hand control to software at all — a G102 answers this
    // with "request unavailable". Writing anyway is not the answer: the setting
    // would land in an onboard profile whose layout we have not decoded, so we
    // would be changing bytes we do not understand. Stop, and say what would
    // make it work.
    const refused = await this.request(profiles.index, 0x10, 0x02).then(() => false, () => true);
    const confirmed = refused ? null : await this.request(profiles.index, 0x20).catch(() => null);
    if (refused || confirmed?.[3] !== 0x02) {
      throw new OnboardOnlyError(this.profileFormatId);
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
    return this.requestWithOptions(featureIndex, functionId, parameters);
  }

  private async requestWithOptions(
    featureIndex: number,
    functionId: number,
    parameters: number[],
    options: { timeoutMs?: number } = {},
  ): Promise<Uint8Array> {
    // Bolt feature traffic only answers on long reports. Lightspeed and wired
    // mice keep the short form for the three-parameter path they were verified
    // with; longer payloads still go through requestLong.
    if (this.isBoltReceiver) {
      return this.requestLong(featureIndex, functionId, parameters, options.timeoutMs);
    }
    if (parameters.length > 3) {
      throw new Error("This WebHID client only sends short, read-only HID++ requests.");
    }

    const report = new Uint8Array([
      this.deviceIndex,
      featureIndex,
      withSoftwareId(functionId),
      parameters[0] ?? 0,
      parameters[1] ?? 0,
      parameters[2] ?? 0,
    ]);
    const response = this.waitForResponse(featureIndex, functionId, options.timeoutMs);
    // Keep the timeout rejection observed even when sendReport itself fails
    // (for example, when a browser selected a protected mouse collection).
    // The original sendReport error is then shown by the control panel.
    void response.catch(() => undefined);
    await this.reportDevice.sendReport(SHORT_REPORT_ID, report);
    return await response;
  }

  private async requestLong(
    featureIndex: number,
    functionId: number,
    parameters: number[],
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Uint8Array> {
    if (parameters.length > 16) {
      throw new Error("HID++ long requests support at most 16 parameter bytes.");
    }
    const report = new Uint8Array(19);
    report[0] = this.deviceIndex;
    report[1] = featureIndex;
    report[2] = withSoftwareId(functionId);
    report.set(parameters, 3);
    const response = this.waitForResponse(featureIndex, functionId, timeoutMs);
    void response.catch(() => undefined);
    await this.reportDevice.sendReport(LONG_REPORT_ID, report);
    return await response;
  }

  private waitForResponse(
    featureIndex: number,
    functionId: number,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.reject === reject);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new HidppTimeoutError(this.isDirectConnect
          ? "The mouse did not answer. Close Logitech G HUB or Logitech Gaming Software, then try again."
          : this.isBoltReceiver
            ? "The mouse did not answer. Move it, close Logi Options+, then try again."
            : "The mouse did not answer. Move it or click a button, then try again."));
      }, timeoutMs);

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
