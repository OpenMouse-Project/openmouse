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

/**
 * Whether this HID++ endpoint is the mouse itself rather than a receiver.
 * Runtime probing is authoritative for unknown Logitech product IDs; the PID
 * list is only the pre-probe fast path.
 */
export function isDirectConnection(productId: number, resolvedDeviceIndex: number | null): boolean {
  return resolvedDeviceIndex === DEVICE_INDEX_DIRECT
    || (resolvedDeviceIndex === null && isDirectConnectProduct(productId));
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
  // Not in the HID++ 2.0 enum, which stops at 0x09. Older firmware answers a
  // 2.0-shaped error with the 1.0 code REQUEST_UNAVAILABLE, which a G102
  // returns when asked for something its current mode does not allow.
  0x0a: "the mouse will not accept that request in its current mode",
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

export type BatteryChargeState =
  | "Charging" | "Charging slowly" | "Almost full" | "Full" | "Discharging" | "Unknown";

/**
 * 0x1004 UNIFIED_BATTERY chargingStatus.
 *
 * Deliberately separate from the 0x1000 mapping below: the two features number
 * their states differently, and decoding one with the other's table reports a
 * slow charge as "almost full".
 */
export function decodeUnifiedBatteryState(chargingStatus: number): BatteryChargeState {
  switch (chargingStatus) {
    case 0x00: return "Discharging";
    case 0x01: return "Charging";
    case 0x02: return "Charging slowly";
    case 0x03: return "Full";
    // 4 is a charging fault. There is no state for it, and calling it charging
    // would be worse than admitting we do not know.
    default: return "Unknown";
  }
}

/** 0x1000 BATTERY_LEVEL_STATUS batteryStatus. */
export function decodeBatteryLevelState(batteryStatus: number): BatteryChargeState {
  switch (batteryStatus) {
    case 0x00: return "Discharging";
    case 0x01: return "Charging";
    case 0x02: return "Almost full";
    case 0x03: return "Full";
    case 0x04: return "Charging slowly";
    // 5 invalid battery, 6 thermal error, 7 other charging error.
    default: return "Unknown";
  }
}

/**
 * The mouse keeps its settings in onboard memory and will not hand control to
 * software, so the only way to change anything is to write its profile — which
 * needs a decoded layout for that profile format.
 *
 * Its own type because it is not a fault: it is a mouse that cannot be
 * supported yet, and the way forward is a capture from whoever owns one.
 */
export class OnboardOnlyError extends Error {
  readonly profileFormatId: number | null;

  constructor(profileFormatId: number | null) {
    super(
      "This mouse keeps its settings in onboard memory and will not hand control to software. "
      + `Writing ${profileFormatId === null ? "its profile format" : `profile format ${profileFormatId}`} `
      + 'is not supported yet. Open Diagnostics, then HID++ capture, and use "Copy verification data" — '
      + "sending that is what lets the layout be added.",
    );
    this.name = "OnboardOnlyError";
    this.profileFormatId = profileFormatId;
  }
}
