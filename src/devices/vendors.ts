import { EGG_WE_HID_FILTERS } from "./endgame/egg-we-control";

export const VENDOR_ID = {
  pulsar: 0x3710,
  endgameGear: 0x3367,
  wlmouse: 0x36a7,
  lamzu: 0x373e,
  logitech: 0x046d,
  orbital: 0x1915,
} as const;

// Logitech HID++ control interfaces. 0xc54d/0xc539 are receiver interfaces;
// 0xc0a8 and 0xc09b are the Superstrike and Superlight 2 USB interfaces.
export const LOGITECH_RECEIVER_PRODUCT_IDS = [0xc54d, 0xc539, 0xc0a8, 0xc09b] as const;

export const LOGITECH_RECEIVER_FILTERS: HIDDeviceFilter[] = LOGITECH_RECEIVER_PRODUCT_IDS.map(
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
  { vendorId: VENDOR_ID.pulsar },
  { vendorId: VENDOR_ID.endgameGear },
  { vendorId: VENDOR_ID.wlmouse },
  { vendorId: VENDOR_ID.lamzu },
  { vendorId: VENDOR_ID.orbital, usagePage: 0xff0a, usage: 1 },
  ...EGG_WE_HID_FILTERS,
  ...LOGITECH_RECEIVER_FILTERS,
];
