import { EGG_WE_HID_FILTERS } from "./egg-we-control";

export const VENDOR_ID = {
  pulsar: 0x3710,
  endgameGear: 0x3367,
  wlmouse: 0x36a7,
  logitech: 0x046d,
  /** Compx ODM VID used by original Lamzu Maya / Atlantis receivers. */
  lamzu: 0x3554,
  /** Lamzu-branded Aurora mice (Maya X, etc.). */
  lamzuNative: 0x373e,
} as const;

/** Compx + Lamzu-native Aurora vendor IDs. */
export const LAMZU_VENDOR_IDS: ReadonlySet<number> = new Set([
  VENDOR_ID.lamzu,
  VENDOR_ID.lamzuNative,
]);

export function isLamzuVendor(vendorId: number): boolean {
  return LAMZU_VENDOR_IDS.has(vendorId);
}

/**
 * Known Lamzu product IDs (matched together with {@link isLamzuVendor}).
 * Compx Maya uses 0x3554; Maya X uses 0x373e.
 */
export const LAMZU_PRODUCTS: ReadonlyMap<number, { name: string; wireless: boolean }> = new Map([
  // Compx / original Maya
  [0xf50f, { name: "Maya", wireless: false }],
  [0xf510, { name: "Maya", wireless: true }],
  [0xf50d, { name: "Maya 1K receiver", wireless: true }],
  /** Generic Compx 2.4G receiver sometimes paired with Maya. */
  [0xfa09, { name: "Maya", wireless: true }],
  // Lamzu Maya X (VID 0x373e)
  [0x001c, { name: "Maya X", wireless: false }],
  [0x001e, { name: "Maya X", wireless: true }],
]);

export const LAMZU_MAX_POLLING_HZ: ReadonlyMap<number, number> = new Map([
  [0xf50f, 1000],
  [0xf50d, 1000],
  [0xf510, 8000],
  [0xfa09, 8000],
  [0x001c, 8000],
  [0x001e, 8000],
]);

/** Prefer every Compx/Lamzu interface; ranking picks control over utility collections. */
export const LAMZU_HID_FILTERS: HIDDeviceFilter[] = [
  { vendorId: VENDOR_ID.lamzu },
  { vendorId: VENDOR_ID.lamzuNative },
];

export const LOGITECH_RECEIVER_FILTER: HIDDeviceFilter = {
  vendorId: VENDOR_ID.logitech,
  productId: 0xc54d,
  usagePage: 0xff00,
  usage: 0x0001,
};

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
  { vendorId: VENDOR_ID.pulsar },
  { vendorId: VENDOR_ID.endgameGear },
  { vendorId: VENDOR_ID.wlmouse },
  ...LAMZU_HID_FILTERS,
  ...EGG_WE_HID_FILTERS,
  LOGITECH_RECEIVER_FILTER,
];
