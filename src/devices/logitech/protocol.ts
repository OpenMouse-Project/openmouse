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
 */
export const LOGITECH_DIRECT_PRODUCT_IDS: ReadonlySet<number> = new Set([0xc07e]);

export function isDirectConnectProduct(productId: number): boolean {
  return LOGITECH_DIRECT_PRODUCT_IDS.has(productId);
}

export function hidppDeviceIndex(productId: number): number {
  return isDirectConnectProduct(productId) ? DEVICE_INDEX_DIRECT : DEVICE_INDEX_RECEIVER;
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
 * The G402's documented sensor range, used only when the mouse answers the
 * legacy DPI-list request with nothing usable. Every value is still confirmed
 * by the read-back after a write.
 */
export function legacyDpiFallback(): number[] {
  return Array.from({ length: 48 }, (_, step) => 240 + step * 80);
}
