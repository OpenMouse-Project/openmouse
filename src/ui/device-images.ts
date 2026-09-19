/**
 * Top-down product art for the persistent device panel.
 *
 * Resolved entirely by the device's own reported name (see
 * `resolveDeviceImageFilename`), not by VID:PID — a USB id is not always
 * unique to one product (see `SHARED_PID_KEYS`/`SHARED_PID_VENDOR_IDS`
 * below), and matching by name is the one identifier that's actually
 * specific to the physical product in every case, not just the shared ones.
 * The trade-off: a device's image can only resolve once its real name is
 * known (after a full connect and read), where a VID:PID map would have
 * resolved instantly from the raw `productName` string alone. Until then —
 * or if a model has no name rule yet — it shows the generic placeholder.
 *
 * Files are hosted in the `openmouse-devices` Cloudflare R2 bucket (public
 * access via its r2.dev URL, see `DEVICE_IMAGE_BASE_URL` below) rather than
 * committed to the repo, so only bare filenames appear below. A filename
 * whose file is missing in the bucket therefore fails at load rather than at
 * build time, so the panel drops the thumbnail on that error and keeps the
 * layout it had before any art existed. See `public/devices/README.md` for
 * how to upload new art.
 */

function resolveDeviceImageFilename(_device: HIDDevice | null | undefined, displayName = ""): string {
  // Lightspeed receivers are shared product IDs, so paired G502 X variants
  // must use the friendly name read from the mouse itself.
  if (/g502\s*x\s*plus/i.test(displayName)) return "logitech-g502-x-plus.png";
  if (/g502\s*x/i.test(displayName)) return "logitech-g502-x.png";
  if (/\bg502\b/i.test(displayName)) return "logitech-g502.png";
  if (/\bg703\b/i.test(displayName)) return "logitech-g703.png";
  // The original G Pro X Superlight reports as "PRO X Wireless" over HID++,
  // not "Superlight" — matched on the wireless name instead, reusing the
  // Superlight 2c's render (close enough a shell). The `superlight` check a
  // few lines down covers every other Superlight generation.
  if (/\bpro\s*x\s*wireless\b/i.test(displayName)) return "logitech-pro-x-superlight-2c.png";
  if (/mx\s*master\s*4/i.test(displayName)) return "unknown-device.png";
  if (/superstrike/i.test(displayName)) return "logitech-pro-x2-superstrike.png";
  if (/superlight/i.test(displayName)) return "logitech-pro-x-superlight-2c.png";
  if (/op1we/i.test(displayName)) return "endgame-gear-op1we.png";
  if (/\bop1\b/i.test(displayName)) return "endgame-gear-op1-8k.png";
  if (/\bviper\s*v2\s*pro\b/i.test(displayName)) return "razer-viper-v2-pro.png";
  // "Viper V3 Pro SE" must not fall into the plain V3 Pro render.
  if (/\bviper\s*v3\s*pro\b(?!\s*se)/i.test(displayName)) return "razer-viper-v3-pro.png";
  if (/\bviper\s*mini\b/i.test(displayName)) return "razer-viper-mini.webp";
  if (/\borochi\s*v2\b/i.test(displayName)) return "razer-orochi-v2.png";
  if (/\bcobra\b/i.test(displayName)) return "razer-cobra.webp";
  if (/\bnape\s*pro\b/i.test(displayName)) return "unknown-device.png";
  if (/\bko-one\b/i.test(displayName)) return "crdrako-ko-one.png";
  if (/\bvxe\s+r1(?:\s+(?:se\+?|pro(?:\s+max)?))?\b/i.test(displayName)) {
    return "vxe-r1-series.png";
  }
  if (/\br5\s*ultra\b/i.test(displayName)) return "attackshark-r5-ultra.png";
  if (/\batk\s*zero\b/i.test(displayName)) return "atk-zero.png";
  // R2 shares PID 0x402D with the Lingbao M5 Pro, so it can only be told apart
  // by the name the gearhub driver reads back from the device id.
  if (/\battack\s*shark\s*r2\b/i.test(displayName)) return "attackshark-r2.png";
  if (/\bdelux\b.*\bm800/i.test(displayName) || /\bm800\s*(mini|pro)?\b/i.test(displayName)) {
    return "delux-m800-mini.png";
  }
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
  if (/\bdeathadder\s*v3\s*hyperspeed\b/i.test(displayName)) return "razer-deathadder-v3-hyperspeed.png";
  // V3 and V3 Pro are one shell (the Pro drops the cable), so the Pro shares
  // the V3 render the same way the V2 family shares one below. The Pro used
  // to be excluded here while it was still test-needed; it has since been
  // verified on hardware (mouse-protocol `0x00b7`). HyperSpeed is a different
  // shell and is matched above.
  if (/\bdeathadder\s*v3\b/i.test(displayName)) return "razer-deathadder-v3.png";
  if (/\bdeathadder\s*v2\b(?!\s*x\s*hyperspeed\b)/i.test(displayName)) return "razer-deathadder-v2.png";
  if (/\bdeathadder\s*essential\b/i.test(displayName)) return "razer-deathadder-v2.png";
  if (/\bviper\s*v3\s*hyperspeed\b/i.test(displayName)) return "razer-viper-v3-hyperspeed.png";
  if (/\bviper\s*v4\b/i.test(displayName)) return "razer-viper-v4-pro.png";
  // Catches the plain original Viper. Every other Viper generation is matched
  // above, so this must run last among the viper checks — excluding every
  // variant with no render of its own, so it falls to the placeholder rather
  // than borrowing this one.
  if (/\bviper\b(?!\s*(ultimate|8khz|mini|v2|v3|v4))/i.test(displayName)) return "razer-viper.webp";
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
  // NinjaForce/Ninjutso family — V3 first so "Sora V3" isn't swallowed by a
  // looser V2 or "Ten" match.
  if (/\bsora\s*v3\b/i.test(displayName)) return "ninjutso-sora-v3.png";
  if (/\bsora\s*v2\b/i.test(displayName)) return "ninjutso-sora-v2.png";
  if (/\bninjutso\b.*\bten\b/i.test(displayName)) return "ninjutso-ten.png";
  // Incott: six model families, each sold in a base and a Pro version with
  // a different shell finish, so all twelve get their own render. The driver
  // reads the model from the device and appends "Pro" when the PAW3950 is
  // fitted (see incott/index.ts), giving names like "Ghero", "G23V2 Pro" or
  // "Zero 39". Wired with no identity read it falls back to the product
  // string, "Esports G23V2Pro", which these same patterns match because
  // every separator is optional.
  //
  // Each Pro pattern MUST precede its base model, and the G23V2 pair must
  // precede the plain G23 pair, or the looser rule swallows the tighter one.
  if (/\bg23\s*v2\s*pro\b/i.test(displayName)) return "incott-g23-v2-pro.png";
  if (/\bg23\s*v2\b/i.test(displayName)) return "incott-g23-v2.png";
  if (/\bg23\s*pro\b/i.test(displayName)) return "incott-g23-pro.png";
  if (/\bg23\b/i.test(displayName)) return "incott-g23.png";
  if (/\bg24\s*pro\b/i.test(displayName)) return "incott-g24-pro.png";
  if (/\bg24\b/i.test(displayName)) return "incott-g24.png";
  if (/\bghero\s*pro\b/i.test(displayName)) return "incott-ghero-pro.png";
  if (/\bghero\b/i.test(displayName)) return "incott-ghero.png";
  if (/\bzero\s*29\s*pro\b/i.test(displayName)) return "incott-zero-29-pro.png";
  if (/\bzero\s*29\b/i.test(displayName)) return "incott-zero-29.png";
  if (/\bzero\s*39\s*pro\b/i.test(displayName)) return "incott-zero-39-pro.png";
  if (/\bzero\s*39\b/i.test(displayName)) return "incott-zero-39.png";
  if (/\bkeychron\s*m6\b/i.test(displayName)) return "keychron-m6.png";
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

/**
 * TEMPORARY local override — see `public/devices/README.md` →
 * `attackshark-r2.png`. The real Attack Shark R2 render is checked into the
 * repo (`public/devices/attackshark-r2.png`, served at `/devices/...`) so the
 * panel shows correct art while the R2 upload awaits. Once the file is up in
 * the bucket, delete this map, the file under `public/devices/`, and the
 * README note.
 */
const LOCAL_OVERRIDES: Readonly<Record<string, string>> = {
  "attackshark-r2.png": "/devices/attackshark-r2.png",
  "delux-m800-mini.png": "/devices/delux-m800-mini.png",
};

export function deviceImage(device: HIDDevice | null | undefined, displayName = ""): string {
  const filename = resolveDeviceImageFilename(device, displayName);
  return LOCAL_OVERRIDES[filename] ?? DEVICE_IMAGE_BASE_URL + filename;
}

/**
 * The bare filename a device's artwork resolves to (no bucket URL). Lets
 * callers detect placeholder-bound devices without importing the resolver's
 * internals.
 */
export function deviceImageFilename(displayName = ""): string {
  return resolveDeviceImageFilename(null, displayName);
}

/**
 * A curated, brand-diverse sample of real product renders (not every device
 * this app supports — just enough to cycle through on the "Add mouse" card
 * before anything is connected). Filenames only, so callers build the full
 * URL with `showcaseDeviceImageUrls`.
 */
// Every filename here is checked against the R2 bucket directly (curl -o
// /dev/null -w '%{http_code}') before landing on this list — several
// filenames resolveDeviceImageFilename can return above 404 because the art
// was never uploaded (attackshark-r2.png, mchose-a7-v2.png, atk-zero.png,
// and the Microsoft IntelliMouse renders among them), which silently fails
// on the device panel but breaks a showcase that's shown unconditionally.
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
  return resolveDeviceImageFilename(device, displayName) === UNKNOWN_DEVICE_FILENAME;
}
