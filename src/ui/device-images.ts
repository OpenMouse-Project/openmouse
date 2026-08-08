/**
 * Top-down product art, keyed by the identifiers WebHID already reports so that
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
]);

function deviceKey(device: HIDDevice): string {
  const hex = (value: number): string => value.toString(16).padStart(4, "0");
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

export function deviceImage(device: HIDDevice | null | undefined): string | null {
  return device ? DEVICE_IMAGES.get(deviceKey(device)) ?? null : null;
}
