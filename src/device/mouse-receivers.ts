/**
 * Receivers the keyboard drivers claim but that turned out to carry a mouse.
 *
 * A shared receiver exposes the same VID/PID/name and interfaces whether a
 * keyboard or a mouse is paired: a Logitech receiver's HID++ collections match
 * the Logitech keyboard driver, and a Keychron Link-KM's raw `ff60` interface
 * matches VIA. Device matching is keyboard-first until the receiver has been
 * read (#1282). Once a mouse client has opened one and read its status, that is
 * no longer a guess: remembering it, and which interface answered, lets the
 * listing, the connect order and the status text treat the receiver as the
 * mouse it is, instead of re-probing it as a keyboard on every connect and
 * drawing it as "USB Receiver · Keyboard" (#1362).
 *
 * Keyed by the same identity that groups a receiver's interfaces, and kept in
 * localStorage so the first listing after a reload is right as well.
 */
const STORAGE_KEY = "openmouse.mouse-receivers";

/** Receiver key → signature of the interface that read as a mouse. */
let known: Map<string, string> | null = null;

/**
 * One receiver, matching how logical device groups are keyed: Bridge's own
 * session key (vendor/product[:serial]) or WebHID's vendor/product/name.
 */
export function receiverKey(device: HIDDevice): string {
  const bridge = device as { openMouseTransport?: string; key?: string };
  if (bridge.openMouseTransport === "bridge") return `bridge:${bridge.key ?? ""}`;
  return [device.vendorId, device.productId, device.productName ?? ""].join(":");
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): Map<string, string> {
  if (known) return known;
  known = new Map();
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, signature] of Object.entries(parsed)) {
        if (typeof signature === "string") known.set(key, signature);
      }
    }
  } catch {
    // A corrupt entry only costs the keyboard-first guess; start over.
  }
  return known;
}

function save(entries: Map<string, string>): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage can be full or blocked; the in-memory copy still serves this session.
  }
}

/**
 * The top-level collections (page/usage) of one interface. A Logitech
 * receiver's short and long HID++ interfaces share page 0xff00 and differ only
 * in usage, so the page alone cannot tell them apart.
 */
function interfaceSignature(device: HIDDevice): string {
  return [...new Set((device.collections ?? []).map((collection) => `${collection.usagePage}/${collection.usage}`))].sort().join(",");
}

/**
 * How a remembered receiver's interface relates to its mouse: `"mouse"` for
 * the interface that answered as one, `"sibling"` for another interface of the
 * same receiver, `null` when the receiver is not remembered.
 */
export function mouseReceiverRole(device: HIDDevice): "mouse" | "sibling" | null {
  const signature = load().get(receiverKey(device));
  if (signature === undefined) return null;
  return interfaceSignature(device) === signature ? "mouse" : "sibling";
}

/** Record that a mouse client read this interface of a keyboard-claimed receiver. */
export function rememberMouseReceiver(device: HIDDevice): void {
  const entries = load();
  const key = receiverKey(device);
  const signature = interfaceSignature(device);
  if (entries.get(key) === signature) return;
  entries.set(key, signature);
  save(entries);
}

/** Drop the record, so the next connect probes keyboard-first again. */
export function forgetMouseReceiver(device: HIDDevice): void {
  const entries = load();
  if (!entries.delete(receiverKey(device))) return;
  save(entries);
}
