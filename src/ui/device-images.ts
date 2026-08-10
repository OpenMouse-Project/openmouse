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
  ["1532:008a", "/devices/razer-viper-mini.webp"],
  ["1532:00a3", "/devices/razer-cobra.webp"],
  // OP1 8K, Purple Frost, and v2. XM2 models use different shells.
  ["3367:1964", "/devices/endgame-gear-op1-8k.png"],
  ["3367:1976", "/devices/endgame-gear-op1-8k.png"],
  ["3367:1978", "/devices/endgame-gear-op1-8k.png"],
  // NinjaForce exposes separate wired and receiver ids for Sora V2, Sora V3,
  // and the TEN family. Receiver variants show the paired mouse artwork.
  ["1915:ae11", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae12", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae13", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae14", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae15", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae16", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae1c", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae8a", "/devices/ninjutso-sora-v2.png"],
  ["1915:ae8c", "/devices/ninjutso-sora-v2.png"],
  ["093a:e010", "/devices/ninjutso-sora-v3.png"],
  ["093a:eb02", "/devices/ninjutso-sora-v3.png"],
  ["093a:e020", "/devices/ninjutso-ten.png"],
  ["093a:ea01", "/devices/ninjutso-ten.png"],
  ["093a:eb01", "/devices/ninjutso-ten.png"],
]);

function deviceKey(device: HIDDevice): string {
  const hex = (value: number): string => value.toString(16).padStart(4, "0");
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

export function deviceImage(device: HIDDevice | null | undefined, displayName = ""): string {
  const mapped = device ? DEVICE_IMAGES.get(deviceKey(device)) ?? null : null;
  if (mapped) return mapped;
  if (/superlight/i.test(displayName)) return "/devices/logitech-pro-x-superlight-2c.png";
  if (/\bop1\s*8k\b/i.test(displayName)) return "/devices/endgame-gear-op1-8k.png";
  return "/devices/unknown-device.png";
}
