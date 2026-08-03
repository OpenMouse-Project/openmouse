export const LOGITECH_VENDOR_ID = 0x046d;

export interface LogitechDeviceProfile {
  deviceIndex: number;
  reportRateConnectionType: 0 | 1;
  connectionType: "Wired" | "Wireless";
  confirmPollingRateByReadback: boolean;
}

// Direct USB HID++ traffic for the Superlight 2 uses index 0xff. Receiver
// traffic addresses the paired mouse in slot 0x01.
export const LOGITECH_DEVICE_PROFILES: ReadonlyMap<number, LogitechDeviceProfile> = new Map([
  [0xc09b, { deviceIndex: 0xff, reportRateConnectionType: 0, connectionType: "Wired", confirmPollingRateByReadback: true }],
  [0xc54d, { deviceIndex: 0x01, reportRateConnectionType: 1, connectionType: "Wireless", confirmPollingRateByReadback: true }],
  [0xc539, { deviceIndex: 0x01, reportRateConnectionType: 1, connectionType: "Wireless", confirmPollingRateByReadback: false }],
  [0xc0a8, { deviceIndex: 0x01, reportRateConnectionType: 0, connectionType: "Wired", confirmPollingRateByReadback: false }],
]);

export function logitechDeviceProfile(vendorId: number, productId: number): LogitechDeviceProfile | null {
  if (vendorId !== LOGITECH_VENDOR_ID) return null;
  return LOGITECH_DEVICE_PROFILES.get(productId) ?? null;
}

export type LogitechLiftOffDistance = "Low" | "Medium" | "High";

/** HID++ 0x2202 reserves 0 for unsupported, followed by Low/Medium/High. */
export function encodeLiftOffDistance(value: LogitechLiftOffDistance): number {
  return ({ Low: 1, Medium: 2, High: 3 } as const)[value];
}

export function decodeLiftOffDistance(value: number): LogitechLiftOffDistance | null {
  return ({ 1: "Low", 2: "Medium", 3: "High" } as const)[value as 1 | 2 | 3] ?? null;
}
