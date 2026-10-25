import { KochiKeyboardClient } from "./kochi-keyboard.ts";
import type { KeyboardClient } from "./keyboard-client.ts";
import { WuqueKeyboardClient } from "./wuque-keyboard.ts";
import type { PulsarClient, SupportedClient } from "@openmouse/protocol/drivers/registry";
export { describeHidDevice } from "./hid-diagnostics.ts";
export { type PulsarClient, type SupportedClient };

type NativeBridgeDevice = HIDDevice & { openMouseTransport?: "bridge" };

// The driver registry pulls in every vendor module (~1.2 MB minified) while a
// session only ever talks to one of them. Loading it behind a dynamic import
// keeps it out of the initial bundle; every caller here is already async, and
// the promise is shared so parallel scans never double-fetch. Once loaded, the
// registry's sync functions are used directly — no behavioural difference from
// the old static wiring, only when the bytes arrive.
type Registry = typeof import("@openmouse/protocol/drivers/registry");

let registryPromise: Promise<Registry> | null = null;

function loadRegistry(): Promise<Registry> {
  registryPromise ??= import("@openmouse/protocol/drivers/registry");
  return registryPromise;
}

type RazerBridgeModules = typeof import("@openmouse/protocol/drivers/razer/hid")
  & typeof import("@openmouse/protocol/drivers/razer/cobra-hid")
  & typeof import("@openmouse/protocol/drivers/razer/viper-hid")
  & typeof import("@openmouse/protocol/drivers/razer/viper-mini-hid")
  & typeof import("@openmouse/protocol/drivers/razer/viper-v4-pro-hid")
  & typeof import("@openmouse/protocol/razer-devices");

let razerBridgePromise: Promise<RazerBridgeModules> | null = null;

function loadRazerBridge(): Promise<RazerBridgeModules> {
  razerBridgePromise ??= Promise.all([
    import("@openmouse/protocol/drivers/razer/hid"),
    import("@openmouse/protocol/drivers/razer/cobra-hid"),
    import("@openmouse/protocol/drivers/razer/viper-hid"),
    import("@openmouse/protocol/drivers/razer/viper-mini-hid"),
    import("@openmouse/protocol/drivers/razer/viper-v4-pro-hid"),
    import("@openmouse/protocol/razer-devices"),
  ]).then(([hid, cobra, viper, viperMini, viperV4Pro, products]) => ({
    ...hid, ...cobra, ...viper, ...viperMini, ...viperV4Pro, ...products,
  }));
  return razerBridgePromise;
}

function isBridgeRazer(device: HIDDevice): boolean {
  return (device as NativeBridgeDevice).openMouseTransport === "bridge"
    && device.vendorId === 0x1532;
}

function bridgeRazerClientFrom(device: HIDDevice, mods: RazerBridgeModules): SupportedClient | null {
  const {
    COBRA_PRODUCT_ID, RazerCobraHidClient,
    RazerHidClient, RazerViperHidClient, VIPER_PRODUCT_ID,
    RazerViperMiniHidClient, VIPER_MINI_PRODUCT_ID,
    RazerViperV4ProHidClient, VIPER_V4_PRO_PRODUCTS,
    RAZER_PRODUCTS,
  } = mods;
  if (VIPER_V4_PRO_PRODUCTS.has(device.productId)) return new RazerViperV4ProHidClient(device);
  if (device.productId === COBRA_PRODUCT_ID) return new RazerCobraHidClient(device);
  if (device.productId === VIPER_PRODUCT_ID) return new RazerViperHidClient(device);
  if (device.productId === VIPER_MINI_PRODUCT_ID) return new RazerViperMiniHidClient(device);
  if (RAZER_PRODUCTS.has(device.productId)) return new RazerHidClient(device);
  return null;
}

async function bridgeRazerClient(device: HIDDevice): Promise<SupportedClient | null> {
  if (!isBridgeRazer(device)) return null;
  return bridgeRazerClientFrom(device, await loadRazerBridge());
}


export async function createSupportedClient(device: HIDDevice): Promise<SupportedClient | null> {
  if (isBridgeRazer(device)) return bridgeRazerClient(device);
  return (await loadRegistry()).createSupportedClient(device);
}

export async function prepareAutoConnectClient(client: SupportedClient): Promise<SupportedClient | null> {
  // Check the transport before loading the Razer modules: every non-bridge
  // client takes this path on connect, and none of them is a Razer client.
  if ((client.device as NativeBridgeDevice).openMouseTransport !== "bridge") return client;
  const { RazerHidClient, razerProbeControlInterface } = await loadRazerBridge();
  if (!(client instanceof RazerHidClient)) return client;
  // Bridge can expose a sibling with the same VID/PID that cannot answer commands.
  return razerProbeControlInterface([client.device]);
}

export type { KeyboardClient };

export function isKeyboardClient(client: SupportedClient | KeyboardClient): client is KeyboardClient {
  return client instanceof WuqueKeyboardClient || client instanceof KochiKeyboardClient;
}

/**
 * Map an authorized HID device to a keyboard client. Keyboards are never
 * `SupportedClient`s: the mouse registry does not know them, and faking a
 * `MouseStatus` would surface mouse cards for a device that has none.
 */
export function createKeyboardClient(device: HIDDevice): KeyboardClient | null {
  if (KochiKeyboardClient.isSupported(device)) return new KochiKeyboardClient(device);
  return WuqueKeyboardClient.isSupported(device) ? new WuqueKeyboardClient(device) : null;
}

export async function clientSupportScore(device: HIDDevice): Promise<number> {
  if (await bridgeRazerClient(device) !== null) return 10_000;
  // A Wuque board exposes a boot keyboard, a consumer-control and a mouse
  // collection beside its vendor config interface. Only the vendor page answers
  // commands, so it has to win the pick for the physical device.
  if (createKeyboardClient(device) !== null) return 900;
  return (await loadRegistry()).clientSupportScore(device);
}

export async function logicalDeviceGroups(devices: HIDDevice[] = []): Promise<HIDDevice[][]> {
  const [registry, razer, { collapseBoltPeers }, { eggWeMergeLogicalDevices }] = await Promise.all([
    loadRegistry(),
    loadRazerBridge(),
    import("@openmouse/protocol/drivers/logitech/bolt"),
    import("@openmouse/protocol/drivers/endgame/egg-we-control"),
  ]);
  const merged = collapseBoltPeers(
    eggWeMergeLogicalDevices(
      devices,
      (device) => registry.createSupportedClient(device) !== null
        || (isBridgeRazer(device) && bridgeRazerClientFrom(device, razer) !== null)
        || createKeyboardClient(device) !== null,
    ),
  );
  const byPhysicalDevice = new Map<string, HIDDevice[]>();
  for (const device of merged) {
    const key = physicalDeviceKey(device);
    const group = byPhysicalDevice.get(key);
    if (group) group.push(device);
    else byPhysicalDevice.set(key, [device]);
  }
  return [...byPhysicalDevice.values()];
}

/**
 * One connect-page/sidebar card per physical mouse. WebHID returns a device
 * object per top-level HID collection, so a single mouse without a multi-path
 * driver would otherwise surface once per interface; the browser exposes no
 * serial number, so vendor/product/name is the most specific identity it
 * offers. Bridge collapses each product's report paths into one device on its
 * side — keyed by vendor/product[:serial] on every platform — so the app
 * takes Bridge's session key verbatim, which still keeps physically distinct
 * serial-bearing identical mice apart. Both paths merge two identical
 * serial-less mice of one model into a single card: that is the most specific
 * identity either platform offers.
 */
function physicalDeviceKey(device: HIDDevice): string {
  if ((device as { openMouseTransport?: string }).openMouseTransport === "bridge") {
    return `bridge:${(device as { key?: string }).key ?? ""}`;
  }
  return `${device.vendorId}:${device.productId}:${device.productName ?? ""}`;
}

export async function pickLogicalDevice(group: HIDDevice[]): Promise<HIDDevice> {
  const scores = await Promise.all(group.map((device) => clientSupportScore(device)));
  let bestIndex = 0;
  for (let index = 1; index < group.length; index += 1) {
    if (scores[index]! > scores[bestIndex]!) bestIndex = index;
  }
  return group[bestIndex]!;
}

/** Supported devices for the sidebar; multi-path drivers collapse via their module. */
export async function listLogicalDevices(devices: HIDDevice[] = []): Promise<HIDDevice[]> {
  const groups = await logicalDeviceGroups(devices);
  return Promise.all(groups.map((group) => pickLogicalDevice(group)));
}

/** Brand label for a connected client; the registry answers once loaded. */
export async function deviceBrand(client: SupportedClient): Promise<string> {
  return (await loadRegistry()).deviceBrand(client);
}
