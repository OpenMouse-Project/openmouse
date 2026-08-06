import type { MouseStatus } from "../mouse-types";
import {
  buildFinalmouseReport,
  decodeFinalmouseReport,
  FINALMOUSE_COMMAND,
  FINALMOUSE_REPORT,
  type FinalmouseTelemetry,
} from "./protocol.ts";

export const FINALMOUSE_VENDOR_ID = 0x361d;
export const FINALMOUSE_ULX_DONGLE_PRODUCT_ID = 0x0100;
export const FINALMOUSE_DISPLAY_NAME = "Finalmouse UltralightX";

const POLLING_RATES = [500, 1000, 2000, 4000, 8000] as const;
const DPI_MIN = 50;
const DPI_MAX = 26000;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class FinalmouseHidClient {
  readonly device: HIDDevice;
  private telemetry: FinalmouseTelemetry = {};
  private reportRevision = 0;
  private listenerAttached = false;
  private readonly reportWaiters = new Set<() => void>();

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
    const update = decodeFinalmouseReport(event.reportId, bytes);
    if (!update) return;
    Object.assign(this.telemetry, update);
    this.reportRevision += 1;
    for (const finish of [...this.reportWaiters]) finish();
  };

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === FINALMOUSE_VENDOR_ID
      && device.productId === FINALMOUSE_ULX_DONGLE_PRODUCT_ID
      && device.collections.some((collection) => collection.usagePage === 0xff00 && collection.usage === 0x0001);
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.listenerAttached) {
      this.device.addEventListener("inputreport", this.onInputReport);
      this.listenerAttached = true;
    }
  }

  async close(): Promise<void> {
    if (this.listenerAttached) {
      this.device.removeEventListener("inputreport", this.onInputReport);
      this.listenerAttached = false;
    }
    if (this.device.opened) await this.device.close();
  }

  displayName(): string {
    return FINALMOUSE_DISPLAY_NAME;
  }

  get pollIntervalMs(): number {
    return 10_000;
  }

  getDpiOptions(): number[] {
    return Array.from({ length: DPI_MAX - DPI_MIN + 1 }, (_, index) => DPI_MIN + index);
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const revision = this.reportRevision;
    await this.write(FINALMOUSE_REPORT.main, FINALMOUSE_COMMAND.liftOffDistance);
    await this.write(FINALMOUSE_REPORT.main, FINALMOUSE_COMMAND.wakeAll);
    await this.write(FINALMOUSE_REPORT.dongle, FINALMOUSE_COMMAND.dongleInfo);
    await this.waitForReport(revision, 1000);
    // Status arrives as a short burst of separate feature reports.
    await pause(75);

    const state = this.telemetry;
    if (state.dpi === undefined || state.pollingRateHz === undefined) {
      throw new Error("The Finalmouse UltralightX did not return its current settings. Make sure the mouse is on and close xpanel or other Finalmouse software.");
    }
    const firmware = [
      state.mouseFirmware ? `Mouse ${state.mouseFirmware}` : null,
      state.dongleRfFirmware ? `Dongle RF ${state.dongleRfFirmware}` : null,
      state.dongleUsbFirmware ? `Dongle USB ${state.dongleUsbFirmware}` : null,
    ].filter((value): value is string => value !== null);
    const connectionDetail = [
      "2.4 GHz receiver",
      state.rssiDbm === undefined ? null : `${state.rssiDbm} dBm`,
    ].filter((value): value is string => value !== null).join(" · ");

    return {
      brand: "Finalmouse",
      name: this.displayName(),
      ui: {
        family: "finalmouse-ulx",
        defaultDisplayName: FINALMOUSE_DISPLAY_NAME,
        hideUnsupportedPollingRates: true,
        forceShowBattery: true,
      },
      batteryPercent: state.batteryPercent ?? null,
      batteryVoltageMv: state.batteryVoltageMv ?? null,
      batteryState: state.chargingState === 1 ? "Charging" : state.chargingState === undefined ? "Unknown" : "Discharging",
      dpi: state.dpi,
      pollingRateHz: state.pollingRateHz,
      supportedPollingRates: [...POLLING_RATES],
      activeProfile: null,
      unitId: state.mouseSerial ?? null,
      connectionType: "Wireless",
      connectionDetail,
      motionSync: state.motionSync ?? null,
      liftOffDistance: state.liftOffDistanceMm === 1 ? "Medium" : state.liftOffDistanceMm === 2 ? "High" : null,
      supportedLiftOffDistances: ["Medium", "High"],
      finalmouseDongleLedMode: state.dongleLedMode ?? null,
      finalmouseTournamentScrollMode: state.tournamentScrollMode ?? null,
      finalmouseTournamentScrollTimeoutMs: state.tournamentScrollTimeoutMs ?? null,
      firmware,
    };
  }

  async setDpi(dpi: number): Promise<number> {
    if (!Number.isInteger(dpi) || dpi < DPI_MIN || dpi > DPI_MAX) throw new Error("Finalmouse UltralightX DPI must be between 50 and 26,000.");
    await this.writeU16(FINALMOUSE_COMMAND.dpi, dpi);
    this.telemetry.dpi = dpi;
    return dpi;
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    if (!(POLLING_RATES as readonly number[]).includes(pollingRateHz)) throw new Error("Unsupported Finalmouse UltralightX polling rate.");
    await this.writeU16(FINALMOUSE_COMMAND.pollingRate, pollingRateHz);
    this.telemetry.pollingRateHz = pollingRateHz;
    return pollingRateHz;
  }

  async setMotionSync(enabled: boolean): Promise<boolean> {
    await this.write(FINALMOUSE_REPORT.main, FINALMOUSE_COMMAND.motionSync, new Uint8Array([enabled ? 1 : 0]));
    this.telemetry.motionSync = enabled;
    return enabled;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<NonNullable<MouseStatus["liftOffDistance"]>> {
    const millimeters = value === "Medium" ? 1 : value === "High" ? 2 : null;
    if (millimeters === null) throw new Error("Finalmouse UltralightX lift-off distance must be 1 mm or 2 mm.");
    await this.write(FINALMOUSE_REPORT.main, FINALMOUSE_COMMAND.liftOffDistance, new Uint8Array([millimeters]));
    this.telemetry.liftOffDistanceMm = millimeters;
    return value;
  }

  async setDongleLedMode(mode: number): Promise<number> {
    if (![0, 1, 2].includes(mode)) throw new Error("Unsupported Finalmouse dongle LED mode.");
    await this.write(FINALMOUSE_REPORT.main, FINALMOUSE_COMMAND.dongleLed, new Uint8Array([mode]));
    this.telemetry.dongleLedMode = mode;
    return mode;
  }

  async setTournamentScrollMode(mode: number): Promise<number> {
    if (![0, 1, 2, 3].includes(mode)) throw new Error("Unsupported Finalmouse tournament scroll mode.");
    await this.write(FINALMOUSE_REPORT.main, FINALMOUSE_COMMAND.tournamentScrollMode, new Uint8Array([mode]));
    this.telemetry.tournamentScrollMode = mode;
    return mode;
  }

  async setTournamentScrollTimeout(milliseconds: number): Promise<number> {
    if (![100, 500, 1000, 1500].includes(milliseconds)) throw new Error("Unsupported Finalmouse tournament scroll timeout.");
    await this.write(FINALMOUSE_REPORT.main, FINALMOUSE_COMMAND.tournamentScrollTimeout, new Uint8Array([milliseconds / 100]));
    this.telemetry.tournamentScrollTimeoutMs = milliseconds;
    return milliseconds;
  }

  private async writeU16(command: number, value: number): Promise<void> {
    await this.write(FINALMOUSE_REPORT.main, command, new Uint8Array([value & 0xff, value >> 8]));
  }

  private async write(reportId: number, command: number, payload = new Uint8Array()): Promise<void> {
    await this.open();
    const report = buildFinalmouseReport(command, payload);
    await this.device.sendReport(reportId, report.buffer as ArrayBuffer);
  }

  private async waitForReport(afterRevision: number, timeoutMs: number): Promise<void> {
    if (this.reportRevision > afterRevision) return;
    await new Promise<void>((resolve) => {
      let timer = 0;
      const finish = (): void => {
        clearTimeout(timer);
        this.reportWaiters.delete(finish);
        resolve();
      };
      timer = setTimeout(finish, timeoutMs);
      this.reportWaiters.add(finish);
    });
  }
}
