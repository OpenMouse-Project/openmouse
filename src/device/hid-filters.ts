import { SUPPORTED_HID_FILTERS } from "@openmouse/protocol/drivers/vendors";
import { WUQUE_HID_FILTERS, KOCHI_HID_FILTERS } from "@openmouse/keyboard-protocol/drivers";

/**
 * The Basilisk V3 Pro in Bluetooth mode. It enumerates under Razer's Bluetooth
 * SIG id rather than 0x1532, and takes settings over a vendor GATT service
 * instead of HID, so no driver can claim it. It is offered anyway so picking
 * it explains itself rather than the mouse silently never appearing.
 */
export const BASILISK_V3_PRO_BLUETOOTH = { vendorId: 0x068e, productId: 0x00ac };

/** Everything the app asks the browser (or Bridge) for. */
export const HID_FILTERS: HIDDeviceFilter[] = [...SUPPORTED_HID_FILTERS, ...WUQUE_HID_FILTERS, ...KOCHI_HID_FILTERS, BASILISK_V3_PRO_BLUETOOTH];
