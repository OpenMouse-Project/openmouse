import { EGG_WE_HID_FILTERS } from "./egg-we-control";

export const VENDOR_ID = {
  pulsar: 0x3710,
  endgameGear: 0x3367,
  wlmouse: 0x36a7,
  lamzu: 0x373e,
  lamzuAlt: 0x37b0,
  logitech: 0x046d,
} as const;

export const LOGITECH_RECEIVER_FILTER: HIDDeviceFilter = {
  vendorId: VENDOR_ID.logitech,
  productId: 0xc54d,
  usagePage: 0xff00,
  usage: 0x0001,
};

export const SUPPORTED_HID_FILTERS: HIDDeviceFilter[] = [
  { vendorId: VENDOR_ID.pulsar },
  { vendorId: VENDOR_ID.endgameGear },
  { vendorId: VENDOR_ID.wlmouse },
  { vendorId: VENDOR_ID.lamzu },
  ...EGG_WE_HID_FILTERS,
  LOGITECH_RECEIVER_FILTER,
];

export interface DeviceProfile {
  model: string;
  wireless: boolean;
  pollingRates?: readonly number[];
  maxDpi?: number;
  sleepOptions?: readonly number[];
}

export const LAMZU_SLEEP_SECONDS: readonly number[] = [10, 30, 60, 300, 600, 1800];
export const WLMOUSE_SLEEP_SECONDS: readonly number[] = [30, 60, 120, 300, 600, 1800];

export const deviceKey = (vendorId: number, productId: number): string =>
  `${vendorId.toString(16)}:${productId.toString(16)}`;

const RATES_1K: readonly number[] = [125, 250, 500, 1000];
const RATES_8K: readonly number[] = [500, 1000, 2000, 4000, 8000];

const wlmouse = (productId: number, model: string, wireless: boolean): [string, DeviceProfile] =>
  [deviceKey(VENDOR_ID.wlmouse, productId), { model, wireless }];

export const WLMOUSE_DEVICES: ReadonlyMap<string, DeviceProfile> = new Map([
  wlmouse(0xa860, "Beast G", true),
  wlmouse(0xa861, "Beast G", false),
  wlmouse(0xa863, "Huan", true),
  wlmouse(0xa864, "Huan", false),
  wlmouse(0xa866, "Beast Miao", true),
  wlmouse(0xa867, "Beast Miao", false),
  wlmouse(0xa868, "Beast Mini Pro", true),
  wlmouse(0xa869, "Beast Mini Pro", false),
  wlmouse(0xa870, "Beast X Pro", true),
  wlmouse(0xa871, "Beast X Pro", false),
  wlmouse(0xa872, "Strider", true),
  wlmouse(0xa873, "Strider", false),
  wlmouse(0xa874, "Ying", true),
  wlmouse(0xa875, "Ying", false),
  wlmouse(0xa878, "Sword X", true),
  wlmouse(0xa879, "Sword X", false),
  wlmouse(0xa880, "Beast Max", true),
  wlmouse(0xa881, "Beast Max", false),
  wlmouse(0xa883, "Beast X", true),
  wlmouse(0xa884, "Beast X", false),
  wlmouse(0xa885, "Beast Mini", true),
  wlmouse(0xa886, "Beast Mini", false),
  [deviceKey(VENDOR_ID.wlmouse, 0xa882), { model: "1K receiver", wireless: true, pollingRates: RATES_1K }],
]);

const lamzu = (
  vendorId: number,
  productId: number,
  model: string,
  wireless: boolean,
  pollingRates: readonly number[],
  maxDpi?: number,
  sleepOptions?: readonly number[],
): [string, DeviceProfile] => [
  deviceKey(vendorId, productId),
  {
    model,
    wireless,
    pollingRates,
    ...(maxDpi ? { maxDpi } : {}),
    ...(sleepOptions ? { sleepOptions } : {}),
  },
];

const LAMZU = VENDOR_ID.lamzu;

export const LAMZU_DEVICES: ReadonlyMap<string, DeviceProfile> = new Map([
  lamzu(LAMZU, 0x001c, "Maya X", false, RATES_1K),
  lamzu(LAMZU, 0x001d, "Maya X", true, RATES_1K),
  lamzu(LAMZU, 0x001e, "Maya X", true, RATES_8K),
]);
