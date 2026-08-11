import {
  eggWeMergeLogicalDevices,
} from "@openmouse/protocol/drivers/endgame/egg-we-control";
import { collapseBoltPeers } from "@openmouse/protocol/drivers/logitech/bolt";
import {
  clientSupportScore,
  createSupportedClient,
  deviceBrand,
  type PulsarClient,
  type SupportedClient,
} from "@openmouse/protocol/drivers/registry";
export { describeHidDevice } from "./hid-diagnostics";
export { clientSupportScore, createSupportedClient, deviceBrand, type PulsarClient, type SupportedClient };

/** Supported devices for the sidebar; multi-path drivers collapse via their module. */
export function listLogicalDevices(devices: HIDDevice[] = []): HIDDevice[] {
  const afterEgg = eggWeMergeLogicalDevices(devices, (device) => createSupportedClient(device) !== null);
  return collapseBoltPeers(afterEgg);
}
