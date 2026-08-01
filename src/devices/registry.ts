import { EggOp1HidClient } from "./endgame/egg-op1-hid";
import { eggWeCreate, eggWeIsSupported, eggWeSupportScore, isEggWeClient, type EggWeHidClient } from "./endgame/egg-we-control";
import { LogitechHidppClient } from "./logitech/hidpp";
import { PulsarHidClient } from "./pulsar/pulsar-hid";
import { PulsarProHidClient } from "./pulsar/pulsar-pro-hid";
import { WLMouseHidClient } from "./wlmouse/hid";

export type PulsarClient = PulsarHidClient | PulsarProHidClient;
export type SupportedClient = LogitechHidppClient | PulsarClient | EggOp1HidClient | EggWeHidClient | WLMouseHidClient;

interface DeviceDriver {
  brand: string;
  supports(device: HIDDevice): boolean;
  create(device: HIDDevice): SupportedClient | null;
  score(device: HIDDevice): number;
}

const DEVICE_DRIVERS: readonly DeviceDriver[] = [
  { brand: "Endgame Gear", supports: EggOp1HidClient.isSupported, create: (device) => new EggOp1HidClient(device), score: () => 10 },
  { brand: "Endgame Gear", supports: eggWeIsSupported, create: eggWeCreate, score: eggWeSupportScore },
  { brand: "Pulsar", supports: PulsarProHidClient.isSupported, create: (device) => new PulsarProHidClient(device), score: () => 8 },
  { brand: "Pulsar", supports: PulsarHidClient.isSupported, create: (device) => new PulsarHidClient(device), score: () => 7 },
  { brand: "Logitech", supports: LogitechHidppClient.isSupported, create: (device) => new LogitechHidppClient(device), score: () => 6 },
  { brand: "WLMouse", supports: WLMouseHidClient.isSupported, create: (device) => new WLMouseHidClient(device), score: () => 5 },
];

function driverFor(device: HIDDevice): DeviceDriver | undefined {
  return DEVICE_DRIVERS.find((driver) => driver.supports(device));
}

export function createSupportedClient(device: HIDDevice): SupportedClient | null {
  return driverFor(device)?.create(device) ?? null;
}

export function clientSupportScore(device: HIDDevice): number {
  return driverFor(device)?.score(device) ?? 0;
}

export function deviceBrand(client: SupportedClient): string {
  if (client instanceof EggOp1HidClient || isEggWeClient(client)) return "Endgame Gear";
  return driverFor(client.device)?.brand ?? "Unknown";
}
