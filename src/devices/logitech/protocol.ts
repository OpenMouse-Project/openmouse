// HID++ reserves software ID 0 for device-originated notifications. Using a
// nonzero ID keeps command replies distinct from asynchronous mouse events.
const SOFTWARE_ID = 0x05;

/** Add this client's HID++ software ID while preserving the function nibble. */
export function withSoftwareId(functionId: number): number {
  return (functionId & 0xf0) | SOFTWARE_ID;
}

/** Receiver-attached mice answer on the receiver's first pairing slot. */
export const DEVICE_INDEX_RECEIVER = 0x01;
/** A mouse addressed over its own USB interface answers on 0xFF. */
export const DEVICE_INDEX_DIRECT = 0xff;

/**
 * Logitech mice whose vendor interface is the mouse itself rather than a
 * receiver. They answer HID++ on device index 0xFF and keep their writable
 * settings in an onboard profile. 0xc07e is the wired G402 / G402 Hyperion Fury.
 *
 * This module deliberately imports nothing, so both the driver and the WebHID
 * filters in ../vendors can read it without a cycle.
 */
export const LOGITECH_DIRECT_PRODUCT_IDS = [0xc07e] as const;

const DIRECT_PRODUCT_ID_SET: ReadonlySet<number> = new Set(LOGITECH_DIRECT_PRODUCT_IDS);

export function isDirectConnectProduct(productId: number): boolean {
  return DIRECT_PRODUCT_ID_SET.has(productId);
}

/** USB HID++ control interface: vendor page 0xFF00, usage 0x0001. */
export const HIDPP_USB_USAGE_PAGE = 0xff00;
export const HIDPP_USB_USAGE = 0x0001;
/**
 * Over Bluetooth the same protocol moves to a vendor page of its own, and only
 * the long report (0x11) exists — there is no 0x10 short report to send on.
 */
export const HIDPP_BLUETOOTH_USAGE_PAGE = 0xff43;

/**
 * Logitech mice paired over Bluetooth rather than through a receiver. Like the
 * direct-connect USB mice they answer HID++ on device index 0xFF, but they are
 * listed separately because they do not share the onboard-profile behaviour
 * that makes the G402's polling rate read-only.
 *
 * 0xb036 is the Pebble M350s.
 */
export const LOGITECH_BLUETOOTH_PRODUCT_IDS = [0xb036] as const;

const BLUETOOTH_PRODUCT_ID_SET: ReadonlySet<number> = new Set(LOGITECH_BLUETOOTH_PRODUCT_IDS);

export function isBluetoothProduct(productId: number): boolean {
  return BLUETOOTH_PRODUCT_ID_SET.has(productId);
}

export function hidppDeviceIndex(productId: number): number {
  return isDirectConnectProduct(productId) || isBluetoothProduct(productId)
    ? DEVICE_INDEX_DIRECT
    : DEVICE_INDEX_RECEIVER;
}

/** HID++ 2.0 battery states, shared by 0x1000 and 0x1004. */
const BATTERY_STATES = {
  0x00: "Discharging",
  0x01: "Charging",
  0x02: "Almost full",
  0x03: "Full",
  0x04: "Charging slowly",
} as const;

export type HidppBatteryState = (typeof BATTERY_STATES)[keyof typeof BATTERY_STATES] | "Unknown";

export function decodeBatteryState(status: number): HidppBatteryState {
  return BATTERY_STATES[status as keyof typeof BATTERY_STATES] ?? "Unknown";
}

/**
 * Decode Battery Level Status (0x1000), the feature Logitech's AA/AAA-powered
 * mice expose instead of the rechargeable-pack features. The level is a coarse
 * percentage — these mice report a handful of discrete steps, not a continuous
 * reading — and a device that cannot measure at all answers 0.
 */
export function decodeBatteryLevelStatus(level: number, status: number): {
  percent: number | null;
  state: HidppBatteryState;
} {
  return {
    percent: level > 0 && level <= 100 ? level : null,
    state: decodeBatteryState(status),
  };
}

/** HID++ 2.0 error codes, reported in byte 4 of a 0xFF error response. */
const HIDPP_ERRORS: Readonly<Record<number, string>> = {
  0x01: "unknown request",
  0x02: "invalid argument",
  0x03: "value out of range",
  0x04: "hardware error",
  0x05: "Logitech internal error",
  0x06: "invalid feature index",
  0x07: "invalid function",
  0x08: "device busy",
  0x09: "unsupported",
};

export function hidppErrorMessage(code: number): string {
  const reason = HIDPP_ERRORS[code];
  return reason
    ? `The mouse rejected that setting (${reason}).`
    : `The mouse rejected that setting (HID++ error 0x${code.toString(16).padStart(2, "0")}).`;
}

/**
 * Decode the legacy Report Rate (0x8060) supported-rate bitmap, where bit i
 * marks an interval of (i + 1) ms. The G402 generation reports 0x8b, meaning
 * 1, 2, 4 and 8 ms — 1000, 500, 250 and 125 Hz.
 */
export function decodeReportRateBitmap(bitflags: number): number[] {
  const rates: number[] = [];
  for (let bit = 0; bit < 8; bit += 1) {
    if ((bitflags & (1 << bit)) !== 0) rates.push(Math.round(1000 / (bit + 1)));
  }
  return rates.sort((left, right) => left - right);
}

/**
 * The G402's real sensor grid, used only when the mouse answers the legacy
 * DPI-list request with nothing usable. Hardware advertises 252 to 4032 in
 * steps of 84 — not the 240/80 quoted by vendor software, which rounds these
 * to marketing numbers (2436 is displayed as 2400). Every value is still
 * confirmed by the read-back after a write.
 */
export function legacyDpiFallback(): number[] {
  return Array.from({ length: 46 }, (_, step) => 252 + step * 84);
}
