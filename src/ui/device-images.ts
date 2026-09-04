/**
 * Top-down product art for the persistent device panel, keyed by the identifiers WebHID already reports so that
 * drivers stay free of asset paths and no new UI hint is needed.
 *
 * Files are hosted in the `openmouse-devices` Cloudflare R2 bucket (public
 * access via its r2.dev URL, see `DEVICE_IMAGE_BASE_URL` below) rather than
 * committed to the repo, so this map holds bare filenames only. A key whose
 * file is missing in the bucket therefore fails at load rather than at build
 * time, so the panel drops the thumbnail on that error and keeps the layout
 * it had before any art existed. See `public/devices/README.md` for how to
 * upload new art.
 */
const DEVICE_IMAGES: ReadonlyMap<string, string> = new Map([
  ["046d:c07d", "logitech-g502.png"],
  ["046d:c095", "logitech-g502-x-plus.png"],
  ["046d:c098", "logitech-g502-x.png"],
  ["046d:c099", "logitech-g502-x.png"],
  ["046d:c0a8", "logitech-pro-x2-superstrike.png"],
  // Original G703 (0xc087) and G703 HERO wired (0xc090) share the same shell.
  ["046d:c087", "logitech-g703.png"],
  ["046d:c090", "logitech-g703.png"],
  // M3K and M2K use the supplied M3K product artwork.
  ["0483:a462", "zaunkoenig-m3k.png"],
  ["0483:a3cf", "zaunkoenig-m3k.png"],
  // Wired and receiver are separate product ids for the same mouse.
  ["1532:00a5", "razer-viper-v2-pro.png"],
  ["1532:00a6", "razer-viper-v2-pro.png"],
  ["1532:00c0", "razer-viper-v3-pro.png"],
  ["1532:00c1", "razer-viper-v3-pro.png"],
  ["1532:008a", "razer-viper-mini.webp"],
  ["1532:0078", "razer-viper.webp"],
  ["1532:00a3", "razer-cobra.webp"],
  // CRDRAKO KO-ONE wired and receiver transports share the same shell.
  ["373e:006a", "crdrako-ko-one.png"],
  ["373e:006b", "crdrako-ko-one.png"],
  // Attack Shark R5 Ultra wired and wireless transports share the same shell.
  ["373e:0046", "attackshark-r5-ultra.png"],
  ["373e:0047", "attackshark-r5-ultra.png"],
  // OP1 8K, Purple Frost, and v2. XM2 models use different shells.
  ["3367:1964", "endgame-gear-op1-8k.png"],
  ["3367:1976", "endgame-gear-op1-8k.png"],
  ["3367:1978", "endgame-gear-op1-8k.png"],
  // OP1we
  ["3367:1961", "endgame-gear-op1we.png"],
  ["3367:1962", "endgame-gear-op1we.png"],
  // NinjaForce exposes separate wired and receiver ids for Sora V2, Sora V3,
  // and the TEN family. Receiver variants show the paired mouse artwork.
  ["1915:ae11", "ninjutso-sora-v2.png"],
  ["1915:ae12", "ninjutso-sora-v2.png"],
  ["1915:ae13", "ninjutso-sora-v2.png"],
  ["1915:ae14", "ninjutso-sora-v2.png"],
  ["1915:ae15", "ninjutso-sora-v2.png"],
  ["1915:ae16", "ninjutso-sora-v2.png"],
  ["1915:ae1c", "ninjutso-sora-v2.png"],
  ["1915:ae8a", "ninjutso-sora-v2.png"],
  ["1915:ae8c", "ninjutso-sora-v2.png"],
  ["093a:e010", "ninjutso-sora-v3.png"],
  ["093a:eb02", "ninjutso-sora-v3.png"],
  ["093a:e020", "ninjutso-ten.png"],
  ["093a:ea01", "ninjutso-ten.png"],
  ["093a:eb01", "ninjutso-ten.png"],
  // WLMouse Beast G receiver / wired transports share the same shell.
  ["36a7:a860", "wlmouse-beast-g.png"],
  ["36a7:a861", "wlmouse-beast-g.png"],
  // Beast Max wired / 4K8K receiver transports share the same shell.
  ["36a7:a881", "wlmouse-beast-max.png"],
  ["36a7:a880", "wlmouse-beast-max.png"],
  // Teevolution Terra Pro wired / receiver Compx transports.
  ["3554:f520", "teevolution-terra-pro.png"],
  ["3554:f522", "teevolution-terra-pro.png"],
  ["3554:f523", "teevolution-terra-pro.png"],
  ["3554:f5bb", "teevolution-terra-pro.png"],
  // WALLHACK M-001 wireless mouse (real config id and in-app demo id).
  ["3879:1110", "wallhack-m-001.png"],
  ["3879:0807", "wallhack-m-001.png"],
  // WALLHACK K-001 analog keyboard (both enumerated vendor ids).
  ["3879:0806", "wallhack-k-001.png"],
  ["1caa:0806", "wallhack-k-001.png"],
  // Logitech G203 family. G203 LIGHTSYNC / PRODIGY and G102 share the same shell.
  ["046d:c084", "logitech-g203.png"],
  ["046d:c089", "logitech-g203.png"],
  ["046d:c092", "logitech-g203.png"],
  ["046d:c07e", "logitech-g402.png"],
  ["046d:c080", "logitech-g303.png"],
  ["046d:c08f", "logitech-g403.png"],
  ["046d:c08e", "logitech-g903.png"],
  // G Pro (2017), G Pro Hero, and G Pro Wireless share the same classic shell.
  ["046d:c085", "logitech-g-pro.png"],
  ["046d:c08c", "logitech-g-pro.png"],
  // Endgame Gear XM2 8K wired.
  ["3367:1966", "endgame-gear-xm2-8k.png"],
  ["3367:1980", "endgame-gear-xm2-8k.png"],
  // WLMouse Beast X / Beast Mini / Beast X Pro have no product render yet;
  // they resolve to the generic placeholder via the name fallbacks below.
  // Sword X wired / receiver transports keep their render.
  ["36a7:a878", "wlmouse-sword-x.png"],
  ["36a7:a879", "wlmouse-sword-x.png"],
  // VGN Dragonfly F2 Master+ wired / receiver transports.
  ["3554:fb56", "vgn-dragonfly-f2.png"],
  ["3554:fb57", "vgn-dragonfly-f2.png"],
  // Lamzu Maya X wired / wireless / 8K transports.
  ["373e:001c", "lamzu-maya-x.png"],
  ["373e:001d", "lamzu-maya-x.png"],
  ["373e:001e", "lamzu-maya-x.png"],
  // Orbital Ghost / Pathfinder V2 has no product render yet; resolves to the
  // generic placeholder via the name fallback below.
  ["1532:006e", "razer-deathadder-v2.png"],
  ["1532:0071", "razer-deathadder-v2.png"],
  ["1532:007c", "razer-deathadder-v2.png"],
  ["1532:007d", "razer-deathadder-v2.png"],
  ["1532:0084", "razer-deathadder-v2.png"],
  ["1532:0098", "razer-deathadder-v2.png"],
  // DeathAdder V4 Pro and its Carbon Fiber SKU share the same shell.
  ["1532:00be", "razer-deathadder-v4-pro.png"],
  ["1532:00bf", "razer-deathadder-v4-pro.png"],
  ["1532:00ef", "razer-deathadder-v4-pro.png"],
  ["1532:00f0", "razer-deathadder-v4-pro.png"],
  ["1532:00b8", "razer-viper-v3-hyperspeed.png"],
  ["1532:00e5", "razer-viper-v4-pro.png"],
  ["1532:00e6", "razer-viper-v4-pro.png"],
]);

function deviceKey(device: HIDDevice): string {
  const hex = (value: number): string => value.toString(16).padStart(4, "0");
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

function resolveDeviceImageFilename(device: HIDDevice | null | undefined, displayName = ""): string {
  const mapped = device ? DEVICE_IMAGES.get(deviceKey(device)) ?? null : null;
  if (mapped) return mapped;
  // Lightspeed receivers are shared product IDs, so paired G502 X variants
  // must use the friendly name read from the mouse itself.
  if (/g502\s*x\s*plus/i.test(displayName)) return "logitech-g502-x-plus.png";
  if (/g502\s*x/i.test(displayName)) return "logitech-g502-x.png";
  if (/\bg502\b/i.test(displayName)) return "logitech-g502.png";
  if (/\bg703\b/i.test(displayName)) return "logitech-g703.png";
  if (/mx\s*master\s*4/i.test(displayName)) return "unknown-device.png";
  if (/superstrike/i.test(displayName)) return "logitech-pro-x2-superstrike.png";
  if (/superlight/i.test(displayName)) return "logitech-pro-x-superlight-2c.png";
  if (/op1we/i.test(displayName)) return "endgame-gear-op1we.png";
  if (/\bop1\b/i.test(displayName)) return "endgame-gear-op1-8k.png";
  if (/\bviper\s*v2\s*pro\b/i.test(displayName)) return "razer-viper-v2-pro.png";
  if (/\bviper\s*mini\b/i.test(displayName)) return "razer-viper-mini.webp";
  if (/\bcobra\b/i.test(displayName)) return "razer-cobra.webp";
  if (/\bnape\s*pro\b/i.test(displayName)) return "unknown-device.png";
  if (/\bko-one\b/i.test(displayName)) return "crdrako-ko-one.png";
  if (/\br5\s*ultra\b/i.test(displayName)) return "attackshark-r5-ultra.png";
  if (/\bm[23]k\b/i.test(displayName)) return "zaunkoenig-m3k.png";
  if (/\bmx\s*master\s*3s\b/i.test(displayName)) return "logitech-mx-master-3s.png";
  if (/\bterra\s*pro\b/i.test(displayName)) return "teevolution-terra-pro.png";
  if (/\bm-001\b/i.test(displayName)) return "wallhack-m-001.png";
  if (/\bk-001\b/i.test(displayName)) return "wallhack-k-001.png";
  // Newer supported-model artwork resolved from the reported product name. These
  // run after the shared-receiver checks above but before the Pulsar/unknown
  // catch-alls. Test-needed (likely) models are deliberately left out.
  if (/\bg(?:102|203)\b/i.test(displayName)) return "logitech-g203.png";
  if (/\bg303\b/i.test(displayName)) return "logitech-g303.png";
  if (/\bg402\b/i.test(displayName)) return "logitech-g402.png";
  if (/\bg403\b/i.test(displayName)) return "logitech-g403.png";
  if (/\bg903\b/i.test(displayName)) return "logitech-g903.png";
  if (/\bg30[45]\b/i.test(displayName)) return "logitech-g305.png";
  if (/\bg309\b/i.test(displayName)) return "logitech-g309.png";
  if (/\bg\s*pro\s*2\b/i.test(displayName)) return "logitech-g-pro-2.png";
  if (/\bg\s*pro\b/i.test(displayName)) return "logitech-g-pro.png";
  if (/\bmx\s*anywhere\s*3\b/i.test(displayName)) return "logitech-mx-anywhere-3.png";
  if (/\bmx\s*ergo\b/i.test(displayName)) return "logitech-mx-ergo-s.png";
  if (/\bdeathadder\s*v4\b/i.test(displayName)) return "razer-deathadder-v4-pro.png";
  if (/\bdeathadder\s*v3\b(?!\s*pro\b)/i.test(displayName)) return "razer-deathadder-v3.png";
  if (/\bdeathadder\s*v2\b(?!\s*x\s*hyperspeed\b)/i.test(displayName)) return "razer-deathadder-v2.png";
  if (/\bdeathadder\s*essential\b/i.test(displayName)) return "razer-deathadder-v2.png";
  if (/\bviper\s*v3\s*hyperspeed\b/i.test(displayName)) return "razer-viper-v3-hyperspeed.png";
  if (/\bviper\s*v4\b/i.test(displayName)) return "razer-viper-v4-pro.png";
  if (/\bxm2\s*8k\b/i.test(displayName)) return "endgame-gear-xm2-8k.png";
  if (/\bxm2w\b/i.test(displayName)) return "endgame-gear-xm2w.png";
  if (/\bbeast\s*x\s*pro\b/i.test(displayName)) return "unknown-device.png";
  if (/\bbeast\s*mini\b/i.test(displayName)) return "unknown-device.png";
  if (/\bbeast\s*x\b/i.test(displayName)) return "unknown-device.png";
  if (/\bsword\s*x\b/i.test(displayName)) return "wlmouse-sword-x.png";
  if (/\bdragonfly\s*f2\b/i.test(displayName)) return "vgn-dragonfly-f2.png";
  if (/\bmaya\s*x\b/i.test(displayName)) return "lamzu-maya-x.png";
  if (/\bf1\s*v2\b/i.test(displayName)) return "atk-f1-v2-ultra-max.png";
  if (/\b(finalmouse|starlight|ulx)\b/i.test(displayName)) return "finalmouse-ulx.png";
  if (/\borbital\b/i.test(displayName)) return "unknown-device.png";
  if (/\bmoddo/i.test(displayName)) return "unknown-device.png";
  // Pulsar 4K Wireless Receiver ships with the X2 V2 4K dongle kit; the receiver
  // product id is not yet published, so match the name reported by WebHID.
  if (/pulsar/i.test(displayName)) return "pulsar-x2-v2.png";
  if (/fantech/i.test(displayName)) return "unknown-device.png";
  return "unknown-device.png";
}

/**
 * Base URL of the public R2 bucket that hosts device art (see
 * `public/devices/README.md` for the upload workflow). Kept as a single
 * constant so the bucket can move without touching every entry above.
 */
const DEVICE_IMAGE_BASE_URL = "https://pub-ac470fd1b7084597b8a4a45cfc3318fc.r2.dev/";

export function deviceImage(device: HIDDevice | null | undefined, displayName = ""): string {
  return DEVICE_IMAGE_BASE_URL + resolveDeviceImageFilename(device, displayName);
}
