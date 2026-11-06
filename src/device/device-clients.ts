import { ArbiterKeyboardClient } from "./arbiter-keyboard.ts";
import { KochiKeyboardClient } from "./kochi-keyboard.ts";
import type { KeyboardClient } from "./keyboard-client.ts";
import { WuqueKeyboardClient } from "./wuque-keyboard.ts";
import { WootingKeyboardClient } from "./wooting-keyboard.ts";
import { RazerKeyboardClient } from "./razer-keyboard.ts";
import { LogitechKeyboardClient } from "./logitech-keyboard.ts";
import { SteelSeriesKeyboardClient } from "./steelseries-keyboard.ts";
import { KeychronKeyboardClient } from "./keychron-keyboard.ts";
import { keychronHallEffectEnabled } from "./keychron-flag.ts";
import { ViaKeyboardClient } from "./via-keyboard.ts";
import { mouseReceiverRole, receiverKey } from "./mouse-receivers.ts";
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

export async function createMouseClient(device: HIDDevice): Promise<SupportedClient | null> {
  if (isBridgeRazer(device)) return bridgeRazerClient(device);
  return (await loadRegistry()).createSupportedClient(device);
}
export async function createSupportedClient(device: HIDDevice): Promise<SupportedClient | null> {
  // The interface of a receiver that already answered as a mouse is not a
  // keyboard guess any more.
  if (mouseReceiverRole(device) === "mouse") return createMouseClient(device);
  if (createKeyboardClient(device)) return null;
  return createMouseClient(device);
}

/**
 * The client a listing entry should present for one device.
 *
 * `createSupportedClient` is only a descriptor-level guess: the Logitech
 * keyboard driver claims every receiver PID that exposes a HID++ collection,
 * so a receiver whose pairing slots have not been read yet lists keyboard-first
 * (#1282). A mouse client that already owns the device is not a guess — the
 * receiver answered with a sensor behind it — so it wins. Without that, a
 * mouse on a LIGHTSPEED receiver keeps being listed as "USB Receiver ·
 * Keyboard" with keyboard art even while its mouse page is open (#1362).
 */
export async function listingClient(device: HIDDevice, active: SupportedClient | null): Promise<SupportedClient | null> {
  if (active !== null && active.device === device) return active;
  return createSupportedClient(device);
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
  return client instanceof WuqueKeyboardClient || client instanceof KochiKeyboardClient || client instanceof WootingKeyboardClient
    || client instanceof RazerKeyboardClient || client instanceof LogitechKeyboardClient || client instanceof SteelSeriesKeyboardClient
    || client instanceof KeychronKeyboardClient || client instanceof ArbiterKeyboardClient
    || client instanceof ViaKeyboardClient;
}

/**
 * Map an authorized HID device to a keyboard client. Keyboards are never
 * `SupportedClient`s: the mouse registry does not know them, and faking a
 * `MouseStatus` would surface mouse cards for a device that has none.
 */
export function createKeyboardClient(device: HIDDevice): KeyboardClient | null {
  if (WootingKeyboardClient.isSupported(device)) return new WootingKeyboardClient(device);
  if (KochiKeyboardClient.isSupported(device)) return new KochiKeyboardClient(device);
  if (WuqueKeyboardClient.isSupported(device)) return new WuqueKeyboardClient(device);
  if (RazerKeyboardClient.isSupported(device)) return new RazerKeyboardClient(device);
  if (LogitechKeyboardClient.isSupported(device)) return new LogitechKeyboardClient(device);
  if (SteelSeriesKeyboardClient.isSupported(device)) return new SteelSeriesKeyboardClient(device);
  if (ArbiterKeyboardClient.isSupported(device)) return new ArbiterKeyboardClient(device);
  if (keychronHallEffectEnabled() && KeychronKeyboardClient.isSupported(device)) return new KeychronKeyboardClient(device);
  if (ViaKeyboardClient.isSupported(device)) return new ViaKeyboardClient(device);
  return null;
}

export async function clientSupportScore(device: HIDDevice): Promise<number> {
  // Keyboard command interfaces win over generic mouse HID++/Razer registries.
  // A remembered mouse receiver lists and connects through the interface that
  // answered as a mouse; its keyboard-claimed siblings step aside.
  const receiverRole = mouseReceiverRole(device);
  // Keep the driver's own score on top, so its preference between interfaces
  // (Bolt's long-report collection) still counts.
  if (receiverRole === "mouse") return 20_000 + (await loadRegistry()).clientSupportScore(device);
  if (createKeyboardClient(device)) return receiverRole === "sibling" ? 0 : 900;
  if (await bridgeRazerClient(device) !== null) return 10_000;
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

/**
 * Whether a keyboard claim on this device is a guess about a shared receiver:
 * the device itself also matches a mouse driver (a Logitech receiver), or
 * another interface of the same receiver does (a Keychron Link-KM).
 */
export async function isSharedReceiver(device: HIDDevice, devices: HIDDevice[]): Promise<boolean> {
  const key = receiverKey(device);
  const interfaces = [device, ...devices.filter((other) => other !== device && receiverKey(other) === key)];
  if (!interfaces.some((member) => createKeyboardClient(member) !== null)) return false;
  for (const member of interfaces) if (await createMouseClient(member) !== null) return true;
  return false;
}

/**
 * The best mouse client among another interface of a keyboard-claimed
 * receiver, for when the keyboard read fails: a Link-KM exposes VIA on `ff60`
 * and an M6 behind its `ffc1` interface.
 */
export async function siblingMouseClient(device: HIDDevice, devices: HIDDevice[]): Promise<SupportedClient | null> {
  const key = receiverKey(device);
  let best: { client: SupportedClient; score: number } | null = null;
  for (const other of devices) {
    if (other === device || receiverKey(other) !== key || createKeyboardClient(other)) continue;
    const client = await createMouseClient(other);
    if (!client) continue;
    const score = await clientSupportScore(other);
    if (!best || score > best.score) best = { client, score };
  }
  return best?.client ?? null;
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
