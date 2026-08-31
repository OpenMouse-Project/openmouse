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
  // Original G703 (0xc087) and G703 HERO wired (0xc090) share the same shell.
  ["046d:c087", "/devices/logitech-g703.png"],
  ["046d:c090", "/devices/logitech-g703.png"],
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
  // OP1we
  ["3367:1961", "/devices/endgame-gear-op1we.png"],
  ["3367:1962", "/devices/endgame-gear-op1we.png"],
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
  // Beast Max wired / 4K8K receiver transports share the same shell.
  ["36a7:a881", "/devices/wlmouse-beast-max.png"],
  ["36a7:a880", "/devices/wlmouse-beast-max.png"],
  // Teevolution Terra Pro wired / receiver Compx transports.
  ["3554:f520", "/devices/teevolution-terra-pro.png"],
  ["3554:f522", "/devices/teevolution-terra-pro.png"],
  ["3554:f523", "/devices/teevolution-terra-pro.png"],
  ["3554:f5bb", "/devices/teevolution-terra-pro.png"],
  // WALLHACK M-001 wireless mouse (real config id and in-app demo id).
  ["3879:1110", "/devices/wallhack-m-001.png"],
  ["3879:0807", "/devices/wallhack-m-001.png"],
  // WALLHACK K-001 analog keyboard (both enumerated vendor ids).
  ["3879:0806", "/devices/wallhack-k-001.png"],
  ["1caa:0806", "/devices/wallhack-k-001.png"],
  // Logitech G203 family. G203 LIGHTSYNC / PRODIGY and G102 share the same shell.
  ["046d:c084", "/devices/logitech-g203.png"],
  ["046d:c089", "/devices/logitech-g203.png"],
  ["046d:c092", "/devices/logitech-g203.png"],
  ["046d:c07e", "/devices/logitech-g402.png"],
  ["046d:c080", "/devices/logitech-g303.png"],
  ["046d:c08f", "/devices/logitech-g403.png"],
  ["046d:c08e", "/devices/logitech-g903.png"],
  // G Pro (2017), G Pro Hero, and G Pro Wireless share the same classic shell.
  ["046d:c085", "/devices/logitech-g-pro.png"],
  ["046d:c08c", "/devices/logitech-g-pro.png"],
  // Endgame Gear XM2 8K wired.
  ["3367:1966", "/devices/endgame-gear-xm2-8k.png"],
  ["3367:1980", "/devices/endgame-gear-xm2-8k.png"],
  // WLMouse Beast X / Beast Mini / Beast X Pro have no product render yet;
  // they resolve to the generic placeholder via the name fallbacks below.
  // Sword X wired / receiver transports keep their render.
  ["36a7:a878", "/devices/wlmouse-sword-x.png"],
  ["36a7:a879", "/devices/wlmouse-sword-x.png"],
  // VGN Dragonfly F2 Master+ wired / receiver transports.
  ["3554:fb56", "/devices/vgn-dragonfly-f2.png"],
  ["3554:fb57", "/devices/vgn-dragonfly-f2.png"],
  // Lamzu Maya X wired / wireless / 8K transports.
  ["373e:001c", "/devices/lamzu-maya-x.png"],
  ["373e:001d", "/devices/lamzu-maya-x.png"],
  ["373e:001e", "/devices/lamzu-maya-x.png"],
  // Orbital Ghost / Pathfinder V2 has no product render yet; resolves to the
  // generic placeholder via the name fallback below.
  ["1532:006e", "/devices/razer-deathadder-v2.png"],
  ["1532:0071", "/devices/razer-deathadder-v2.png"],
  ["1532:007c", "/devices/razer-deathadder-v2.png"],
  ["1532:007d", "/devices/razer-deathadder-v2.png"],
  ["1532:0084", "/devices/razer-deathadder-v2.png"],
  ["1532:0098", "/devices/razer-deathadder-v2.png"],
  // DeathAdder V4 Pro and its Carbon Fiber SKU share the same shell.
  ["1532:00be", "/devices/razer-deathadder-v4-pro.png"],
  ["1532:00bf", "/devices/razer-deathadder-v4-pro.png"],
  ["1532:00ef", "/devices/razer-deathadder-v4-pro.png"],
  ["1532:00f0", "/devices/razer-deathadder-v4-pro.png"],
  ["1532:00b8", "/devices/razer-viper-v3-hyperspeed.png"],
  ["1532:00e5", "/devices/razer-viper-v4-pro.png"],
  ["1532:00e6", "/devices/razer-viper-v4-pro.png"],
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
  if (/\bg703\b/i.test(displayName)) return "/devices/logitech-g703.png";
  if (/mx\s*master\s*4/i.test(displayName)) return "/devices/unknown-device.png";
  if (/superstrike/i.test(displayName)) return "/devices/logitech-pro-x2-superstrike.png";
  if (/superlight/i.test(displayName)) return "/devices/logitech-pro-x-superlight-2c.png";
  if (/op1we/i.test(displayName)) return "/devices/endgame-gear-op1we.png";
  if (/\bop1\b/i.test(displayName)) return "/devices/endgame-gear-op1-8k.png";
  if (/\bviper\s*v2\s*pro\b/i.test(displayName)) return "/devices/razer-viper-v2-pro.png";
  if (/\bviper\s*mini\b/i.test(displayName)) return "/devices/razer-viper-mini.webp";
  if (/\bcobra\b/i.test(displayName)) return "/devices/razer-cobra.webp";
  if (/\bnape\s*pro\b/i.test(displayName)) return "/devices/unknown-device.png";
  if (/\bko-one\b/i.test(displayName)) return "/devices/crdrako-ko-one.png";
  if (/\br5\s*ultra\b/i.test(displayName)) return "/devices/attackshark-r5-ultra.png";
  if (/\bm[23]k\b/i.test(displayName)) return "/devices/zaunkoenig-m3k.png";
  if (/\bmx\s*master\s*3s\b/i.test(displayName)) return "/devices/logitech-mx-master-3s.png";
  if (/\bterra\s*pro\b/i.test(displayName)) return "/devices/teevolution-terra-pro.png";
  if (/\bm-001\b/i.test(displayName)) return "/devices/wallhack-m-001.png";
  if (/\bk-001\b/i.test(displayName)) return "/devices/wallhack-k-001.png";
  // Newer supported-model artwork resolved from the reported product name. These
  // run after the shared-receiver checks above but before the Pulsar/unknown
  // catch-alls. Test-needed (likely) models are deliberately left out.
  if (/\bg(?:102|203)\b/i.test(displayName)) return "/devices/logitech-g203.png";
  if (/\bg303\b/i.test(displayName)) return "/devices/logitech-g303.png";
  if (/\bg402\b/i.test(displayName)) return "/devices/logitech-g402.png";
  if (/\bg403\b/i.test(displayName)) return "/devices/logitech-g403.png";
  if (/\bg903\b/i.test(displayName)) return "/devices/logitech-g903.png";
  if (/\bg30[45]\b/i.test(displayName)) return "/devices/logitech-g305.png";
  if (/\bg309\b/i.test(displayName)) return "/devices/logitech-g309.png";
  if (/\bg\s*pro\s*2\b/i.test(displayName)) return "/devices/logitech-g-pro-2.png";
  if (/\bg\s*pro\b/i.test(displayName)) return "/devices/logitech-g-pro.png";
  if (/\bmx\s*anywhere\s*3\b/i.test(displayName)) return "/devices/logitech-mx-anywhere-3.png";
  if (/\bmx\s*ergo\b/i.test(displayName)) return "/devices/logitech-mx-ergo-s.png";
  if (/\bdeathadder\s*v4\b/i.test(displayName)) return "/devices/razer-deathadder-v4-pro.png";
  if (/\bdeathadder\s*v3\b(?!\s*pro\b)/i.test(displayName)) return "/devices/razer-deathadder-v3.png";
  if (/\bdeathadder\s*v2\b(?!\s*x\s*hyperspeed\b)/i.test(displayName)) return "/devices/razer-deathadder-v2.png";
  if (/\bdeathadder\s*essential\b/i.test(displayName)) return "/devices/razer-deathadder-v2.png";
  if (/\bviper\s*v3\s*hyperspeed\b/i.test(displayName)) return "/devices/razer-viper-v3-hyperspeed.png";
  if (/\bviper\s*v4\b/i.test(displayName)) return "/devices/razer-viper-v4-pro.png";
  if (/\bxm2\s*8k\b/i.test(displayName)) return "/devices/endgame-gear-xm2-8k.png";
  if (/\bxm2w\b/i.test(displayName)) return "/devices/endgame-gear-xm2w.png";
  if (/\bbeast\s*x\s*pro\b/i.test(displayName)) return "/devices/unknown-device.png";
  if (/\bbeast\s*mini\b/i.test(displayName)) return "/devices/unknown-device.png";
  if (/\bbeast\s*x\b/i.test(displayName)) return "/devices/unknown-device.png";
  if (/\bsword\s*x\b/i.test(displayName)) return "/devices/wlmouse-sword-x.png";
  if (/\bdragonfly\s*f2\b/i.test(displayName)) return "/devices/vgn-dragonfly-f2.png";
  if (/\bmaya\s*x\b/i.test(displayName)) return "/devices/lamzu-maya-x.png";
  if (/\bf1\s*v2\b/i.test(displayName)) return "/devices/atk-f1-v2-ultra-max.png";
  if (/\b(finalmouse|starlight|ulx)\b/i.test(displayName)) return "/devices/finalmouse-ulx.png";
  if (/\borbital\b/i.test(displayName)) return "/devices/unknown-device.png";
  if (/\bmoddo/i.test(displayName)) return "/devices/unknown-device.png";
  // Pulsar 4K Wireless Receiver ships with the X2 V2 4K dongle kit; the receiver
  // product id is not yet published, so match the name reported by WebHID.
  if (/pulsar/i.test(displayName)) return "/devices/pulsar-x2-v2.png";
  if (/fantech/i.test(displayName)) return "/devices/unknown-device.png";
  return "/devices/unknown-device.png";
}
