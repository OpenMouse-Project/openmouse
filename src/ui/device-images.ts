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
  ["046d:c07d", "/devices/logitech-g502.png"],
  ["046d:c095", "/devices/logitech-g502-x-plus.png"],
  ["046d:c099", "/devices/logitech-g502-x.png"],
  ["046d:c0a8", "/devices/logitech-pro-x2-superstrike.png"],
  // M3K and M2K use the supplied M3K product artwork.
  ["0483:a462", "/devices/zaunkoenig-m3k.png"],
  ["0483:a3cf", "/devices/zaunkoenig-m3k.png"],
  // Wired and receiver are separate product ids for the same mouse.
  ["1532:00a5", "/devices/razer-viper-v2-pro.png"],
  ["1532:00a6", "/devices/razer-viper-v2-pro.png"],
  ["1532:00c0", "/devices/razer-viper-v3-pro.png"],
  ["1532:00c1", "/devices/razer-viper-v3-pro.png"],
  ["1532:008a", "/devices/razer-viper-mini.webp"],
  ["1532:0078", "/devices/razer-viper.webp"],
  ["1532:00a3", "/devices/razer-cobra.webp"],
  // CRDRAKO KO-ONE wired and receiver transports share the same shell.
  ["373e:006a", "/devices/crdrako-ko-one.png"],
  ["373e:006b", "/devices/crdrako-ko-one.png"],
  // Attack Shark R5 Ultra wired and wireless transports share the same shell.
  ["373e:0046", "/devices/attackshark-r5-ultra.png"],
  ["373e:0047", "/devices/attackshark-r5-ultra.png"],
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
  // WLMouse Beast G receiver / wired transports share the same shell.
  ["36a7:a860", "/devices/wlmouse-beast-g.png"],
  ["36a7:a861", "/devices/wlmouse-beast-g.png"],
  // Nape Pro wired / Link-KM receivers share the same shell artwork.
  ["3434:0440", "/devices/keychron-nape-pro.png"],
  ["3434:d026", "/devices/keychron-nape-pro.png"],
  ["3434:d029", "/devices/keychron-nape-pro.png"],
  // Teevolution Terra Pro wired / receiver Compx transports.
  ["3554:f520", "/devices/teevolution-terra-pro.png"],
  ["3554:f522", "/devices/teevolution-terra-pro.png"],
  ["3554:f523", "/devices/teevolution-terra-pro.png"],
  ["3554:f5bb", "/devices/teevolution-terra-pro.png"],
]);

function deviceKey(device: HIDDevice): string {
  const hex = (value: number): string => value.toString(16).padStart(4, "0");
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

export function deviceImage(device: HIDDevice | null | undefined, displayName = ""): string {
  const mapped = device ? DEVICE_IMAGES.get(deviceKey(device)) ?? null : null;
  if (mapped) return mapped;
  // Lightspeed receivers are shared product IDs, so paired G502 X variants
  // must use the friendly name read from the mouse itself.
  if (/g502\s*x\s*plus/i.test(displayName)) return "/devices/logitech-g502-x-plus.png";
  if (/g502\s*x/i.test(displayName)) return "/devices/logitech-g502-x.png";
  if (/\bg502\b/i.test(displayName)) return "/devices/logitech-g502.png";
  if (/mx\s*master\s*4/i.test(displayName)) return "/devices/logitech-mx-master-4.png";
  if (/superstrike/i.test(displayName)) return "/devices/logitech-pro-x2-superstrike.png";
  if (/superlight/i.test(displayName)) return "/devices/logitech-pro-x-superlight-2c.png";
  if (/\bop1\b/i.test(displayName)) return "/devices/endgame-gear-op1-8k.png";
  if (/\bviper\s*v2\s*pro\b/i.test(displayName)) return "/devices/razer-viper-v2-pro.png";
  if (/\bviper\s*mini\b/i.test(displayName)) return "/devices/razer-viper-mini.webp";
  if (/\bcobra\b/i.test(displayName)) return "/devices/razer-cobra.webp";
  if (/\bnape\s*pro\b/i.test(displayName)) return "/devices/keychron-nape-pro.png";
  if (/\bko-one\b/i.test(displayName)) return "/devices/crdrako-ko-one.png";
  if (/\br5\s*ultra\b/i.test(displayName)) return "/devices/attackshark-r5-ultra.png";
  if (/\bm[23]k\b/i.test(displayName)) return "/devices/zaunkoenig-m3k.png";
  if (/\bmx\s*master\s*3s\b/i.test(displayName)) return "/devices/logitech-mx-master-3s.png";
  if (/\bterra\s*pro\b/i.test(displayName)) return "/devices/teevolution-terra-pro.png";
  // Pulsar 4K Wireless Receiver ships with the X2 V2 4K dongle kit; the receiver
  // product id is not yet published, so match the name reported by WebHID.
  if (/pulsar/i.test(displayName)) return "/devices/pulsar-x2-v2.png";
  return "/devices/unknown-device.png";
}
