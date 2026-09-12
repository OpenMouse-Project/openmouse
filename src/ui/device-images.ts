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
 *
 * Crowd-sourced artworks are fetched from `/api/artwork/list` and cached
 * locally. Once a device has crowd-sourced artwork, it takes priority over
 * the static map and name-fallback regexes below.
 */

const DEVICE_IMAGES: ReadonlyMap<string, string> = new Map([
  ["046d:c07d", "logitech-g502.png"],
  ["046d:c095", "logitech-g502-x-plus.png"],
  ["046d:c098", "logitech-g502-x.png"],
  ["046d:c099", "logitech-g502-x.png"],
  ["046d:c0a8", "logitech-pro-x2-superstrike.png"],
  // Note: 0xc539 is NOT mapped here — it's Logitech's shared Lightspeed
  // receiver PID, reused across G703, G Pro Wireless, and others, so it must
  // be disambiguated by name (see the name-fallback checks below) rather
  // than pinned to one render.
  // The original G Pro X Superlight reports as "PRO X Wireless" over HID++,
  // not "Superlight", so the name-based fallback below never matches it.
  // Same shell as the Superlight 2c closely enough to reuse its render.
  ["046d:c094", "logitech-pro-x-superlight-2c.png"],
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
  ["1532:0094", "razer-orochi-v2.png"],
  // MCHOSE A7 V2 family. Pro, Pro+, Ultra and Ultra+ are one shell with
  // different sensors — MCHOSE itself only publishes `A7V2Pro_*` renders — so
  // every model id and every link (receiver, Bluetooth, 8K receiver) maps to
  // the same art.
  ["3837:4018", "mchose-a7-v2.png"],
  ["3837:4019", "mchose-a7-v2.png"],
  ["3837:4021", "mchose-a7-v2.png"],
  ["3837:4023", "mchose-a7-v2.png"],
  ["3837:100a", "mchose-a7-v2.png"],
  ["3837:100b", "mchose-a7-v2.png"],
  ["3837:1020", "mchose-a7-v2.png"],
  // MCHOSE A7 V3 family — a different shell and a different protocol from the
  // V2 above. Its two receiver ids are shared with the other V3-generation
  // models, so they are deliberately not mapped: a K5 or R7 behind the same
  // dongle would get an A7 render.
  ["3837:4030", "mchose-a7-v3.png"],
  ["3837:4031", "mchose-a7-v3.png"],
  ["3837:4032", "mchose-a7-v3.png"],
  ["3837:4033", "mchose-a7-v3.png"],
  // CRDRAKO KO-ONE wired and receiver transports share the same shell.
  ["373e:006a", "crdrako-ko-one.png"],
  ["373e:006b", "crdrako-ko-one.png"],
  // Attack Shark R5 Ultra wired and wireless transports share the same shell.
  // ATK ZERO wired and its 8K receiver are the same shell.
  ["373b:1154", "atk-zero.png"],
  ["373b:1155", "atk-zero.png"],
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
  // Incott G23V2Pro: the dongle (0x522c) and the wired transport (0x622c)
  // are the same mouse, so they share one render.
  ["093a:522c", "incott-g23-v2-pro.png"],
  ["093a:622c", "incott-g23-v2-pro.png"],
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
  // VXE R1 family. R1, R1 SE/SE+, R1 Pro, and R1 Pro Max share the same shell.
  // Known wired / receiver transports therefore reuse one family render.
  ["3554:f58a", "vxe-r1-series.png"],
  ["3554:f58c", "vxe-r1-series.png"],
  ["3554:f58e", "vxe-r1-series.png"],
  ["3554:f58f", "vxe-r1-series.png"],
  ["373b:1085", "vxe-r1-series.png"],
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
  // K-snake X11 wired / 2.4 GHz dongle share the same shell.
  ["a8a4:2255", "ksnake-x11.png"],
  ["a8a5:2255", "ksnake-x11.png"],
  // A950 PRO Mg wired mouse and its dedicated 2.4 GHz receiver.
  ["260d:1117", "dareu-a950-pro-mg.png"],
  ["260d:1114", "dareu-a950-pro-mg.png"],
  // Microsoft Intellimouse
  ["045e:0823", "microsoft-classic-intellimouse.png"],
  ["045e:082a", "microsoft-pro-intellimouse.png"],
  // HyperX Pulsefire Haste: Kingston-era wired (0x0951:0x1727) and HP-era
  // wired / wired-mode / wireless dongle transports share one shell.
  ["0951:1727", "hyperx-pulsefire-haste.png"],
  ["03f0:0f8f", "hyperx-pulsefire-haste.png"],
  ["03f0:048e", "hyperx-pulsefire-haste.png"],
  ["03f0:028e", "hyperx-pulsefire-haste.png"],
  // Keychron M6 (1K, PixArt 3395) wired and its Link-KM receiver share one shell.
  ["3434:d060", "keychron-m6.png"],
  ["3434:d029", "keychron-m6.png"],
]);

function deviceKey(device: HIDDevice): string {
  const hex = (value: number): string => value.toString(16).padStart(4, "0");
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

/**
 * VID:PID pairs known to be genuinely shared across different physical
 * products (a receiver or ODM board reused by several models), transcribed
 * from the name-fallback comments below rather than kept as a second source
 * of truth. Crowd-sourced artwork is keyed by VID:PID alone (see
 * `deviceImage`), so without this, uploading art for one model sharing one
 * of these ids would apply it to every other model behind the same id —
 * these are skipped so crowd art is only ever trusted for a PID that maps to
 * exactly one product.
 *
 * Add an entry here whenever a name-fallback regex is added below for the
 * same reason (a shared receiver/PID, not just an unmapped model).
 */
const SHARED_PID_KEYS: ReadonlySet<string> = new Set([
  "046d:c539", // Logitech Lightspeed receiver (G502 X, G703, G Pro Wireless, ...)
  "3151:402d", // GearHub 2.4 GHz receiver (Attack Shark R2, Lingbao M5 Pro)
  "3837:4030", "3837:4031", "3837:4032", "3837:4033", // MCHOSE A7 V3-generation receiver ids
]);

/** WLMouse has no single shared receiver PID — its whole vendor id is name-resolved. */
const SHARED_PID_VENDOR_IDS: ReadonlySet<number> = new Set([0x36a7]);

function isSharedPidDevice(device: HIDDevice): boolean {
  return SHARED_PID_VENDOR_IDS.has(device.vendorId) || SHARED_PID_KEYS.has(deviceKey(device));
}

/** Matches upload.js's slug exactly — the two must agree for the lookup to ever hit. */
function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Crowd-sourced artwork cache. Populated asynchronously on app load from
 * `/api/artwork/list`. Once loaded, checked synchronously in
 * `resolveDeviceImageFilename` before the static map and name fallbacks.
 */
let crowdArtworkCache: Map<string, string> | null = null;
let crowdArtworkPromise: Promise<void> | null = null;

async function fetchCrowdArtworkMap(bypassHttpCache = false): Promise<Map<string, string> | null> {
  try {
    // /api/artwork/list is served with a 5-minute Cache-Control so normal
    // page loads are cheap, but that means a plain fetch() right after an
    // upload can still be answered from the browser's HTTP cache with the
    // pre-upload list. refreshCrowdArtworkCache needs a real network hit.
    const response = await fetch(bypassHttpCache ? "/api/artwork/list?fresh=1" : "/api/artwork/list", {
      headers: { Accept: "application/json" },
      cache: bypassHttpCache ? "no-store" : "default",
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text) return null;
    const data = JSON.parse(text);
    if (!Array.isArray(data.artworks)) return null;

    const map = new Map<string, string>();
    for (const entry of data.artworks) {
      if (typeof entry.vendorId === "number" && typeof entry.productId === "number" && typeof entry.filename === "string") {
        const hex = (v: number) => v.toString(16).padStart(4, "0");
        const pidKey = `${hex(entry.vendorId)}:${hex(entry.productId)}`;
        // A shared-id upload carries a nameSlug (see upload.js/list.js) so it
        // doesn't collide with a different model behind the same raw id —
        // keyed separately here, looked up the same way in deviceImage().
        const key = typeof entry.nameSlug === "string" && entry.nameSlug ? `${pidKey}:${entry.nameSlug}` : pidKey;
        map.set(key, entry.filename);
      }
    }
    return map;
  } catch {
    // Network error — continue without crowd art
    return null;
  }
}

export async function loadCrowdArtworkCache(): Promise<void> {
  if (crowdArtworkCache) return;
  if (crowdArtworkPromise) return crowdArtworkPromise;

  crowdArtworkPromise = (async () => {
    const map = await fetchCrowdArtworkMap();
    if (map) crowdArtworkCache = map;
  })();

  return crowdArtworkPromise;
}

/**
 * Forces a fresh fetch of the crowd-artwork list, replacing the cache in
 * place. Call this right after a successful upload — otherwise the uploader
 * keeps seeing the placeholder until they reload, since `loadCrowdArtworkCache`
 * is a no-op once the cache has been populated once.
 */
export async function refreshCrowdArtworkCache(): Promise<void> {
  crowdArtworkPromise = null;
  const map = await fetchCrowdArtworkMap(true);
  if (map) crowdArtworkCache = map;
}

export function hasCrowdArtwork(vendorId: number, productId: number): boolean {
  if (!crowdArtworkCache) return false;
  const hex = (v: number) => v.toString(16).padStart(4, "0");
  return crowdArtworkCache.has(`${hex(vendorId)}:${hex(productId)}`);
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
  if (/\bvxe\s+r1(?:\s+(?:se\+?|pro(?:\s+max)?))?\b/i.test(displayName)) {
    return "vxe-r1-series.png";
  }
  if (/\br5\s*ultra\b/i.test(displayName)) return "attackshark-r5-ultra.png";
  // R2 shares PID 0x402D with the Lingbao M5 Pro, so it can only be told apart
  // by the name the gearhub driver reads back from the device id.
  if (/\battack\s*shark\s*r2\b/i.test(displayName)) return "attackshark-r2.png";
  if (/\bm[23]k\b/i.test(displayName)) return "zaunkoenig-m3k.png";
  if (/\bmx\s*master\s*3s\b/i.test(displayName)) return "logitech-mx-master-3s.png";
  if (/\bterra\s*pro\b/i.test(displayName)) return "teevolution-terra-pro.png";
  if (/\bm-001\b/i.test(displayName)) return "wallhack-m-001.png";
  if (/\bk-001\b/i.test(displayName)) return "wallhack-k-001.png";
  // Corsair NIGHTSWORD RGB has no product render yet; resolves to the generic
  // placeholder until art is uploaded (then add ["1b1c:1b5c", ...] above).
  if (/\bnightsword\b/i.test(displayName)) return "unknown-device.png";
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
  // Wireless resolves to its own render; the shared Lightspeed receiver PID
  // (0xc539) is why this has to be a name check rather than a PID entry.
  if (/\bg\s*pro\s*wireless\b/i.test(displayName)) return "logitech-gpro-wireless.png";
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
  // WLMouse receivers are shared across models — the 1K dongle enumerates under
  // one product id whatever it is paired with — so the model only arrives in the
  // name the driver reads back from the mouse.
  if (/\bbeast\s*max\b/i.test(displayName)) return "wlmouse-beast-max.png";
  if (/\bbeast\s*g\b/i.test(displayName)) return "wlmouse-beast-g.png";
  if (/\bbeast\s*x\s*pro\b/i.test(displayName)) return "unknown-device.png";
  if (/\bbeast\s*mini\b/i.test(displayName)) return "unknown-device.png";
  if (/\bbeast\s*x\b/i.test(displayName)) return "unknown-device.png";
  if (/\bsword\s*x\b/i.test(displayName)) return "wlmouse-sword-x.png";
  if (/\bdragonfly\s*f2\b/i.test(displayName)) return "vgn-dragonfly-f2.png";
  if (/\bmaya\s*x\b/i.test(displayName)) return "lamzu-maya-x.png";
  if (/k[\s-]*snake/i.test(displayName)) return "ksnake-x11.png";
  if (/\bf1\s*v2\b/i.test(displayName)) return "atk-f1-v2-ultra-max.png";
  // Catches any A7 variant whose product id is not pinned above. V3 first, so
  // an "A7 V3" name is not swallowed by a looser A7 match later.
  if (/\ba7\s*v3\b/i.test(displayName)) return "mchose-a7-v3.png";
  if (/\ba7\s*v2\b/i.test(displayName)) return "mchose-a7-v2.png";
  if (/\ba950\s*pro\s*mg\b/i.test(displayName)) return "dareu-a950-pro-mg.png";
  if (/\b(finalmouse|starlight|ulx)\b/i.test(displayName)) return "finalmouse-ulx.png";
  if (/\borbital\b/i.test(displayName)) return "unknown-device.png";
  if (/\bmoddo/i.test(displayName)) return "unknown-device.png";
  if (/\bintellimouse\s*classic\b/i.test(displayName)) return "microsoft-classic-intellimouse.png";
  if (/\bpro\s*intellimouse\b/i.test(displayName)) return "microsoft-pro-intellimouse.png";
  if (/\bintellimouse\b/i.test(displayName)) return "microsoft-classic-intellimouse.png";
  if (/\bpulsefire\s*haste\b/i.test(displayName)) return "hyperx-pulsefire-haste.png";
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
 *
 * Served from a custom domain (img.openmouse.app) bound to the bucket
 * rather than its r2.dev URL — the r2.dev subdomain is unauthenticated,
 * shared, and rate-limited by Cloudflare, and isn't meant for production
 * traffic.
 */
const DEVICE_IMAGE_BASE_URL = "https://img.openmouse.app/";

export function deviceImage(device: HIDDevice | null | undefined, displayName = ""): string {
  // Crowd-sourced artwork takes priority. For a shared VID:PID, a bare
  // vendorId:productId key would be whichever model someone happened to
  // upload for and wrong for every other model behind the same id — so those
  // devices are looked up by vendorId:productId:nameSlug instead (matching
  // how upload.js keys them), and only served when the reported name
  // actually matches. No name match falls through to
  // resolveDeviceImageFilename's own name-based checks, same as it already
  // does when there's no crowd art at all.
  if (device && crowdArtworkCache) {
    const shared = isSharedPidDevice(device);
    const key = shared ? `${deviceKey(device)}:${slugifyName(displayName)}` : deviceKey(device);
    const crowdFilename = crowdArtworkCache.get(key);
    if (crowdFilename) return DEVICE_IMAGE_BASE_URL + `crowd/${crowdFilename}`;
  }
  return DEVICE_IMAGE_BASE_URL + resolveDeviceImageFilename(device, displayName);
}

/**
 * A curated, brand-diverse sample of real product renders (not every device
 * this app supports — just enough to cycle through on the "Add mouse" card
 * before anything is connected). Filenames only, so callers build the full
 * URL with `showcaseDeviceImageUrls`.
 */
// Every filename here is checked against the R2 bucket directly (curl -o
// /dev/null -w '%{http_code}') before landing on this list — several
// filenames mapped in DEVICE_IMAGES above 404 because the art was never
// uploaded (attackshark-r2.png, mchose-a7-v2.png, atk-zero.png, and the
// Microsoft IntelliMouse renders among them), which silently fails on the
// device panel but breaks a showcase that's shown unconditionally.
const SHOWCASE_DEVICE_FILENAMES: readonly string[] = [
  "logitech-g502-x-plus.png",
  "razer-viper-v3-pro.png",
  "endgame-gear-xm2-8k.png",
  "finalmouse-ulx.png",
  "pulsar-x2-v2.png",
  "lamzu-maya-x.png",
  "zaunkoenig-m3k.png",
  "attackshark-r5-ultra.png",
  "logitech-g-pro-2.png",
  "razer-deathadder-v3.png",
  "wlmouse-sword-x.png",
  "wlmouse-beast-max.png",
];

export function showcaseDeviceImageUrls(): readonly string[] {
  return SHOWCASE_DEVICE_FILENAMES.map((filename) => DEVICE_IMAGE_BASE_URL + filename);
}

export const UNKNOWN_DEVICE_FILENAME = "unknown-device.png";

export function isUnknownDevice(device: HIDDevice | null | undefined, displayName = ""): boolean {
  // If crowd art exists, it's not unknown
  if (device && crowdArtworkCache) {
    const crowdFilename = crowdArtworkCache.get(deviceKey(device));
    if (crowdFilename) return false;
  }
  return resolveDeviceImageFilename(device, displayName) === UNKNOWN_DEVICE_FILENAME;
}
