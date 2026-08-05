import {
  WE_CMD_READ_EEPROM,
  WE_CMD_WRITE_EEPROM,
  WE_REPORT_ID,
  weBuildCmdPayload,
  wePackScalarPair,
} from "../endgame/egg-we-protocol.ts";
import type { MouseStatus } from "../mouse-types.ts";
import { VENDOR_ID } from "../vendors.ts";
import { atkDecodeLiftOff, atkPackDpiStage, atkUnpackDpiStage } from "./protocol.ts";

// ATK mice (A9 family and siblings) use the same OEM framing as the Endgame
// Gear WE series — 16-byte EEPROM commands on report 0x08 — but carry them on
// output/input reports rather than feature reports.
const BATTERY_COMMAND = 0x04;
const VERSION_COMMAND = 0x12;
const FRAME_LENGTH = 16;
const DATA_OFFSET = 5;
const MAX_DATA_LENGTH = 10;
const REPLY_TIMEOUT_MS = 500;
const WRITE_SETTLE_MS = 10;

// Byte addresses in the mouse's configuration EEPROM.
const REGISTER = {
  // 0x0000: polling rate, DPI stage count, active DPI stage (value/checksum pairs).
  system: 0x0000,
  liftOffDistance: 0x000a,
  // Four bytes per DPI stage.
  dpiBase: 0x000c,
  // 0x00a9: debounce, motion sync, sleep timer, linear correction, ripple control.
  advanced: 0x00a9,
  // 0x00bd: angle tuning degrees, then the angle-snapping enable flag.
  angle: 0x00bd,
} as const;

const SYSTEM_LENGTH = 6;
const ADVANCED_LENGTH = 10;
const ANGLE_LENGTH = 4;
const DPI_STAGE_LENGTH = 4;
const MAX_DPI_STAGES = 6;

const DPI_MIN = 50;
const DPI_MAX = 42000;
const DEBOUNCE_MAX_MS = 15;
const SLEEP_STEP_SECONDS = 10;
const SLEEP_MAX_SECONDS = 0xff * SLEEP_STEP_SECONDS;
const SLEEP_SECONDS: readonly number[] = [30, 60, 120, 300, 600, 1800];

const POLLING_RATES: ReadonlyArray<readonly [number, number]> = [
  [0x08, 125],
  [0x04, 250],
  [0x02, 500],
  [0x01, 1000],
  [0x10, 2000],
  [0x20, 4000],
  [0x40, 8000],
];

type LiftOffDistance = NonNullable<MouseStatus["liftOffDistance"]>;

/** Register codes are tenths of a millimetre offset by 6 (1 = 0.7 mm). */
const LIFT_OFF_CODES: ReadonlyArray<readonly [number, LiftOffDistance]> = [
  [1, "Low"],
  [4, "Medium"],
  [11, "High"],
];

export class AtkHidClient {
  // Sleep is stored in 10-second units with no "never" value.
  readonly canDisableSleep = false;
  // Written out rather than a parameter property so node --test can strip types.
  readonly device: HIDDevice;

  private queue: Promise<unknown> = Promise.resolve();
  private lastStatus: MouseStatus | null = null;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    const search = (collection: HIDCollectionInfo): boolean =>
      (collection.usagePage === 0xff02 && collection.usage === 0x0002)
      || collection.children.some(search);
    return device.vendorId === VENDOR_ID.atk && device.collections.some(search);
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    this.lastStatus = null;
    if (this.device.opened) await this.device.close();
  }

  /** ATK broadcasts are undocumented; the panel falls back to polling. */
  async startNotifications(): Promise<boolean> {
    return false;
  }

  displayName(): string {
    const name = this.device.productName?.trim();
    if (!name) return "ATK";
    return /^atk/i.test(name) ? name : `ATK ${name}`;
  }

  /**
   * A wired A9 still reports a battery level, so the receiver is identified by
   * its own product string instead: "ATK Nearlink Mouse Dongle" against the
   * mouse's own "ATK A9 PLUS 2.0 NK".
   */
  isWireless(): boolean {
    return /receiver|dongle/i.test(this.device.productName || "");
  }

  maxDpi(): number {
    return DPI_MAX;
  }

  getSleepOptions(): readonly number[] {
    return SLEEP_SECONDS;
  }

  getDebounceMaxMs(): number {
    return DEBOUNCE_MAX_MS;
  }

  getSupportedPollingRates(): number[] {
    return POLLING_RATES.map(([, hertz]) => hertz);
  }

  /**
   * The encoding steps by 10 DPI, then 50 above 10,000 and 100 above 30,000.
   * Models top out below 42,000; writes are confirmed by reading back.
   */
  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_MIN; dpi <= 10000; dpi += 10) options.push(dpi);
    for (let dpi = 10050; dpi <= 30000; dpi += 50) options.push(dpi);
    for (let dpi = 30100; dpi <= DPI_MAX; dpi += 100) options.push(dpi);
    return options;
  }

  async readStatus(live = false): Promise<MouseStatus> {
    await this.open();
    const battery = await this.readBattery();
    const system = await this.read(REGISTER.system, SYSTEM_LENGTH);
    const stage = await this.readDpiStage(this.stageIndex(system));
    if (live && this.lastStatus) {
      return this.lastStatus = {
        ...this.lastStatus,
        batteryPercent: battery,
        pollingRateHz: this.decodePollingRate(system[0]),
        dpi: stage.x,
        dpiY: stage.y,
      };
    }
    const firmware = await this.readFirmware();
    const liftOffDistance = await this.read(REGISTER.liftOffDistance, 2);
    const advanced = await this.read(REGISTER.advanced, ADVANCED_LENGTH);
    const angle = await this.read(REGISTER.angle, ANGLE_LENGTH).catch(() => null);
    return this.lastStatus = {
      brand: "ATK",
      name: this.displayName(),
      ui: {
        family: "atk",
        hideUnsupportedPollingRates: true,
        forceShowBattery: battery !== null,
      },
      batteryPercent: battery,
      batteryState: "Unknown",
      dpi: stage.x,
      dpiY: stage.y,
      supportsSeparateDpiAxes: false,
      pollingRateHz: this.decodePollingRate(system[0]),
      supportedPollingRates: this.getSupportedPollingRates(),
      activeProfile: null,
      connectionType: this.isWireless() ? "Wireless" : "Wired",
      connectionDetail: this.isWireless() ? "2.4 GHz receiver" : "Wired USB",
      debounceMs: advanced[0],
      motionSync: advanced[2] === 1,
      sleepTimeout: advanced[4] * SLEEP_STEP_SECONDS || null,
      rippleControl: advanced[8] === 1,
      angleSnapping: angle ? angle[2] === 1 : null,
      angleTuning: angle ? this.decodeAngle(angle[0]) : null,
      liftOffDistance: this.decodeLiftOffDistance(liftOffDistance[0]),
      firmware,
    };
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    const encoded = POLLING_RATES.find(([, hertz]) => hertz === pollingRateHz);
    if (!encoded) throw new Error(`This mouse does not support ${pollingRateHz} Hz.`);
    await this.write(REGISTER.system, wePackScalarPair(encoded[0]));
    const confirmed = this.decodePollingRate((await this.read(REGISTER.system, SYSTEM_LENGTH))[0]);
    if (confirmed !== pollingRateHz) {
      throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
    }
    this.patch({ pollingRateHz: confirmed });
    return confirmed;
  }

  async setDpi(dpi: number, dpiY: number = dpi): Promise<number> {
    for (const value of [dpi, dpiY]) {
      if (!Number.isInteger(value) || value < DPI_MIN || value > DPI_MAX) {
        throw new Error(`${value.toLocaleString()} is not a supported DPI value.`);
      }
    }
    const index = this.stageIndex(await this.read(REGISTER.system, SYSTEM_LENGTH));
    await this.write(this.dpiAddress(index), atkPackDpiStage(dpi, dpiY));
    const confirmed = await this.readDpiStage(index);
    if (confirmed.x !== dpi || confirmed.y !== dpiY) {
      throw new Error(`The mouse kept ${confirmed.x.toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
    }
    this.patch({ dpi: confirmed.x, dpiY: confirmed.y });
    return confirmed.x;
  }

  async setLiftOffDistance(value: LiftOffDistance): Promise<LiftOffDistance> {
    const encoded = LIFT_OFF_CODES.find(([, name]) => name === value);
    if (!encoded) throw new Error(`This mouse does not support a ${value.toLowerCase()} lift-off distance.`);
    await this.write(REGISTER.liftOffDistance, wePackScalarPair(encoded[0]));
    const confirmed = this.decodeLiftOffDistance((await this.read(REGISTER.liftOffDistance, 2))[0]);
    if (confirmed !== value) {
      throw new Error(`The mouse kept a ${String(confirmed).toLowerCase()} lift-off distance instead of ${value.toLowerCase()}.`);
    }
    this.patch({ liftOffDistance: confirmed });
    return confirmed;
  }

  async setMotionSync(enabled: boolean): Promise<boolean> {
    return await this.setAdvancedFlag(2, enabled, "motionSync", "Motion Sync");
  }

  async setRippleControl(enabled: boolean): Promise<boolean> {
    return await this.setAdvancedFlag(8, enabled, "rippleControl", "ripple control");
  }

  async setAngleSnapping(enabled: boolean): Promise<boolean> {
    const group = await this.read(REGISTER.angle, ANGLE_LENGTH);
    await this.write(REGISTER.angle, [group[0], enabled ? 1 : 0].flatMap((value) => wePackScalarPair(value)));
    const confirmed = (await this.read(REGISTER.angle, ANGLE_LENGTH))[2] === 1;
    if (confirmed !== enabled) throw new Error(`The mouse left angle snapping ${confirmed ? "on" : "off"}.`);
    this.patch({ angleSnapping: confirmed });
    return confirmed;
  }

  async setDebounceTime(milliseconds: number): Promise<number> {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > DEBOUNCE_MAX_MS) {
      throw new Error(`Debounce must be a whole number of milliseconds between 0 and ${DEBOUNCE_MAX_MS}.`);
    }
    const confirmed = await this.writeAdvanced(0, milliseconds);
    if (confirmed !== milliseconds) {
      throw new Error(`The mouse kept ${confirmed} ms of debounce instead of ${milliseconds} ms.`);
    }
    this.patch({ debounceMs: confirmed });
    return confirmed;
  }

  async setSleepTimeout(seconds: number): Promise<number> {
    if (!Number.isInteger(seconds) || seconds < SLEEP_STEP_SECONDS || seconds > SLEEP_MAX_SECONDS) {
      throw new Error(`The sleep timeout must be between ${SLEEP_STEP_SECONDS} and ${SLEEP_MAX_SECONDS} seconds.`);
    }
    const units = Math.round(seconds / SLEEP_STEP_SECONDS);
    const confirmed = await this.writeAdvanced(4, units) * SLEEP_STEP_SECONDS;
    if (confirmed !== units * SLEEP_STEP_SECONDS) {
      throw new Error(`The mouse kept a ${confirmed} second sleep timeout instead of ${seconds} seconds.`);
    }
    this.patch({ sleepTimeout: confirmed });
    return confirmed;
  }

  private async setAdvancedFlag(
    offset: number,
    enabled: boolean,
    field: "motionSync" | "rippleControl",
    label: string,
  ): Promise<boolean> {
    const confirmed = await this.writeAdvanced(offset, enabled ? 1 : 0) === 1;
    if (confirmed !== enabled) throw new Error(`The mouse left ${label} ${confirmed ? "on" : "off"}.`);
    this.patch({ [field]: confirmed });
    return confirmed;
  }

  /** The advanced block is written whole, so read it back, patch one pair, write. */
  private async writeAdvanced(offset: number, value: number): Promise<number> {
    const group = Array.from(await this.read(REGISTER.advanced, ADVANCED_LENGTH));
    group.splice(offset, 2, ...wePackScalarPair(value));
    await this.write(REGISTER.advanced, group);
    return (await this.read(REGISTER.advanced, ADVANCED_LENGTH))[offset];
  }

  private dpiAddress(index: number): number {
    return REGISTER.dpiBase + index * DPI_STAGE_LENGTH;
  }

  private async readDpiStage(index: number): Promise<{ x: number; y: number }> {
    const stage = atkUnpackDpiStage(await this.read(this.dpiAddress(index), DPI_STAGE_LENGTH));
    if (!stage) throw new Error("The mouse reported a DPI stage that failed its checksum.");
    return stage;
  }

  private stageIndex(system: Uint8Array): number {
    const stages = Math.min(Math.max(system[2], 1), MAX_DPI_STAGES);
    return Math.min(system[4], stages - 1);
  }

  private decodePollingRate(value: number): number {
    const match = POLLING_RATES.find(([code]) => code === value);
    if (!match) throw new Error(`The mouse reported an unknown polling-rate value 0x${value.toString(16)}.`);
    return match[1];
  }

  private decodeLiftOffDistance(code: number): LiftOffDistance | null {
    const millimetres = atkDecodeLiftOff(code);
    if (millimetres === null) return null;
    if (millimetres < 1) return "Low";
    return millimetres < 1.5 ? "Medium" : "High";
  }

  private decodeAngle(byte: number): number {
    return byte > 0x80 ? byte - 0x100 : byte;
  }

  private patch(changes: Partial<MouseStatus>): void {
    if (this.lastStatus) this.lastStatus = { ...this.lastStatus, ...changes };
  }

  /**
   * Command 0x12 (GetMouseVersion) reports the version as BCD, matching the
   * Endgame Gear siblings: an A9 Nearlink dongle answering 0x01 0x23 is 1.23.
   */
  private async readFirmware(): Promise<string[]> {
    const reply = await this.exchange(
      weBuildCmdPayload(VERSION_COMMAND),
      (frame) => frame[0] === VERSION_COMMAND,
    ).catch(() => null);
    if (!reply) return [];
    const data = reply.subarray(DATA_OFFSET, DATA_OFFSET + Math.min(reply[4], MAX_DATA_LENGTH));
    if (data.length < 2) return [];
    const bcd = (byte: number) => byte.toString(16).padStart(2, "0");
    return [`Mouse ${Number(bcd(data[0]))}.${bcd(data[1])}`];
  }

  private async readBattery(): Promise<number | null> {
    const reply = await this.exchange(
      weBuildCmdPayload(BATTERY_COMMAND),
      (frame) => frame[0] === BATTERY_COMMAND,
    ).catch(() => null);
    return reply ? Math.min(reply[DATA_OFFSET], 100) : null;
  }

  private async read(address: number, length: number): Promise<Uint8Array> {
    const reply = await this.exchange(
      weBuildCmdPayload(WE_CMD_READ_EEPROM, [0, (address >> 8) & 0xff, address & 0xff, length]),
      // Some firmware answers a read with the write command id.
      (frame) => (frame[0] === WE_CMD_READ_EEPROM || frame[0] === WE_CMD_WRITE_EEPROM)
        && frame[2] === ((address >> 8) & 0xff)
        && frame[3] === (address & 0xff)
        && frame[4] >= length,
    );
    return reply.subarray(DATA_OFFSET, DATA_OFFSET + length);
  }

  private async write(address: number, data: readonly number[]): Promise<void> {
    const payload = weBuildCmdPayload(
      WE_CMD_WRITE_EEPROM,
      [0, (address >> 8) & 0xff, address & 0xff, data.length, ...data],
    );
    await this.run(async () => {
      await this.open();
      // Copy for an ArrayBuffer-backed view, as the WebHID typings require.
      await this.device.sendReport(WE_REPORT_ID, new Uint8Array(payload).buffer);
      await delay(WRITE_SETTLE_MS);
    });
  }

  /** Send a frame and resolve with the first input report the matcher accepts. */
  private async exchange(frame: Uint8Array, matches: (frame: Uint8Array) => boolean): Promise<Uint8Array> {
    return await this.run(async () => {
      await this.open();
      return await new Promise<Uint8Array>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          this.device.removeEventListener("inputreport", listener);
        };
        const timer = setTimeout(() => {
          finish();
          reject(new Error("The mouse did not answer — it may be asleep or out of range."));
        }, REPLY_TIMEOUT_MS);
        const listener = (event: HIDInputReportEvent) => {
          if (event.reportId !== WE_REPORT_ID) return;
          const reply = copyDataView(event.data);
          if (reply.length < FRAME_LENGTH || !matches(reply)) return;
          finish();
          resolve(reply);
        };
        this.device.addEventListener("inputreport", listener);
        this.device.sendReport(WE_REPORT_ID, new Uint8Array(frame).buffer).catch((error: unknown) => {
          finish();
          reject(error);
        });
      });
    });
  }

  private async run<T>(task: () => Promise<T>): Promise<T> {
    const started = this.queue.then(task, task);
    this.queue = started.catch(() => undefined);
    return await started;
  }
}

function copyDataView(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
