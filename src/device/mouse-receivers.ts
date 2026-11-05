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
 * Keyed by VID:PID:name, the same identity that groups a receiver's
 * interfaces, and kept in localStorage so the first listing after a reload is
 * right as well.
 */
const STORAGE_KEY = "openmouse.mouse-receivers";

/** Receiver key → usage pages of the interface that read as a mouse. */
let known: Map<string, number[]> | null = null;

export function receiverKey(device: HIDDevice): string {
  return [device.vendorId, device.productId, device.productName ?? ""].join(":");
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): Map<string, number[]> {
  if (known) return known;
  known = new Map();
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, pages] of Object.entries(parsed)) {
        if (Array.isArray(pages) && pages.every((page) => typeof page === "number")) known.set(key, pages);
      }
    }
  } catch {
    // A corrupt entry only costs the keyboard-first guess; start over.
  }
  return known;
}

function save(entries: Map<string, number[]>): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage can be full or blocked; the in-memory copy still serves this session.
  }
}

function usagePages(device: HIDDevice): number[] {
  return [...new Set((device.collections ?? []).map((collection) => collection.usagePage))].sort((a, b) => a - b);
}

/**
 * How a remembered receiver's interface relates to its mouse: `"mouse"` for
 * the interface that answered as one, `"sibling"` for another interface of the
 * same receiver, `null` when the receiver is not remembered.
 */
export function mouseReceiverRole(device: HIDDevice): "mouse" | "sibling" | null {
  const pages = load().get(receiverKey(device));
  if (!pages) return null;
  return usagePages(device).some((page) => pages.includes(page)) ? "mouse" : "sibling";
}

/** Record that a mouse client read this interface of a keyboard-claimed receiver. */
export function rememberMouseReceiver(device: HIDDevice): void {
  const entries = load();
  const key = receiverKey(device);
  const pages = usagePages(device);
  if (entries.get(key)?.join() === pages.join()) return;
  entries.set(key, pages);
  save(entries);
}

/** Drop the record, so the next connect probes keyboard-first again. */
export function forgetMouseReceiver(device: HIDDevice): void {
  const entries = load();
  if (!entries.delete(receiverKey(device))) return;
  save(entries);
}
