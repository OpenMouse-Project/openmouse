import type { MouseStatus } from "./mouse-types";

/**
 * SteelSeries Rival 600 (and Rival 600 Dota 2 Edition).
 *
 * The config surface is USB HID interface 0 — a vendor collection
 * (usage page 0xFFC0/0xFFC1) that exposes *unnumbered* reports:
 * a 32-byte input, a 32-byte output and a 578-byte feature report.
 *
 * Wire format (verified against rivalcfg, which drives the same device):
 *   output  = [0x00 report-id slot] + command + value + suffix
 *   feature = [0x00 report-id slot] + command + header + body
 * WebHID's sendReport(0, …)/sendFeatureReport(0, …) maps reportId 0 onto
 * the unnumbered report, and Chrome's Linux backend injects the 0x00
 * report-id byte — so the bytes reaching the device match rivalcfg exactly.
 *
 * Settings are write-only: the protocol has no read-back command, so the
 * client tracks the last values it applied and reports those.
 */

export const STEELSERIES_VENDOR_ID = 0x1038;

export const RIVAL600_PRODUCTS: ReadonlyMap<number, string> = new Map([
  [0x1724, "SteelSeries Rival 600"],
  [0x172e, "SteelSeries Rival 600 Dota 2 Edition"],
]);

/** Top-level usage pages seen on the Rival 600 vendor config collection. */
const CONFIG_USAGE_PAGES = new Set([0xffc0, 0xffc1]);

const DPI_MIN = 100;
const DPI_MAX = 12000;
const DPI_STEP = 100;
const DPI_DEFAULT = 800;
const POLLING_DEFAULT_HZ = 1000;

/** Delay between chained writes so the mouse never sees back-to-back packets. */
const WRITE_GAP_MS = 60;

// Output-report commands (sendReport(0, command + value + suffix)).
const SENSITIVITY_1_COMMAND = [0x03, 0x00, 0x01];
const SENSITIVITY_2_COMMAND = [0x03, 0x00, 0x02];
const SENSITIVITY_SUFFIX = [0x00, 0x42];
const POLLING_COMMAND = [0x04, 0x00];
const SAVE_COMMAND = [0x09, 0x00];

/** Polling rate → report byte (same mapping as rivalcfg). */
const POLLING_RATES: ReadonlyArray<readonly [number, number]> = [
  [125, 0x04],
  [250, 0x03],
  [500, 0x02],
  [1000, 0x01],
];

/**
 * The Rival 600's 8 LED zones: wheel, logo and the two 3-LED side strips.
 * IDs are the `led_id` byte used by the 0x05 feature command.
 */
export const RIVAL600_LED_ZONES: ReadonlyArray<{ readonly id: number; readonly label: string }> = [
  { id: 0x00, label: "Wheel" },
  { id: 0x01, label: "Logo" },
  { id: 0x02, label: "Left strip · top" },
  { id: 0x03, label: "Right strip · top" },
  { id: 0x04, label: "Left strip · middle" },
  { id: 0x05, label: "Right strip · middle" },
  { id: 0x06, label: "Left strip · bottom" },
  { id: 0x07, label: "Right strip · bottom" },
];

export function steelSeriesLedZoneLabel(zoneId: number): string {
  return RIVAL600_LED_ZONES.find((zone) => zone.id === zoneId)?.label
    ?? `LED 0x${zoneId.toString(16)}`;
}

export class SteelSeriesRival600Client {
  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== STEELSERIES_VENDOR_ID) return false;
    if (!RIVAL600_PRODUCTS.has(device.productId)) return false;
    return device.collections.some((collection) =>
      CONFIG_USAGE_PAGES.has(collection.usagePage)
      && collection.outputReports.some((report) => report.reportId === 0)
      && collection.featureReports.some((report) => report.reportId === 0));
  }

  /** Settings are write-only, so there is nothing to poll after activation. */
  get pollIntervalMs(): number {
    return 0;
  }

  private lastDpi = DPI_DEFAULT;
  private lastPollingRateHz = POLLING_DEFAULT_HZ;
  /** Serializes writes so chained commands keep the configured gap. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly device: HIDDevice) {}

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_MIN; dpi <= DPI_MAX; dpi += DPI_STEP) options.push(dpi);
    return options;
  }

  get supportedPollingRates(): number[] {
    return POLLING_RATES.map(([rate]) => rate);
  }

  async readStatus(): Promise<MouseStatus> {
    return {
      brand: "SteelSeries",
      name: RIVAL600_PRODUCTS.get(this.device.productId)
        ?? this.device.productName
        ?? "SteelSeries Rival 600",
      batteryPercent: null,
      batteryState: "Unknown",
      dpi: this.lastDpi,
      pollingRateHz: this.lastPollingRateHz,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: "Wired",
      connectionDetail: "USB",
      debounceMs: null,
      liftOffDistance: null,
      firmware: [],
      ui: {
        family: "steelseries-rival600",
        hideLodCard: true,
        hideUnsupportedPollingRates: true,
        hideProcessingCard: true,
        pollingNote: "The Rival 600 supports 125, 250, 500, or 1,000 Hz.",
        defaultDisplayName: "SteelSeries Rival 600",
      },
    };
  }

  /**
   * Set the DPI on both on-board sensitivity presets. The Rival 600 cannot
   * report which preset the CPI button currently has selected, so writing both
   * presets guarantees the requested sensitivity becomes active either way.
   */
  async setDpi(dpi: number): Promise<number> {
    if (!this.getDpiOptions().includes(dpi)) {
      throw new Error("The Rival 600 supports DPI from 100 to 12,000 in 100 DPI steps.");
    }
    const value = dpi / DPI_STEP;
    await this.open();
    await this.sendOutput([...SENSITIVITY_1_COMMAND, value, ...SENSITIVITY_SUFFIX]);
    await this.sendOutput([...SENSITIVITY_2_COMMAND, value, ...SENSITIVITY_SUFFIX]);
    await this.saveConfig();
    this.lastDpi = dpi;
    return dpi;
  }

  async setPollingRate(rate: number): Promise<number> {
    const encoded = POLLING_RATES.find(([hz]) => hz === rate)?.[1];
    if (encoded === undefined) {
      throw new Error("The Rival 600 supports 125, 250, 500, or 1,000 Hz.");
    }
    await this.open();
    await this.sendOutput([...POLLING_COMMAND, encoded]);
    await this.saveConfig();
    this.lastPollingRateHz = rate;
    return rate;
  }

  /** The Rival 600 has no lift-off distance control (its LOD is fixed). */
  async setLiftOffDistance(_lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    throw new Error("The Rival 600 does not expose lift-off distance control.");
  }

  /** Apply a static color to one LED zone. */
  async setLedColor(zoneId: number, color: readonly [number, number, number]): Promise<void> {
    if (!RIVAL600_LED_ZONES.some((zone) => zone.id === zoneId)) {
      throw new Error(`Unknown Rival 600 LED zone 0x${zoneId.toString(16)}.`);
    }
    for (const channel of color) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
        throw new Error("LED colors must be RGB values from 0 to 255.");
      }
    }
    await this.open();
    const report = this.buildColorFeatureReport(zoneId, color);
    await this.queueSend(() => this.device.sendFeatureReport(0, report));
    // Persist to onboard memory, matching the DPI and polling-rate paths.
    await this.saveConfig();
  }

  // ---------------------------------------------------------------------------
  // Wire helpers
  // ---------------------------------------------------------------------------

  private async saveConfig(): Promise<void> {
    await this.sendOutput(SAVE_COMMAND);
  }

  private async sendOutput(data: number[]): Promise<void> {
    await this.queueSend(() => this.device.sendReport(0, Uint8Array.from(data)));
  }

  private async queueSend(operation: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      await operation();
      await new Promise((resolve) => window.setTimeout(resolve, WRITE_GAP_MS));
    });
    this.queue = run.catch(() => undefined);
    await run;
  }

  /**
   * Build the 0x05 feature report rivalcfg uses for LED colors:
   *   [0x05, 0x00] + 28-byte header + 7-byte static-color body.
   * The header stores the led_id at offsets 0 and 5, the 1000 ms duration
   * little-endian at offset 6, the repeat flag at 22 and the color count at 27.
   */
  private buildColorFeatureReport(
    ledId: number,
    [red, green, blue]: readonly [number, number, number],
  ): Uint8Array<ArrayBuffer> {
    const header = new Uint8Array(28);
    header[0] = ledId;
    header[5] = ledId;
    header[6] = 1000 & 0xff;
    header[7] = (1000 >> 8) & 0xff;
    header[22] = 0x01; // repeat: static color
    header[23] = 0x00; // triggers: none
    header[27] = 0x01; // color count: 1 stop
    // Body: first stop color, then the color again with a 0 delta position.
    const body = new Uint8Array([red, green, blue, red, green, blue, 0x00]);
    const report = new Uint8Array(2 + header.length + body.length);
    report[0] = 0x05;
    report[1] = 0x00;
    report.set(header, 2);
    report.set(body, 2 + header.length);
    return report;
  }
}
