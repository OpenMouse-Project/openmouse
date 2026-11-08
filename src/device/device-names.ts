/**
 * The name each device's mouse last reported, so the device list can show
 * "Scyrox V8" instead of its receiver's "SCYROX 8K Dongle" after a reload,
 * before the mouse is opened again.
 *
 * Keyed like remembered receivers (`receiverKey`): Bridge's device key, or
 * WebHID's vendor/product/name. Bridge versions before stable keys numbered
 * devices per session (`hid-1`, `hid-2`, ...) in no fixed order, so a name
 * saved under one of those could land on another device after a reload;
 * those keys are never used here.
 */
import { receiverKey } from "./mouse-receivers.ts";

const STORAGE_KEY = "openmouse.device-names";
/** Plenty for one person's devices; the oldest goes first past this. */
const MAX_NAMES = 64;
/** Bridge's stable key: `hid-<vendor><product>-<hash>`, maybe with `-<n>`. */
const STABLE_BRIDGE_KEY = /^hid-[0-9a-f]{8}-[0-9a-f]{8}(?:-\d+)?$/;

let names: Map<string, string> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): Map<string, string> {
  if (names) return names;
  names = new Map();
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, name] of Object.entries(parsed)) {
        if (typeof name === "string" && name.trim()) names.set(key, name);
      }
    }
  } catch {
    // A corrupt entry only costs the remembered names; start over.
  }
  return names;
}

function save(entries: Map<string, string>): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage can be full or blocked; the in-memory copy still serves this session.
  }
}

/** The key to remember `device` under, or `null` when its key is not stable. */
function nameKey(device: HIDDevice): string | null {
  const bridge = device as { openMouseTransport?: string; key?: string };
  if (bridge.openMouseTransport === "bridge" && !STABLE_BRIDGE_KEY.test(bridge.key ?? "")) return null;
  return receiverKey(device);
}

/** The name `device`'s mouse last reported, if it differs from the device's own. */
export function rememberedDeviceName(device: HIDDevice): string | null {
  const key = nameKey(device);
  return key === null ? null : load().get(key) ?? null;
}

/** Record the name `device`'s mouse reported. */
export function rememberDeviceName(device: HIDDevice, name: string | null | undefined): void {
  const key = nameKey(device);
  const trimmed = name?.trim();
  if (key === null || !trimmed) return;
  const entries = load();
  if (entries.get(key) === trimmed) return;
  // Re-inserting moves it to the end, so the oldest entry is first to go.
  entries.delete(key);
  entries.set(key, trimmed);
  while (entries.size > MAX_NAMES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  save(entries);
}

/** Tests only: forget the in-memory copy so the next call reads storage. */
export function resetDeviceNamesForTests(): void {
  names = null;
}
