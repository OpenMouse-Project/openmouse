import type { MouseStatus } from "../mouse-types.ts";
import { VENDOR_ID } from "../vendors.ts";

interface LamzuProduct {
  model: string;
  wireless: boolean;
  pollingRates: readonly number[];
  maxDpi?: number;
  sleepOptions?: readonly number[];
}

const RATES_1K: readonly number[] = [125, 250, 500, 1000];
const RATES_8K: readonly number[] = [500, 1000, 2000, 4000, 8000];

const SLEEP_SECONDS: readonly number[] = [10, 30, 60, 300, 600, 1800];

const PRODUCTS: ReadonlyMap<number, LamzuProduct> = new Map([
  [0x001c, { model: "Maya X", wireless: false, pollingRates: RATES_1K }],
  [0x001d, { model: "Maya X", wireless: true, pollingRates: RATES_1K }],
  [0x001e, { model: "Maya X", wireless: true, pollingRates: RATES_8K }],
]);

const REPORT_ID = 0;
const PACKET_LENGTH = 64;
const HEADER_LENGTH = 6;
const RESPONSE_ATTEMPTS = 12;
const RESPONSE_DELAY_MS = 30;
const WAKE_DELAY_MS = 300;
const QUICK_ATTEMPTS = 3;
const SLEEP_DISABLED_MIN = 0xff00;
const SLEEP_MAX_SECONDS = 0xfeff;
const PROFILE = 0x01;
const DPI_STEP = 50;
const DPI_MAX = 30000;
const DEBOUNCE_MAX_MS = 15;
const NOTIFY_REPORT_ID = 4;
const NOTIFY_DEBOUNCE_MS = 200;
const NOTIFY_KINDS = new Set([0x03, 0x06, 0x08]);

const STATUS = {
  request: 0x00,
  pending: 0xa0,
  ok: 0xa1,
  unsupported: 0xa2,
} as const;

const TARGET = {
  dongle: 0x00,
  mouse: 0x02,
} as const;

const PAGE = {
  device: 0x00,
  profile: 0x01,
} as const;

const POLLING_RATES: ReadonlyArray<readonly [number, number]> = [
  [0x08, 125],
  [0x04, 250],
  [0x02, 500],
  [0x01, 1000],
  [0x10, 1000],
  [0x20, 2000],
  [0x40, 4000],
  [0x80, 8000],
];

type LiftOffDistance = NonNullable<MouseStatus["liftOffDistance"]>;

const LIFT_OFF_DISTANCES: ReadonlyArray<readonly [number, LiftOffDistance]> = [
  [0x87, "Low"],
  [0x01, "Medium"],
  [0x02, "High"],
];

interface LamzuRequest {
  target: number;
  page: number;
  command: number;
  length: number;
  args: readonly number[];
  attempts?: number;
}

const READ = {
  firmware: { target: TARGET.mouse, page: PAGE.device, command: 0x81, length: 0x10, args: [] },
  dongleFirmware: { target: TARGET.dongle, page: PAGE.device, command: 0x81, length: 0x10, args: [], attempts: 2 },
  battery: { target: TARGET.mouse, page: PAGE.device, command: 0x83, length: 0x02, args: [] },
  activeProfile: { target: TARGET.mouse, page: PAGE.device, command: 0x85, length: 0x01, args: [] },
  sleepTimeout: { target: TARGET.mouse, page: PAGE.device, command: 0x87, length: 0x03, args: [PROFILE] },
  debounce: { target: TARGET.mouse, page: PAGE.device, command: 0x88, length: 0x02, args: [PROFILE] },
  dpiStages: { target: TARGET.mouse, page: PAGE.profile, command: 0x81, length: 0x0a, args: [PROFILE, 0x06] },
  activeStage: { target: TARGET.mouse, page: PAGE.profile, command: 0x82, length: 0x02, args: [PROFILE] },
  pollingRate: { target: TARGET.mouse, page: PAGE.profile, command: 0x80, length: 0x02, args: [PROFILE] },
  liftOffDistance: { target: TARGET.mouse, page: PAGE.profile, command: 0x88, length: 0x02, args: [PROFILE] },
  separateAxes: { target: TARGET.mouse, page: PAGE.profile, command: 0x8d, length: 0x02, args: [PROFILE] },
  angleSnapping: { target: TARGET.mouse, page: PAGE.profile, command: 0x84, length: 0x02, args: [PROFILE] },
  motionSync: { target: TARGET.mouse, page: PAGE.profile, command: 0x89, length: 0x02, args: [PROFILE] },
  rippleControl: { target: TARGET.mouse, page: PAGE.profile, command: 0x8a, length: 0x02, args: [PROFILE] },
} as const satisfies Record<string, LamzuRequest>;

const WRITE = {
  dpiStages: 0x01,
  pollingRate: 0x00,
  liftOffDistance: 0x08,
  sleepTimeout: 0x07,
  debounce: 0x08,
  angleSnapping: 0x04,
  motionSync: 0x09,
  rippleControl: 0x0a,
} as const;

export interface LamzuDpiStage {
  x: number;
  y: number;
}

export class LamzuHidClient {
  readonly canDisableSleep = false;

  private queue: Promise<unknown> = Promise.resolve();
  private readonly staticReads = new Map<string, Promise<Uint8Array | null>>();
  private lastStatus: MouseStatus | null = null;
  private notifier: HIDDevice | null = null;
  private notifyListener: ((event: HIDInputReportEvent) => void) | null = null;

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    const search = (collection: HIDCollectionInfo): boolean =>
      collection.featureReports.some((report) => report.reportId === REPORT_ID)
      || collection.children.some(search);
    return device.vendorId === VENDOR_ID.lamzu
      && PRODUCTS.has(device.productId)
      && device.collections.some(search);
  }

  private profile(): LamzuProduct | undefined {
    return PRODUCTS.get(this.device.productId);
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    this.staticReads.clear();
    this.lastStatus = null;
    if (this.notifier && this.notifyListener) {
      this.notifier.removeEventListener("inputreport", this.notifyListener);
      if (this.notifier.opened) await this.notifier.close();
    }
    this.notifier = null;
    this.notifyListener = null;
    if (this.device.opened) await this.device.close();
  }

  async startNotifications(onChange: () => void): Promise<boolean> {
    if (this.notifier) return true;
    const devices = await navigator.hid?.getDevices() ?? [];
    const sibling = devices.find((candidate) =>
      candidate !== this.device
      && candidate.vendorId === this.device.vendorId
      && candidate.productId === this.device.productId
      && candidate.collections.some((collection) =>
        collection.inputReports.some((report) => report.reportId === NOTIFY_REPORT_ID)));
    if (!sibling) return false;
    if (!sibling.opened) await sibling.open();

    let timer: number | null = null;
    this.notifyListener = (event: HIDInputReportEvent) => {
      if (event.reportId !== NOTIFY_REPORT_ID || !NOTIFY_KINDS.has(event.data.getUint8(0))) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        onChange();
      }, NOTIFY_DEBOUNCE_MS);
    };
    sibling.addEventListener("inputreport", this.notifyListener);
    this.notifier = sibling;
    return true;
  }

  private once(key: string, read: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
    const pending = this.staticReads.get(key);
    if (pending) return pending;
    const started = read();
    this.staticReads.set(key, started);
    started.catch(() => this.staticReads.delete(key));
    return started;
  }

  displayName(): string {
    const known = this.profile();
    return known ? `Lamzu ${known.model}` : this.device.productName || "Lamzu";
  }

  maxDpi(): number {
    return this.profile()?.maxDpi ?? DPI_MAX;
  }

  getSleepOptions(): readonly number[] {
    return this.profile()?.sleepOptions ?? SLEEP_SECONDS;
  }

  getDebounceMaxMs(): number {
    return DEBOUNCE_MAX_MS;
  }

  getSupportedPollingRates(): number[] {
    const listed = this.profile()?.pollingRates;
    if (listed) return [...listed];
    return [...new Set(POLLING_RATES.map(([, hertz]) => hertz))].sort((left, right) => left - right);
  }

  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_STEP; dpi <= this.maxDpi(); dpi += DPI_STEP) options.push(dpi);
    return options;
  }

  isWireless(): boolean {
    const known = this.profile();
    if (known) return known.wireless;
    return /receiver|dongle/i.test(this.device.productName || "");
  }

  async readStatus(live = false): Promise<MouseStatus> {
    await this.open();
    if (live && this.lastStatus) return await this.readLiveStatus(this.lastStatus);
    const wireless = this.isWireless();
    const firmware = await this.once("firmware", () => this.request(READ.firmware));
    if (!firmware) throw new Error("The mouse did not report a firmware version.");
    const dongleFirmware = await this.once("dongleFirmware", () =>
      wireless ? this.request(READ.dongleFirmware).catch(() => null) : Promise.resolve(null));
    const battery = await this.request(READ.battery);
    const sleepTimeout = await this.request(READ.sleepTimeout).catch(() => null);
    const debounce = await this.request(READ.debounce).catch(() => null);
    const stages = this.decodeDpiStages(await this.request(READ.dpiStages));
    const activeStage = this.stageIndex((await this.request(READ.activeStage))[1], stages.length);
    const pollingRate = await this.request(READ.pollingRate);
    const liftOffDistance = await this.request(READ.liftOffDistance);
    const separateAxes = await this.request(READ.separateAxes).catch(() => null);
    const activeProfile = await this.request(READ.activeProfile).catch(() => null);
    const angleSnapping = await this.request(READ.angleSnapping).catch(() => null);
    const motionSync = await this.request(READ.motionSync).catch(() => null);
    const rippleControl = await this.request(READ.rippleControl).catch(() => null);
    const stage = stages[activeStage];
    if (!stage) throw new Error("The mouse did not report any DPI stages.");
    return this.lastStatus = {
      brand: "Lamzu",
      name: this.displayName(),
      ui: {
        family: "lamzu",
        hideUnsupportedPollingRates: true,
        forceShowBattery: true,
      },
      batteryPercent: battery[1] <= 100 ? battery[1] : null,
      batteryState: battery[0] === 1 ? "Charging" : "Discharging",
      dpi: stage.x,
      dpiY: stage.y,
      supportsSeparateDpiAxes: separateAxes ? separateAxes[1] === 1 : false,
      pollingRateHz: this.decodePollingRate(pollingRate[1]),
      supportedPollingRates: this.getSupportedPollingRates(),
      activeProfile: activeProfile ? activeProfile[0] : null,
      angleSnapping: angleSnapping ? angleSnapping[1] === 1 : null,
      motionSync: motionSync ? motionSync[1] === 1 : null,
      rippleControl: rippleControl ? rippleControl[1] === 1 : null,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: wireless ? "2.4 GHz receiver" : "Wired USB",
      debounceMs: debounce ? debounce[1] : null,
      sleepTimeout: this.decodeSleepTimeout(sleepTimeout),
      liftOffDistance: this.decodeLiftOffDistance(liftOffDistance[1]),
      firmware: dongleFirmware
        ? [this.decodeFirmware("Mouse", firmware), this.decodeFirmware("Dongle", dongleFirmware)]
        : [this.decodeFirmware("Mouse", firmware)],
    };
  }

  private async readLiveStatus(previous: MouseStatus): Promise<MouseStatus> {
    const battery = await this.request(READ.battery);
    const pollingRate = await this.request(READ.pollingRate);
    return this.lastStatus = {
      ...previous,
      batteryPercent: battery[1] <= 100 ? battery[1] : null,
      batteryState: battery[0] === 1 ? "Charging" : "Discharging",
      pollingRateHz: this.decodePollingRate(pollingRate[1]),
    };
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    const encoded = POLLING_RATES.find(([, hertz]) => hertz === pollingRateHz);
    if (!encoded || !this.getSupportedPollingRates().includes(pollingRateHz)) {
      throw new Error(`This mouse does not support ${pollingRateHz} Hz.`);
    }
    await this.write(PAGE.profile, WRITE.pollingRate, [encoded[0]]);
    const confirmed = this.decodePollingRate((await this.request(READ.pollingRate))[1]);
    if (confirmed !== pollingRateHz) {
      throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
    }
    this.patch({ pollingRateHz: confirmed });
    return confirmed;
  }

  async setLiftOffDistance(value: LiftOffDistance): Promise<LiftOffDistance> {
    const encoded = LIFT_OFF_DISTANCES.find(([, name]) => name === value);
    if (!encoded) throw new Error(`This mouse does not support a ${value.toLowerCase()} lift-off distance.`);
    await this.write(PAGE.profile, WRITE.liftOffDistance, [encoded[0]]);
    const confirmed = this.decodeLiftOffDistance((await this.request(READ.liftOffDistance))[1]);
    if (confirmed !== value) {
      throw new Error(`The mouse kept a ${String(confirmed).toLowerCase()} lift-off distance instead of ${value.toLowerCase()}.`);
    }
    this.patch({ liftOffDistance: confirmed });
    return confirmed;
  }

  async setAngleSnapping(enabled: boolean): Promise<boolean> {
    return await this.setFlag(WRITE.angleSnapping, READ.angleSnapping, enabled, "angleSnapping", "angle snapping");
  }

  async setMotionSync(enabled: boolean): Promise<boolean> {
    return await this.setFlag(WRITE.motionSync, READ.motionSync, enabled, "motionSync", "Motion Sync");
  }

  async setRippleControl(enabled: boolean): Promise<boolean> {
    return await this.setFlag(WRITE.rippleControl, READ.rippleControl, enabled, "rippleControl", "ripple control");
  }

  private async setFlag(
    command: number,
    read: LamzuRequest,
    enabled: boolean,
    field: "angleSnapping" | "motionSync" | "rippleControl",
    label: string,
  ): Promise<boolean> {
    await this.write(PAGE.profile, command, [enabled ? 1 : 0]);
    const confirmed = (await this.request(read))[1] === 1;
    if (confirmed !== enabled) {
      throw new Error(`The mouse left ${label} ${confirmed ? "on" : "off"}.`);
    }
    this.patch({ [field]: confirmed });
    return confirmed;
  }

  async setDebounceTime(milliseconds: number): Promise<number> {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > DEBOUNCE_MAX_MS) {
      throw new Error(`Debounce must be a whole number of milliseconds between 0 and ${DEBOUNCE_MAX_MS}.`);
    }
    await this.write(PAGE.device, WRITE.debounce, [milliseconds]);
    const confirmed = (await this.request(READ.debounce))[1];
    if (confirmed !== milliseconds) {
      throw new Error(`The mouse kept ${confirmed} ms of debounce instead of ${milliseconds} ms.`);
    }
    this.patch({ debounceMs: confirmed });
    return confirmed;
  }

  async setSleepTimeout(seconds: number): Promise<number> {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > SLEEP_MAX_SECONDS) {
      throw new Error(`The sleep timeout must be a whole number of seconds between 1 and ${SLEEP_MAX_SECONDS}.`);
    }
    await this.write(PAGE.device, WRITE.sleepTimeout, [seconds >> 8 & 0xff, seconds & 0xff]);
    const reply = await this.request(READ.sleepTimeout);
    const confirmed = (reply[1] << 8) | reply[2];
    if (confirmed !== seconds) {
      throw new Error(`The mouse kept a ${confirmed} second sleep timeout instead of ${seconds} seconds.`);
    }
    this.patch({ sleepTimeout: this.decodeSleepTimeout(reply) });
    return confirmed;
  }

  async setDpi(dpi: number, dpiY: number = dpi): Promise<number> {
    const ceiling = this.maxDpi();
    for (const value of [dpi, dpiY]) {
      if (!Number.isInteger(value) || value < DPI_STEP || value > ceiling || value % DPI_STEP !== 0) {
        throw new Error(`${value.toLocaleString()} is not a supported DPI value.`);
      }
    }
    const stages = this.decodeDpiStages(await this.request(READ.dpiStages));
    const active = this.stageIndex((await this.request(READ.activeStage))[1], stages.length);
    if (!stages[active]) throw new Error("The mouse did not report any DPI stages.");
    stages[active] = { x: dpi, y: dpiY };
    await this.write(PAGE.profile, WRITE.dpiStages, [
      stages.length,
      ...stages.flatMap((stage) => [stage.x >> 8 & 0xff, stage.x & 0xff, stage.y >> 8 & 0xff, stage.y & 0xff]),
    ]);
    const confirmed = this.decodeDpiStages(await this.request(READ.dpiStages))[active];
    if (!confirmed || confirmed.x !== dpi || confirmed.y !== dpiY) {
      throw new Error(`The mouse kept ${confirmed ? confirmed.x.toLocaleString() : "an unknown"} DPI instead of ${dpi.toLocaleString()}.`);
    }
    this.patch({ dpi: confirmed.x, dpiY: confirmed.y });
    return confirmed.x;
  }

  private async write(page: number, command: number, values: readonly number[]): Promise<void> {
    const args = [PROFILE, ...values];
    await this.request({ target: TARGET.mouse, page, command, length: args.length, args });
  }

  private patch(changes: Partial<MouseStatus>): void {
    if (this.lastStatus) this.lastStatus = { ...this.lastStatus, ...changes };
  }

  private stageIndex(reported: number, count: number): number {
    return Math.min(Math.max(reported, 1), Math.max(count, 1)) - 1;
  }

  private async request(spec: LamzuRequest): Promise<Uint8Array> {
    const run = this.queue.then(() => this.exchange(spec), () => this.exchange(spec));
    this.queue = run.catch(() => undefined);
    return await run;
  }

  private async exchange(spec: LamzuRequest): Promise<Uint8Array> {
    await this.open();
    const packet = new Uint8Array(PACKET_LENGTH);
    packet[0] = STATUS.request;
    packet[2] = spec.target;
    packet[3] = spec.length;
    packet[4] = spec.page;
    packet[5] = spec.command;
    packet.set(spec.args, HEADER_LENGTH);
    await this.device.sendFeatureReport(REPORT_ID, packet);

    const attempts = spec.attempts ?? RESPONSE_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const reply = this.copyDataView(await this.device.receiveFeatureReport(REPORT_ID));
      if (reply[0] === STATUS.unsupported) throw new Error(this.describe(spec, "is not supported by this mouse"));
      if (reply[0] === STATUS.ok && reply[4] === spec.page && reply[5] === spec.command) {
        const length = Math.min(reply[3], PACKET_LENGTH - HEADER_LENGTH);
        return reply.slice(HEADER_LENGTH, HEADER_LENGTH + length);
      }
      if (reply[0] !== STATUS.pending && reply[0] !== STATUS.ok) {
        throw new Error(this.describe(spec, `returned an unexpected status 0x${reply[0].toString(16)}`));
      }
      await this.delay(attempt < QUICK_ATTEMPTS ? RESPONSE_DELAY_MS : WAKE_DELAY_MS);
    }
    throw new Error(this.describe(spec, "got no answer — the mouse may be asleep or out of range"));
  }

  private describe(spec: LamzuRequest, problem: string): string {
    const hex = (value: number) => `0x${value.toString(16).padStart(2, "0")}`;
    return `Page ${hex(spec.page)} command ${hex(spec.command)} ${problem}.`;
  }

  private decodeDpiStages(payload: Uint8Array): LamzuDpiStage[] {
    const count = payload[1];
    const stages: LamzuDpiStage[] = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 2 + index * 4;
      if (offset + 3 >= payload.length) break;
      stages.push({
        x: (payload[offset] << 8) | payload[offset + 1],
        y: (payload[offset + 2] << 8) | payload[offset + 3],
      });
    }
    return stages;
  }

  private decodePollingRate(value: number): number {
    const match = POLLING_RATES.find(([mask]) => mask === value);
    if (!match) throw new Error(`The mouse reported an unknown polling-rate value 0x${value.toString(16)}.`);
    return match[1];
  }

  private decodeLiftOffDistance(value: number): LiftOffDistance | null {
    if (!value) return null;
    const millimetres = (value & 0x80) !== 0 ? (value & 0x7f) / 10 : value;
    if (millimetres < 1) return "Low";
    return millimetres < 2 ? "Medium" : "High";
  }

  private decodeSleepTimeout(payload: Uint8Array | null): number | null {
    if (!payload || payload.length < 3) return null;
    const seconds = (payload[1] << 8) | payload[2];
    return seconds === 0 || seconds >= SLEEP_DISABLED_MIN ? null : seconds;
  }

  private decodeFirmware(label: string, payload: Uint8Array | null): string {
    if (!payload || payload.length < 4) return `${label} firmware unavailable`;
    return `${label} ${payload[2]}.${payload[3]}`;
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
