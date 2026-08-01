import { EggOp1HidClient } from "./egg-op1-hid";
import {
  eggWeCreate,
  eggWeIsSupported,
  eggWeMergeLogicalDevices,
  eggWeSupportScore,
  isEggWeClient,
  type EggWeHidClient,
} from "./egg-we-control";
import { LogitechHidppClient } from "./logitech-hidpp";
import { PulsarHidClient } from "./pulsar-hid";
import { PulsarProHidClient } from "./pulsar-pro-hid";
import { WLMouseHidClient } from "./wlmouse-hid";

export type PulsarClient = PulsarHidClient | PulsarProHidClient;
export type SupportedClient = LogitechHidppClient | PulsarClient | EggOp1HidClient | EggWeHidClient | WLMouseHidClient;

export function createSupportedClient(device: HIDDevice): SupportedClient | null {
  if (EggOp1HidClient.isSupported(device)) return new EggOp1HidClient(device);
  if (eggWeIsSupported(device)) return eggWeCreate(device);
  if (PulsarProHidClient.isSupported(device)) return new PulsarProHidClient(device);
  if (PulsarHidClient.isSupported(device)) return new PulsarHidClient(device);
  if (LogitechHidppClient.isSupported(device)) return new LogitechHidppClient(device);
  if (WLMouseHidClient.isSupported(device)) return new WLMouseHidClient(device);
  return null;
}

export function deviceBrand(client: SupportedClient): string {
  if (client instanceof EggOp1HidClient || isEggWeClient(client)) return "Endgame Gear";
  if (client instanceof LogitechHidppClient) return "Logitech";
  if (client instanceof WLMouseHidClient) return "WLMouse";
  return "Pulsar";
}

/** Supported devices for the sidebar; multi-path drivers collapse via their module. */
export function listLogicalDevices(devices: HIDDevice[] = []): HIDDevice[] {
  return eggWeMergeLogicalDevices(devices, (device) => createSupportedClient(device) !== null);
}

export function clientSupportScore(device: HIDDevice): number {
  if (EggOp1HidClient.isSupported(device)) return 10;
  if (eggWeIsSupported(device)) return eggWeSupportScore(device);
  if (PulsarProHidClient.isSupported(device)) return 8;
  if (PulsarHidClient.isSupported(device)) return 7;
  if (LogitechHidppClient.isSupported(device)) return 6;
  return 0;
}

export function describeHidDevice(device: HIDDevice): string {
  const name = device.productName || "unknown";
  const ids = `VID 0x${device.vendorId.toString(16)} PID 0x${device.productId.toString(16)}`;
  const collections = device.collections.map((collection) => {
    const features = collection.featureReports.map((report) => `0x${report.reportId.toString(16)}`).join(",") || "none";
    return `usage 0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)} feat[${features}]`;
  }).join(" | ") || "no collections";
  return `${name} (${ids}; ${collections})`;
}
