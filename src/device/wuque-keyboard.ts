import { runKeyboardCommand } from "./keyboard-workspace.ts";
import type { KeyboardCommand, KeyboardWorkspace } from "./keyboard-workspace.ts";
import type { KeyboardStatus } from "@openmouse/keyboard-protocol/drivers";
import { WuqueHidClient } from "@openmouse/keyboard-protocol/drivers/wuque/hid";
import {
  WUQUE_MATRIX_COLS,
  WUQUE_MATRIX_ROWS,
  WUQUE_REPORT_RATE,
  wuqueMatrixKeyLabel,
} from "@openmouse/keyboard-protocol/wuque";
import type {
  WuquePerformanceBlock,
  WuquePerformanceSettings,
} from "@openmouse/keyboard-protocol/wuque";
import type {
  KeyboardIdentityView,
  KeyboardPollingView,
  KeyboardTriggerKey,
  KeyboardTriggerPatch,
  KeyboardTriggerSettings,
} from "./types.ts";
type ReportRateKey = keyof typeof WUQUE_REPORT_RATE;

/** Board rate enums mapped to the polling rates the panel shows, ascending. */
const REPORT_RATE_HZ: Readonly<Record<ReportRateKey, number>> = {
  r8khz: 8000,
  r4khz: 4000,
  r2khz: 2000,
  r1khz: 1000,
  r500hz: 500,
  r250hz: 250,
  r125hz: 125,
};

/**
 * Read-back tolerance, in millimetres. The wire format quantises travel to
 * 0.001 mm, so a value the board echoes differs from the request only by that
 * rounding step.
 */
const TRAVEL_TOLERANCE_MM = 0.002;

function rateKeyForHz(hz: number): ReportRateKey | null {
  for (const key of Object.keys(REPORT_RATE_HZ) as ReportRateKey[]) {
    if (REPORT_RATE_HZ[key] === hz) return key;
  }
  return null;
}

function identityFromStatus(status: KeyboardStatus): KeyboardIdentityView {
  const info = status.wuque?.device.info ?? null;
  return {
    boardId: info?.boardId ?? null,
    capabilities: status.wuque?.device.feature ?? null,
    brand: status.brand,
    name: status.name,
    firmwareVersion: status.firmwareVersion,
    appVersion: info?.appVersion ?? null,
    pcbVersion: info?.pcbVersion ?? null,
    serial: status.serial ?? info?.sn ?? null,
  };
}

function settingsFromBlock(block: WuquePerformanceBlock): KeyboardTriggerSettings {
  return {
    travelMm: block.normalPressMm,
    rtFirstTouchMm: block.rtFirstTouchMm,
    rapidTriggerPressMm: block.rtPressMm,
    rapidTriggerReleaseMm: block.rtReleaseMm,
    deadBandPressMm: block.pressDeadStrokeMm,
    deadBandReleaseMm: block.releaseDeadStrokeMm,
  };
}

function triggerKey(
  row: number,
  col: number,
  keycode: number,
  block: WuquePerformanceBlock,
): KeyboardTriggerKey {
  return {
    row,
    col,
    keycode,
    // Short button label from the vendor's own keycode name table; null when
    // the board reports a code the vendor names nowhere (e.g. 0xF20A).
    keycodeName: wuqueMatrixKeyLabel(keycode) ?? `0x${keycode.toString(16).padStart(4, "0")}`,
    performance: block,
    ...settingsFromBlock(block),
  };
}

/** Throws unless every requested field is what the board re-read holds. */
function assertApplied(
  row: number,
  col: number,
  patch: KeyboardTriggerPatch,
  confirmed: WuquePerformanceBlock,
): void {
  const checks: ReadonlyArray<[number | undefined, number, string]> = [
    [patch.travelMm, confirmed.normalPressMm, "travel"],
    [patch.rapidTriggerPressMm, confirmed.rtPressMm, "rapid trigger press"],
    [patch.rapidTriggerReleaseMm, confirmed.rtReleaseMm, "rapid trigger release"],
    [patch.deadBandPressMm, confirmed.pressDeadStrokeMm, "press dead zone"],
    [patch.deadBandReleaseMm, confirmed.releaseDeadStrokeMm, "release dead zone"],
  ];
  for (const [requested, actual, label] of checks) {
    if (requested === undefined) continue;
    if (Math.abs(requested - actual) > TRAVEL_TOLERANCE_MM) {
      throw new Error(
        `The keyboard reported ${actual} mm for ${label} at row ${row} column ${col}, not ${requested} mm.`,
      );
    }
  }
}

/**
 * Panel-side wrapper around the hardware-verified Wuque Studio HID driver.
 *
 * This is deliberately NOT a `SupportedClient`: keyboards have no DPI, sensor
 * or button grid, and forcing them through the mouse status shape is what the
 * keyboard package exists to avoid. The shared workspace consumes identity,
 * polling, per-key performance, layout, lighting, and onboard configuration.
 */
export class WuqueKeyboardClient {
  readonly family = "wuque";
  readonly brand = "Wuque Studio";
  /** Display name taken from the HID product string. */
  get name(): string { return this.device.productName || "Wuque keyboard"; }
  readonly device: HIDDevice;
  private readonly client: WuqueHidClient;

  constructor(device: HIDDevice) {
    this.device = device;
    this.client = new WuqueHidClient(device);
  }

  /** True for a Wuque command collection (usage page 0xFFB0/0xFF80, usage 1). */
  static isSupported(device: HIDDevice): boolean {
    return WuqueHidClient.isSupported(device);
  }

  open(): Promise<void> {
    return this.client.open();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  command(command: KeyboardCommand): Promise<Partial<KeyboardWorkspace>> {
    return runKeyboardCommand(this.client, command);
  }

  async readIdentity(): Promise<KeyboardIdentityView> {
    return identityFromStatus(await this.client.readStatus());
  }

  async readPolling(): Promise<KeyboardPollingView> {
    const [names, current] = await Promise.all([
      this.client.readReportRates(),
      this.client.readReportRate(),
    ]);
    const supportedHz = names
      .map((name) => (name !== null && name in REPORT_RATE_HZ ? REPORT_RATE_HZ[name as ReportRateKey] : null))
      .filter((hz): hz is number => hz !== null)
      .sort((left, right) => left - right);
    const currentHz = current !== null && current in REPORT_RATE_HZ
      ? REPORT_RATE_HZ[current as ReportRateKey]
      : null;
    return { currentHz, supportedHz };
  }

  /** Write the rate and confirm it by re-reading the board's live selection. */
  async setPollingRate(hz: number): Promise<KeyboardPollingView> {
    const key = rateKeyForHz(hz);
    if (key === null) throw new Error(`Unsupported polling rate: ${hz} Hz.`);
    const acknowledged = await this.client.writeReportRate(key);
    if (!acknowledged) throw new Error("The keyboard did not acknowledge the polling-rate change.");
    const polling = await this.readPolling();
    if (polling.currentHz !== hz) {
      throw new Error(`The keyboard still reports ${polling.currentHz ?? "no"} Hz after the change.`);
    }
    return polling;
  }

  /** Keycodes for the active layer, plus the per-key trigger of every live key. */
  async readTrigger(): Promise<{
    matrix: readonly (readonly number[])[];
    keys: KeyboardTriggerKey[];
  }> {
    const layout = await this.client.readKeyLayout(0);
    const keys: KeyboardTriggerKey[] = [];
    const system = (await this.client.readSystemSetting())?.value === 1 ? 1 : 0;
    for (let row = 0; row < WUQUE_MATRIX_ROWS; row += 1) {
      const defaults = await this.client.readKeyLayoutDefault(system, 0, row);
      for (let col = 0; col < WUQUE_MATRIX_COLS; col += 1) {
        const keycode = layout.rows[row]?.[col] ?? 0;
        const defaultCode = defaults?.keycodes[col] ?? 0;
        if (!(keycode !== 0 && wuqueMatrixKeyLabel(keycode) !== null) && !(defaultCode !== 0 && wuqueMatrixKeyLabel(defaultCode) !== null)) continue;
        const block = await this.client.readPerformance(row, col);
        if (!block) continue;
        keys.push(triggerKey(row, col, keycode, block));
      }
    }
    return { matrix: layout.rows, keys };
  }

  /**
   * Read-modify-write one key: fresh live values for every field the caller
   * did not patch, then a re-read that must match the request before the new
   * settings are reported as applied.
   */
  async writeTrigger(
    row: number,
    col: number,
    patch: KeyboardTriggerPatch,
  ): Promise<KeyboardTriggerSettings> {
    for (const value of Object.values(patch)) {
      if (!Number.isFinite(value) || value < 0 || value > 4) throw new RangeError("Trigger values must be 0–4 mm.");
    }
    this.client.invalidateReadCache();
    const current = await this.client.readPerformance(row, col);
    if (!current) throw new Error(`The keyboard reported no trigger for row ${row} column ${col}.`);
    const settings: WuquePerformanceSettings = {
      row,
      col,
      mode: current.mode,
      normalPressMm: patch.travelMm ?? current.normalPressMm,
      normalReleaseMm: current.normalReleaseMm,
      rtFirstTouchMm: current.rtFirstTouchMm,
      rtPressMm: patch.rapidTriggerPressMm ?? current.rtPressMm,
      rtReleaseMm: patch.rapidTriggerReleaseMm ?? current.rtReleaseMm,
      pressDeadStrokeMm: patch.deadBandPressMm ?? current.pressDeadStrokeMm,
      releaseDeadStrokeMm: patch.deadBandReleaseMm ?? current.releaseDeadStrokeMm,
      axis: current.axis,
      calibrate: current.calibrate,
      axisV2Id: current.axisV2Id,
      axisRangeMax: current.axisRangeMax,
      axisCoefficient: current.axisCoefficient,
    };
    const written = await this.client.writePerformance(settings);
    if (!written) throw new Error("The keyboard did not acknowledge the trigger change.");
    const confirmed = await this.client.readPerformance(row, col);
    if (!confirmed) throw new Error("The keyboard stopped answering before the trigger change could be confirmed.");
    assertApplied(row, col, patch, confirmed);
    return settingsFromBlock(confirmed);
  }
}
