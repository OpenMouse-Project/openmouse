import { SUPPORTED_HID_FILTERS } from "@openmouse/protocol/drivers/vendors";
import { SUPPORTED_HID_FILTERS as KEYBOARD_HID_FILTERS } from "@openmouse/keyboard-protocol/drivers";
import { KEYCHRON_CONFIG_USAGE, KEYCHRON_CONFIG_USAGE_PAGE, KEYCHRON_HE_PRODUCTS, KEYCHRON_VENDOR_ID } from "@openmouse/keyboard-protocol/keychron";
import { keychronHallEffectEnabled } from "./keychron-flag.ts";

/**
 * The Basilisk V3 Pro in Bluetooth mode. It enumerates under Razer's Bluetooth
 * SIG id rather than 0x1532, and takes settings over a vendor GATT service
 * instead of HID, so no driver can claim it. It is offered anyway so picking
 * it explains itself rather than the mouse silently never appearing.
 */
export const BASILISK_V3_PRO_BLUETOOTH = { vendorId: 0x068e, productId: 0x00ac };

/** Raw-HID command collection of every catalogued Keychron Hall-effect board. */
export const KEYCHRON_HID_FILTERS: HIDDeviceFilter[] = Object.keys(KEYCHRON_HE_PRODUCTS).map((productId) => ({
  vendorId: KEYCHRON_VENDOR_ID,
  productId: Number(productId),
  usagePage: KEYCHRON_CONFIG_USAGE_PAGE,
  usage: KEYCHRON_CONFIG_USAGE,
}));

/** Keychron filters are offered only behind the experimental flag, read when the app loads. */
export const HID_FILTERS: HIDDeviceFilter[] = [
  ...SUPPORTED_HID_FILTERS, ...KEYBOARD_HID_FILTERS, ...(keychronHallEffectEnabled() ? KEYCHRON_HID_FILTERS : []),
  BASILISK_V3_PRO_BLUETOOTH,
];
