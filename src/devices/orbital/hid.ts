import "./host-protocol.js";
import type { MouseStatus } from "../mouse-types";

const VENDOR_ID = 0x1915;
const PRODUCTS = new Map<number, { name: string; wireless: boolean }>([
  [0x080c, { name: "Ghost / Pathfinder V2", wireless: false }],
  [0x080b, { name: "Ghost / Pathfinder V2 receiver", wireless: true }],
  [0x0747, { name: "Pathfinder V1", wireless: false }],
  [0x0746, { name: "Pathfinder V1 receiver", wireless: true }],
]);
const REPORT_RATES = [125, 500, 1000, 2000, 4000, 8000];

type OrbitalProtocolClient = {
  open(): Promise<unknown>;
  close(): Promise<void>;
  readEverything(): Promise<any>;
  applySettings(changes: Record<string, unknown>): Promise<unknown>;
};
type OrbitalProtocol = { OrbitalMouseClient: new (device: HIDDevice) => OrbitalProtocolClient };

function protocol(): OrbitalProtocol {
  const value = (globalThis as typeof globalThis & { OrbitalHostProtocol?: OrbitalProtocol }).OrbitalHostProtocol;
  if (!value) throw new Error("Orbital host protocol did not load.");
  return value;
}

export class OrbitalHidClient {
  private client: OrbitalProtocolClient | null = null;
  private settings: any = null;

  constructor(readonly device: HIDDevice) {}

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID
      && PRODUCTS.has(device.productId)
      && device.collections.some((collection) => collection.usagePage === 0xff0a && collection.usage === 1);
  }

  async open(): Promise<void> {
    if (!this.client) this.client = new (protocol().OrbitalMouseClient)(this.device);
    await this.client.open();
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  getDpiOptions(): number[] {
    const values: number[] = [];
    for (let dpi = 50; dpi <= 30000; dpi += 50) values.push(dpi);
    return values;
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const snapshot = await this.client!.readEverything();
    const { identity, settings, power } = snapshot;
    this.settings = settings;
    const stage = settings.dpiStages[settings.activeDpiStage] ?? [800, 800];
    const definition = PRODUCTS.get(this.device.productId)!;
    return {
      brand: "Orbital",
      name: identity.productName || definition.name,
      ui: { defaultDisplayName: definition.name, hideLodLow: false, hideUnsupportedPollingRates: true },
      batteryPercent: definition.wireless ? power.percent : null,
      batteryState: power.state === 2 ? "Full" : power.state === 1 || power.state === 3 ? "Charging" : "Discharging",
      dpi: stage[0],
      dpiY: stage[1],
      supportsSeparateDpiAxes: true,
      pollingRateHz: settings.reportRateHz,
      supportedPollingRates: REPORT_RATES.slice(0, identity.definition.maxReportRateIndex + 1),
      activeProfile: power.profile + 1,
      connectionType: definition.wireless ? "Wireless" : "Wired",
      motionSync: settings.sensor.motionSync,
      debounceMs: settings.debounceMs,
      sleepTimeout: settings.sleepSeconds,
      angleSnapping: settings.sensor.angleSnapping,
      rippleControl: settings.sensor.rippleControl,
      performanceMode: settings.sensor.maxSpeedMode,
      angleTuning: settings.sensor.angleTuning,
      liftOffDistance: ["Low", "Medium", "High"][settings.sensor.liftOffDistance] as MouseStatus["liftOffDistance"],
      firmware: [`${settings.protocol.toUpperCase()} protocol`],
    };
  }

  private async apply(changes: Record<string, unknown>): Promise<void> {
    await this.open();
    await this.client!.applySettings(changes);
    this.settings = null;
  }

  async setDpi(dpi: number, dpiY = dpi): Promise<void> {
    await this.readStatus();
    const stages = this.settings.dpiStages.map((pair: number[], index: number) => index === this.settings.activeDpiStage ? [dpi, dpiY] : pair);
    await this.apply({ dpiStages: stages, activeDpiStage: this.settings.activeDpiStage });
  }
  async setPollingRate(rate: number): Promise<void> { await this.apply({ reportRateIndex: REPORT_RATES.indexOf(rate) }); }
  async setLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> { await this.apply({ liftOffDistance: ["Low", "Medium", "High"].indexOf(lod) }); }
  async setMotionSync(enabled: boolean): Promise<void> { await this.apply({ motionSync: enabled }); }
  async setAngleSnapping(enabled: boolean): Promise<void> { await this.apply({ angleSnapping: enabled }); }
  async setRippleControl(enabled: boolean): Promise<void> { await this.apply({ rippleControl: enabled }); }
  async setPerformanceMode(enabled: boolean): Promise<void> { await this.apply({ highPerformance: enabled }); }
  async setDebounceTime(value: number): Promise<void> { await this.apply({ debounceMs: value }); }
  async setSleepTimeout(value: number): Promise<void> { await this.apply({ sleepSeconds: value }); }
}
