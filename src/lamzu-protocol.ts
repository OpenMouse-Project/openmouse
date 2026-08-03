/**
 * Compx / Lamzu flash protocol helpers (report ID 8).
 *
 * Reverse-engineered from the same ODM path used by Lamzu Atlantis / Maya
 * (VID 0x3554). Packet layout matches Pulsar report 8; checksum is identical
 * once the report ID is included. DPI uses a simpler 50-CPI encoding.
 */

export const LAMZU_REPORT_ID = 0x08;
export const LAMZU_PACKET_LENGTH = 16;

export const LAMZU_COMMAND = {
  batteryVoltage: 0x04,
  writeFlash: 0x07,
  readFlash: 0x08,
  readActiveProfile: 0x0e,
  writeActiveProfile: 0x0f,
  readVersionId: 0x12,
} as const;

export const LAMZU_FLASH = {
  pollRate: 0,
  resolutionCount: 2,
  resolutionIndex: 4,
  liftOffDistance: 10,
  resolutions: 12,
  debounceMs: 169,
  motionSync: 171,
  sleepTime: 173,
  angleSnapping: 175,
  rippleControl: 177,
  peakPerformance: 181,
  peakPerformanceTime: 183,
} as const;

/** Polling-rate wire values used by Compx / Lamzu Maya receivers. */
export const LAMZU_POLL_RATE_MAP: ReadonlyArray<readonly [number, number]> = [
  [1000, 1],
  [500, 2],
  [250, 4],
  [125, 8],
  [2000, 16],
  [4000, 32],
  [8000, 64],
];

export const LAMZU_DPI_MIN = 50;
export const LAMZU_DPI_MAX = 12_800;
export const LAMZU_DPI_STEP = 50;
export const LAMZU_MAX_RESOLUTION_STAGES = 8;

export const LAMZU_BATTERY_MIN_MV = 3050;
export const LAMZU_BATTERY_MAX_MV = 4200;

/** Packet checksum over report ID + 15 payload bytes (byte 15 is the checksum). */
export function lamzuPacketChecksum(packetWithoutReportId: Uint8Array): number {
  let sum = 171 + LAMZU_REPORT_ID;
  for (let index = 0; index < LAMZU_PACKET_LENGTH - 1; index += 1) {
    sum = (sum + (packetWithoutReportId[index] ?? 0)) & 0xff;
  }
  return (0 - sum) & 0xff;
}

/** Data checksum appended after a flash value (same as Pulsar writeCheckedByte). */
export function lamzuDataChecksum(data: Uint8Array): number {
  let sum = 171;
  for (const value of data) sum = (sum + value) & 0xff;
  return (0 - sum) & 0xff;
}

export function encodeLamzuPollingRate(hz: number): number | null {
  return LAMZU_POLL_RATE_MAP.find(([rate]) => rate === hz)?.[1] ?? null;
}

export function decodeLamzuPollingRate(encoded: number): number | null {
  return LAMZU_POLL_RATE_MAP.find(([, raw]) => raw === encoded)?.[0] ?? null;
}

export function encodeLamzuDpiAxis(dpi: number): number | null {
  if (!Number.isInteger(dpi) || dpi < LAMZU_DPI_MIN || dpi > LAMZU_DPI_MAX || dpi % LAMZU_DPI_STEP !== 0) {
    return null;
  }
  return dpi / LAMZU_DPI_STEP - 1;
}

export function decodeLamzuDpiAxis(raw: number): number {
  return (raw + 1) * LAMZU_DPI_STEP;
}

/** Encode matching X/Y DPI into the 3-byte flash slot (+ caller adds checksum). */
export function encodeLamzuDpi(dpi: number): Uint8Array | null {
  const axis = encodeLamzuDpiAxis(dpi);
  if (axis === null) return null;
  return new Uint8Array([axis, axis, 0]);
}

export function decodeLamzuDpi(data: Uint8Array): number {
  return decodeLamzuDpiAxis(data[0] ?? 0);
}

/** Lamzu LOD is 1 mm / 2 mm only (no 0.7 mm). */
export function encodeLamzuLod(lod: "Medium" | "High"): number {
  return lod === "Medium" ? 1 : 2;
}

export function decodeLamzuLod(raw: number): "Medium" | "High" | null {
  if (raw === 1) return "Medium";
  if (raw === 2) return "High";
  return null;
}

export function batteryPercentFromMillivolts(mv: number): number {
  const range = LAMZU_BATTERY_MAX_MV - LAMZU_BATTERY_MIN_MV;
  const percent = ((mv - LAMZU_BATTERY_MIN_MV) / range) * 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function parseBatteryMillivolts(response: Uint8Array): number | null {
  if (response.length < 9 || response[1] !== 0) return null;
  return ((response[7] ?? 0) << 8) | (response[8] ?? 0);
}

export function createLamzuPacket(command: number): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(LAMZU_PACKET_LENGTH);
  packet[0] = command;
  return packet;
}

export function finalizeLamzuPacket(packet: Uint8Array): void {
  packet[LAMZU_PACKET_LENGTH - 1] = lamzuPacketChecksum(packet);
}

export function dpiOptionsForLamzu(): number[] {
  const options: number[] = [];
  for (let dpi = LAMZU_DPI_MIN; dpi <= LAMZU_DPI_MAX; dpi += LAMZU_DPI_STEP) {
    options.push(dpi);
  }
  return options;
}
