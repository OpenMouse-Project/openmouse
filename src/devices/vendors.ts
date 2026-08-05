import { EGG_WE_HID_FILTERS } from "./endgame/egg-we-control";
import { LOGITECH_DIRECT_PRODUCT_IDS } from "./logitech/protocol";

export const VENDOR_ID = {
  pulsar: 0x3710,
  endgameGear: 0x3367,
  wlmouse: 0x36a7,
  lamzu: 0x373e,
  logitech: 0x046d,
  orbital: 0x1915,
  razer: 0x1532,
  teevolution: 0x3554,
  vgn: 0x3554,
  atk: 0x373b,
  finalmouse: 0x361d,
} as const;

// Viper V3 Pro exposes its control channel as a Generic Desktop Mouse
// collection. Limit this broad collection filter to its two known PIDs so it
// cannot also surface unrelated Razer keyboards or the Viper V4 Pro's ordinary
// boot-mouse interfaces.
export const RAZER_VIPER_V3_CONTROL_FILTERS: HIDDeviceFilter[] = [0x00c0, 0x00c1].map(
  (productId) => ({ vendorId: VENDOR_ID.razer, productId, usagePage: 0x01, usage: 0x02 }),
);

// Synapse Web exposes the V4 control interface through a single top-level
// Generic Desktop or Consumer collection with Feature reports. Request both
// pages so the browser offers that interface, then the driver rejects ordinary
// mouse/keyboard interfaces that lack the required report.
export const RAZER_VIPER_V4_CONTROL_FILTERS: HIDDeviceFilter[] = [0x00e5, 0x00e6].flatMap(
  (productId) => [0x01, 0x0c].map((usagePage) => ({ vendorId: VENDOR_ID.razer, productId, usagePage })),
);

export const TEEVOLUTION_PRODUCT_IDS = [0xf520, 0xf523, 0xf5bb, 0xf522] as const;

// Logitech HID++ control interfaces addressed through a receiver slot (HID++
// device index 0x01). 0xc54d and 0xc547 are newer Lightspeed receivers, 0xc539
// is HERO-era Lightspeed, and 0xc0a8 is the PRO X 2 Superstrike USB interface.
export const LOGITECH_RECEIVER_PRODUCT_IDS = [0xc54d, 0xc539, 0xc0a8, 0xc547] as const;

// Every Logitech product with an HID++ control interface, receiver-addressed or
// not. Direct-connect product IDs live in ./logitech/protocol so the driver and
// these filters cannot disagree about which index a mouse answers on.
export const LOGITECH_PRODUCT_IDS = [
  ...LOGITECH_RECEIVER_PRODUCT_IDS,
  ...LOGITECH_DIRECT_PRODUCT_IDS,
] as const;

export const LOGITECH_RECEIVER_FILTERS: HIDDeviceFilter[] = LOGITECH_PRODUCT_IDS.map(
  (productId) => ({ vendorId: VENDOR_ID.logitech, productId, usagePage: 0xff00, usage: 0x0001 }),
);

// Retained for existing imports; points at the first supported receiver.
export const LOGITECH_RECEIVER_FILTER: HIDDeviceFilter = LOGITECH_RECEIVER_FILTERS[0];

export const WLMOUSE_PRODUCTS: ReadonlyMap<number, { name: string; wireless: boolean }> = new Map([
  [0xa860, { name: "Beast G", wireless: true }],
  [0xa861, { name: "Beast G", wireless: false }],
  [0xa863, { name: "Huan", wireless: true }],
  [0xa864, { name: "Huan", wireless: false }],
  [0xa866, { name: "Beast Miao", wireless: true }],
  [0xa867, { name: "Beast Miao", wireless: false }],
  [0xa868, { name: "Beast Mini Pro", wireless: true }],
  [0xa869, { name: "Beast Mini Pro", wireless: false }],
  [0xa870, { name: "Beast X Pro", wireless: true }],
  [0xa871, { name: "Beast X Pro", wireless: false }],
  [0xa872, { name: "Strider", wireless: true }],
  [0xa873, { name: "Strider", wireless: false }],
  [0xa874, { name: "Ying", wireless: true }],
  [0xa875, { name: "Ying", wireless: false }],
  [0xa878, { name: "Sword X", wireless: true }],
  [0xa879, { name: "Sword X", wireless: false }],
  [0xa880, { name: "Beast Max", wireless: true }],
  [0xa881, { name: "Beast Max", wireless: false }],
  [0xa882, { name: "WLmouse 1K receiver", wireless: true }],
  [0xa883, { name: "Beast X", wireless: true }],
  [0xa884, { name: "Beast X", wireless: false }],
  [0xa885, { name: "Beast Mini", wireless: true }],
  [0xa886, { name: "Beast Mini", wireless: false }],
]);

export const WLMOUSE_MAX_POLLING_HZ: ReadonlyMap<number, number> = new Map([
  [0xa882, 1000],
]);

export const SUPPORTED_HID_FILTERS: HIDDeviceFilter[] = [
  { vendorId: VENDOR_ID.finalmouse, productId: 0x0100, usagePage: 0xff00, usage: 0x0001 },
  { vendorId: VENDOR_ID.pulsar },
  { vendorId: VENDOR_ID.endgameGear },
  { vendorId: VENDOR_ID.wlmouse },
  { vendorId: VENDOR_ID.lamzu },
  { vendorId: VENDOR_ID.orbital, usagePage: 0xff0a, usage: 1 },
  ...TEEVOLUTION_PRODUCT_IDS.map((productId) => ({ vendorId: VENDOR_ID.teevolution, productId })),
  ...RAZER_VIPER_V3_CONTROL_FILTERS,
  { vendorId: VENDOR_ID.vgn, productId: 0xfb56 },
  { vendorId: VENDOR_ID.vgn, productId: 0xfb57 },
  { vendorId: VENDOR_ID.atk, usagePage: 0xff02, usage: 2 },
  ...RAZER_VIPER_V4_CONTROL_FILTERS,
  ...EGG_WE_HID_FILTERS,
  ...LOGITECH_RECEIVER_FILTERS,
];
