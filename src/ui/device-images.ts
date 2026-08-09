/**
 * Top-down product art for the persistent device panel, keyed by the identifiers WebHID already reports so that
 * drivers stay free of asset paths and no new UI hint is needed.
 *
 * Files live in `public/devices/`, which Vite serves from the site root and
 * copies into the build unprocessed. A key whose file is missing therefore
 * fails at load rather than at build time, so the panel drops the thumbnail on
 * that error and keeps the layout it had before any art existed. An entry here
 * and its file belong in the same commit.
 */
const DEVICE_IMAGES: ReadonlyMap<string, string> = new Map([
  // Wired and receiver are separate product ids for the same mouse.
  ["1532:00c0", "/devices/razer-viper-v3-pro.png"],
  ["1532:00c1", "/devices/razer-viper-v3-pro.png"],
  // OP1 8K, Purple Frost, and v2. XM2 models use different shells.
  ["3367:1964", "/devices/endgame-gear-op1-8k.png"],
  ["3367:1976", "/devices/endgame-gear-op1-8k.png"],
  ["3367:1978", "/devices/endgame-gear-op1-8k.png"],
]);

function deviceKey(device: HIDDevice): string {
  const hex = (value: number): string => value.toString(16).padStart(4, "0");
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

export function deviceImage(device: HIDDevice | null | undefined, displayName = ""): string | null {
  const mapped = device ? DEVICE_IMAGES.get(deviceKey(device)) ?? null : null;
  if (mapped) return mapped;
  if (/superlight/i.test(displayName)) return "/devices/logitech-pro-x-superlight-2c.png";
  return /\bop1\s*8k\b/i.test(displayName) ? "/devices/endgame-gear-op1-8k.png" : null;
}
