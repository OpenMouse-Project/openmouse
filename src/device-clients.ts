import {
  eggWeMergeLogicalDevices,
} from "./devices/endgame/egg-we-control";
import {
  clientSupportScore,
  createSupportedClient,
  deviceBrand,
  type PulsarClient,
  type SupportedClient,
} from "./devices/registry";
export { describeHidDevice } from "./hid-diagnostics";
export { clientSupportScore, createSupportedClient, deviceBrand, type PulsarClient, type SupportedClient };

/** Supported devices for the sidebar; multi-path drivers collapse via their module. */
export function listLogicalDevices(devices: HIDDevice[] = []): HIDDevice[] {
  return eggWeMergeLogicalDevices(devices, (device) => createSupportedClient(device) !== null);
}
