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
  readVersionId: 0x12,
} as const;

export const LAMZU_FLASH = {
  pollRate: 0,
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
const LAMZU_POLL_RATE_MAP: ReadonlyArray<readonly [number, number]> = [
  [1000, 1],
  [500, 2],
  [250, 4],
  [125, 8],
  [2000, 16],
  [4000, 32],
  [8000, 64],
];

/**
 * Aurora / newer Compx receivers (e.g. Maya dongle PID 0xfa09) use a shifted
 * high-rate encoding (2000→32, 4000→64, 8000→128). Aurora also treats wire
 * value 16 as an alias for 1000 Hz when reading.
 */
const LAMZU_AURORA_POLL_RATE_MAP: ReadonlyArray<readonly [number, number]> = [
  [1000, 1],
  [500, 2],
  [250, 4],
  [125, 8],
  [2000, 32],
  [4000, 64],
  [8000, 128],
];

export const LAMZU_AURORA_FEATURE_BYTES = 64;
export const LAMZU_AURORA_STATUS_OK = 0xa1;

/** Aurora feature-report command nibbles (bytes [2..5] of the 64-byte buffer). */
export const LAMZU_AURORA_CMD = {
  setPolling: [2, 2, 1, 0] as const,
  getPolling: [2, 2, 1, 128] as const,
  setLod: [2, 2, 1, 8] as const,
  getLod: [2, 2, 1, 136] as const,
  setSleep: [2, 3, 0, 7] as const,
  getSleep: [2, 3, 0, 135] as const,
  setAngleTune: [2, 2, 1, 20] as const,
  getAngleTune: [2, 2, 1, 148] as const,
  setMotionSync: [2, 2, 1, 9] as const,
  getMotionSync: [2, 2, 1, 137] as const,
  setAngleSnap: [2, 2, 1, 4] as const,
  getAngleSnap: [2, 2, 1, 132] as const,
  setRipple: [2, 2, 1, 10] as const,
  getRipple: [2, 2, 1, 138] as const,
  setDebounce: [2, 2, 0, 8] as const,
  getDebounce: [2, 2, 0, 136] as const,
  getActiveDpi: [2, 2, 1, 130] as const,
  setActiveDpi: [2, 2, 1, 2] as const,
  getDpiStages: [2, 10, 1, 129] as const,
  setDpiStages: [2, 26, 1, 1] as const,
  getFirmware: [2, 16, 0, 129] as const,
  /** Battery percent (+ charging flag). Byte 4 stays 0 in the official Aurora driver. */
  getBattery: [2, 2, 0, 131] as const,
  /** Active onboard profile index (0-based). */
  getProfile: [2, 1, 0, 133] as const,
} as const;

export const LAMZU_AURORA_COMMON_DELAY_MS = 20;

export const LAMZU_DPI_MIN = 50;
export const LAMZU_DPI_MAX = 26_000;
export const LAMZU_DPI_STEP = 50;
export const LAMZU_CLASSIC_DPI_MAX = 12_800;
export const LAMZU_MAX_RESOLUTION_STAGES = 8;

export const LAMZU_BATTERY_MIN_MV = 3050;
export const LAMZU_BATTERY_MAX_MV = 4200;

/**
 * Packet checksum over report ID + 15 payload bytes (byte 15 is the checksum).
 * Official Compx driver: `t[15] = get_Crc(t) - reportID` with get_Crc = 0x55 - sum(t[0..14]).
 * Some receivers use report ID 0x13 instead of 0x08 — pass the live report ID.
 */
export function lamzuPacketChecksum(
  packetWithoutReportId: Uint8Array,
  reportId: number = LAMZU_REPORT_ID,
): number {
  let sum = 171 + (reportId & 0xff);
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

export function encodeLamzuAuroraPollingRate(hz: number): number | null {
  return LAMZU_AURORA_POLL_RATE_MAP.find(([rate]) => rate === hz)?.[1] ?? null;
}

export function decodeLamzuAuroraPollingRate(encoded: number): number | null {
  const normalized = encoded === 16 ? 1 : encoded;
  return LAMZU_AURORA_POLL_RATE_MAP.find(([, raw]) => raw === normalized)?.[0]
    ?? decodeLamzuPollingRate(encoded);
}

export function auroraStatusIndex(hidIndex: number): number {
  return 1 - hidIndex;
}

export function auroraValueIndex(hidIndex: number, isNewProtocol: boolean): number {
  return (isNewProtocol ? 8 : 7) - hidIndex;
}

/**
 * Aurora active-DPI stage from the device is 1-based (lamzu.net
 * `setActiveDPIValue` writes at `8 + (stage - 1) * 4`).
 */
export function auroraStageSlotIndex(stageRaw: number, stageCount: number): number {
  if (stageCount <= 0) return 0;
  const oneBased = stageRaw >= 1 ? stageRaw : 1;
  return Math.min(Math.max(oneBased - 1, 0), stageCount - 1);
}

export function createAuroraCommand(
  cmd: readonly [number, number, number, number],
  options: { profile?: number; value?: number; isNewProtocol?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(LAMZU_AURORA_FEATURE_BYTES);
  packet[2] = cmd[0];
  packet[3] = cmd[1];
  packet[4] = cmd[2];
  packet[5] = cmd[3];
  const profile = options.profile ?? 0;
  const value = options.value;
  if (options.isNewProtocol) {
    packet[6] = profile;
    if (value !== undefined) packet[7] = value;
  } else if (value !== undefined) {
    packet[6] = value;
  } else {
    packet[6] = profile;
  }
  return packet;
}

function encodeLamzuDpiAxis(dpi: number): number | null {
  if (!Number.isInteger(dpi) || dpi < LAMZU_DPI_MIN || dpi > LAMZU_CLASSIC_DPI_MAX || dpi % LAMZU_DPI_STEP !== 0) {
    return null;
  }
  return dpi / LAMZU_DPI_STEP - 1;
}

function decodeLamzuDpiAxis(raw: number): number {
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

/** Classic Compx LOD is 1 mm / 2 mm only. */
export function encodeLamzuLod(lod: "Medium" | "High"): number {
  return lod === "Medium" ? 1 : 2;
}

export function decodeLamzuLod(raw: number): "Medium" | "High" | null {
  if (raw === 1) return "Medium";
  if (raw === 2) return "High";
  return null;
}

/**
 * Aurora / Maya X LOD wire values (lamzu.net setLOD):
 * - 0.7 mm → `(0.7 * 10) | 0x80` = 135
 * - 1 mm → 1
 * - 2 mm → 2
 */
export function encodeLamzuAuroraLod(lod: "Low" | "Medium" | "High"): number {
  if (lod === "Low") return (7) | 0x80;
  if (lod === "Medium") return 1;
  return 2;
}

export function decodeLamzuAuroraLod(raw: number): "Low" | "Medium" | "High" | null {
  if ((raw & 0x80) !== 0 && (raw & 0x7f) === 7) return "Low";
  if (raw === 1) return "Medium";
  if (raw === 2) return "High";
  return null;
}

/** Official Maya X sleep timeouts in seconds. */
export const LAMZU_AURORA_SLEEP_SECONDS: readonly number[] = [10, 30, 60, 300, 600, 1800];

/** Angle tune: positive as-is; negative as `255 - abs(r) + 1` (lamzu.net). */
export function encodeLamzuAuroraAngleTune(degrees: number): number | null {
  if (!Number.isInteger(degrees) || degrees < -30 || degrees > 30) return null;
  if (degrees > 0) return degrees;
  if (degrees === 0) return 0;
  return (255 - Math.abs(degrees) + 1) & 0xff;
}

export function decodeLamzuAuroraAngleTune(raw: number): number {
  if (raw <= 30) return raw;
  return raw - 256;
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

/**
 * Aurora getBattery response: `[chargingFlag, percent]`.
 * Layout shifts by one byte when the stack prefixes a report-ID / hidIndex.
 */
export function parseAuroraBattery(
  response: Uint8Array,
): { charging: boolean; percent: number } | null {
  const ok = LAMZU_AURORA_STATUS_OK;
  if (response[1] === ok && response[4] === 2 && response[6] === 131) {
    return { charging: (response[7] ?? 0) === 1, percent: response[8] ?? 0 };
  }
  if (response[0] === ok && response[3] === 2 && response[5] === 131) {
    return { charging: (response[6] ?? 0) === 1, percent: response[7] ?? 0 };
  }
  return null;
}

export function createLamzuPacket(command: number): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(LAMZU_PACKET_LENGTH);
  packet[0] = command;
  return packet;
}

export function finalizeLamzuPacket(
  packet: Uint8Array,
  reportId: number = LAMZU_REPORT_ID,
): void {
  packet[LAMZU_PACKET_LENGTH - 1] = lamzuPacketChecksum(packet, reportId);
}

export function dpiOptionsForLamzu(): number[] {
  const options: number[] = [];
  for (let dpi = LAMZU_DPI_MIN; dpi <= LAMZU_DPI_MAX; dpi += LAMZU_DPI_STEP) {
    options.push(dpi);
  }
  return options;
}
