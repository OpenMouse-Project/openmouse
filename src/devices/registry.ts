import { AtkHidClient } from "./atk/hid";
import { EggOp1HidClient } from "./endgame/egg-op1-hid";
import { eggWeCreate, eggWeIsSupported, eggWeSupportScore, isEggWeClient, type EggWeHidClient } from "./endgame/egg-we-control";
import { LamzuHidClient } from "./lamzu/hid";
import { LogitechHidppClient } from "./logitech/hidpp";
import { OrbitalHidClient } from "./orbital/hid";
import { PulsarHidClient } from "./pulsar/pulsar-hid";
import { PulsarProHidClient } from "./pulsar/pulsar-pro-hid";
import { RazerHidClient } from "./razer/hid";
import { TeevolutionHidClient } from "./teevolution/hid";
import { WLMouseHidClient } from "./wlmouse/hid";

export type PulsarClient = PulsarHidClient | PulsarProHidClient;
export type SupportedClient = LogitechHidppClient | PulsarClient | EggOp1HidClient | EggWeHidClient | WLMouseHidClient | LamzuHidClient | OrbitalHidClient | RazerHidClient | TeevolutionHidClient | AtkHidClient;

interface DeviceDriver {
  brand: string;
  supports(device: HIDDevice): boolean;
  create(device: HIDDevice): SupportedClient | null;
  score(device: HIDDevice): number;
}

const DEVICE_DRIVERS: readonly DeviceDriver[] = [
  { brand: "Endgame Gear", supports: (device) => EggOp1HidClient.isSupported(device), create: (device) => new EggOp1HidClient(device), score: () => 10 },
  { brand: "Endgame Gear", supports: eggWeIsSupported, create: eggWeCreate, score: eggWeSupportScore },
  { brand: "Pulsar", supports: (device) => PulsarProHidClient.isSupported(device), create: (device) => new PulsarProHidClient(device), score: () => 8 },
  { brand: "Pulsar", supports: (device) => PulsarHidClient.isSupported(device), create: (device) => new PulsarHidClient(device), score: () => 7 },
  { brand: "Teevolution", supports: (device) => TeevolutionHidClient.isSupported(device), create: (device) => new TeevolutionHidClient(device), score: () => 7 },
  { brand: "Logitech", supports: (device) => LogitechHidppClient.isSupported(device), create: (device) => new LogitechHidppClient(device), score: () => 6 },
  { brand: "WLMouse", supports: (device) => WLMouseHidClient.isSupported(device), create: (device) => new WLMouseHidClient(device), score: () => 5 },
  { brand: "Lamzu", supports: (device) => LamzuHidClient.isSupported(device), create: (device) => new LamzuHidClient(device), score: () => 5 },
  { brand: "Orbital", supports: (device) => OrbitalHidClient.isSupported(device), create: (device) => new OrbitalHidClient(device), score: () => 6 },
  { brand: "Razer", supports: (device) => RazerHidClient.isSupported(device), create: (device) => new RazerHidClient(device), score: () => 6 },
  { brand: "ATK", supports: (device) => AtkHidClient.isSupported(device), create: (device) => new AtkHidClient(device), score: () => 5 },
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
