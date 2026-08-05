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
 * settings in an onboard profile.
 *
 * - 0xc07e — G402 / G402 Hyperion Fury (wired)
 * - 0xc08f — G403 HERO (wired)
 *
 * This module deliberately imports nothing, so both the driver and the WebHID
 * filters in ../vendors can read it without a cycle.
 */
export const LOGITECH_DIRECT_PRODUCT_IDS = [0xc07e, 0xc08f] as const;

const DIRECT_PRODUCT_ID_SET: ReadonlySet<number> = new Set(LOGITECH_DIRECT_PRODUCT_IDS);

export function isDirectConnectProduct(productId: number): boolean {
  return DIRECT_PRODUCT_ID_SET.has(productId);
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
 * Sensor grids for direct-connect mice, used only when one answers the legacy
 * DPI-list request with nothing usable. Every value is still confirmed by the
 * read-back after a write, so a wrong entry surfaces as a rejected change
 * rather than a silently wrong setting.
 */
const LEGACY_DPI_GRIDS: ReadonlyMap<number, { min: number; step: number; max: number }> = new Map([
  // G402: hardware advertises 252 to 4032 in steps of 84 — not the 240/80
  // quoted by vendor software, which rounds these to marketing numbers (2436
  // is displayed as "2400"). Captured from a getSensorDpiList reply of
  // 00 FC | E0 54 | 0F C0.
  [0xc07e, { min: 252, step: 84, max: 4032 }],
  // G403 HERO: the HERO sensor's documented 100-25,600 range in steps of 50.
  [0xc08f, { min: 100, step: 50, max: 25600 }],
]);

export function legacyDpiFallback(productId: number): number[] {
  const grid = LEGACY_DPI_GRIDS.get(productId);
  if (!grid) return [];
  const options: number[] = [];
  for (let dpi = grid.min; dpi <= grid.max; dpi += grid.step) options.push(dpi);
  return options;
}
