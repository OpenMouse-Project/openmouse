import type { MouseStatus } from "./mouse-types";

export interface EggOp1Status extends MouseStatus {
  eggCpiLevels: number;
  eggCpiStages: Array<{ x: number; y: number }>;
  eggActiveCpiStage: number;
  eggCpiMin: number;
  eggCpiMax: number;
  eggCpiStepLow: number;
  eggCpiStepHigh: number;
  eggPollingDivider: number;
  eggLodIndex: number;
  eggLodOptions: string[];
  eggMulticlickFilters: number[];
  eggButtonMappings: string[];
}

export const EGG_VENDOR_ID = 0x3367;

export type EggSensorFamily = "paw3395" | "paw3950";
export type EggConfigFamily = "v1" | "v2";

export interface EggDeviceProfile {
  pid: number;
  name: string;
  configFamily: EggConfigFamily;
  sensorFamily: EggSensorFamily;
  cpiMin: number;
  cpiMax: number;
  cpiStepLow: number;
  cpiStepHigh: number;
  lodNormal: readonly string[];
  lodGlass: readonly string[] | null;
  motionSyncAt8k: boolean;
}

const LOD_V1 = ["0.7 mm", "1 mm", "2 mm"] as const;
const LOD_V2 = [
  "0.7 mm", "0.8 mm", "0.9 mm", "1.0 mm", "1.1 mm", "1.2 mm",
  "1.3 mm", "1.4 mm", "1.5 mm", "1.6 mm", "1.7 mm",
] as const;
const LOD_GLASS = ["1.0 mm", "2.0 mm"] as const;

export const EGG_DEVICE_PROFILES: ReadonlyMap<number, EggDeviceProfile> = new Map([
  [0x1964, {
    pid: 0x1964,
    name: "Endgame Gear OP1 8K",
    configFamily: "v1",
    sensorFamily: "paw3395",
    cpiMin: 50,
    cpiMax: 26_000,
    cpiStepLow: 50,
    cpiStepHigh: 50,
    lodNormal: LOD_V1,
    lodGlass: null,
    motionSyncAt8k: false,
  }],
  [0x1966, {
    pid: 0x1966,
    name: "Endgame Gear XM2 8K",
    configFamily: "v1",
    sensorFamily: "paw3395",
    cpiMin: 50,
    cpiMax: 26_000,
    cpiStepLow: 50,
    cpiStepHigh: 50,
    lodNormal: LOD_V1,
    lodGlass: null,
    motionSyncAt8k: false,
  }],
  [0x1976, {
    pid: 0x1976,
    name: "Endgame Gear OP1 8K Purple Frost",
    configFamily: "v1",
    sensorFamily: "paw3950",
    cpiMin: 50,
    cpiMax: 30_000,
    cpiStepLow: 50,
    cpiStepHigh: 50,
    lodNormal: LOD_V1,
    lodGlass: LOD_GLASS,
    motionSyncAt8k: true,
  }],
  [0x1978, {
    pid: 0x1978,
    name: "Endgame Gear OP1 8K v2",
    configFamily: "v2",
    sensorFamily: "paw3950",
    cpiMin: 10,
    cpiMax: 30_000,
    cpiStepLow: 10,
    cpiStepHigh: 50,
    lodNormal: LOD_V2,
    lodGlass: LOD_GLASS,
    motionSyncAt8k: true,
  }],
  [0x1980, {
    pid: 0x1980,
    name: "Endgame Gear XM2 8K v2",
    configFamily: "v2",
    sensorFamily: "paw3950",
    cpiMin: 10,
    cpiMax: 30_000,
    cpiStepLow: 10,
    cpiStepHigh: 50,
    lodNormal: LOD_V2,
    lodGlass: LOD_GLASS,
    motionSyncAt8k: true,
  }],
]);

export const EGG_REPORT = {
  config: 0xa0,
  command: 0xa1,
  event: 0x03,
} as const;

export const EGG_OPERATION = {
  firmware: 0x02,
  store: 0x11,
  load: 0x12,
  factoryReset: 0x13,
} as const;

export const EGG_OFFSET = {
  pollingDivider: 21,
  filterFlags: 22,
  ledLiftOff: 24,
  lod: 25,
  angleSnapping: 26,
  rippleControl: 27,
  motionSync: 28,
  activeCpiStage: 29,
  cpiLevels: 30,
  firstCpiSplit: 51,
  firstButton: 77,
  glassMode: 127,
  angleTuning: 128,
  forceMaxFps: 129,
} as const;

export const EGG_CONFIG_SIZE = 1041;
export const EGG_COMMAND_SIZE = 64;
export const EGG_POLLING_RATES = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

export function eggNormalizeFeatureReport(
  raw: Uint8Array,
  reportId: number,
  expectedTotal: number,
  payloadLength: number,
): Uint8Array {
  let includesId: boolean;
  if (payloadLength > 0 && raw.length === payloadLength) includesId = false;
  else if (payloadLength > 0 && raw.length === payloadLength + 1 && raw[0] === reportId) includesId = true;
  else includesId = raw.length > 0 && raw[0] === reportId;
  const result = new Uint8Array(Math.max(expectedTotal, raw.length + (includesId ? 0 : 1)));
  if (includesId) result.set(raw);
  else {
    result[0] = reportId;
    result.set(raw, 1);
  }
  return result;
}

export function eggProfileForPid(pid: number): EggDeviceProfile {
  const profile = EGG_DEVICE_PROFILES.get(pid);
  if (!profile) throw new Error(`Unsupported Endgame Gear product 0x${pid.toString(16)}.`);
  return profile;
}

export function eggCpiStep(profile: EggDeviceProfile, cpi: number): number {
  return profile.configFamily === "v2" && cpi <= 10_000
    ? profile.cpiStepLow
    : profile.cpiStepHigh;
}

export function eggClampCpi(profile: EggDeviceProfile, value: number): number {
  const clamped = Math.max(profile.cpiMin, Math.min(profile.cpiMax, Math.round(value)));
  const step = eggCpiStep(profile, clamped);
  const rounded = Math.floor((clamped + step / 2) / step) * step;
  return Math.max(profile.cpiMin, Math.min(profile.cpiMax, rounded));
}

export function eggIsValidCpi(profile: EggDeviceProfile, value: number): boolean {
  return Number.isInteger(value) && value === eggClampCpi(profile, value);
}

export function eggDpiOptions(profile: EggDeviceProfile): number[] {
  const values: number[] = [];
  for (let cpi = profile.cpiMin; cpi <= profile.cpiMax;) {
    values.push(cpi);
    cpi += eggCpiStep(profile, cpi + 1);
  }
  return values;
}

export function eggLodOptions(profile: EggDeviceProfile, glassMode: boolean): readonly string[] {
  return glassMode && profile.lodGlass ? profile.lodGlass : profile.lodNormal;
}

function decodeBcdByte(value: number): number | null {
  const high = value >> 4;
  const low = value & 0x0f;
  return high <= 9 && low <= 9 ? high * 10 + low : null;
}

/** Firmware stores BCD patch/major bytes, e.g. 37 01 => V1.37. */
export function eggFormatFirmwareVersion(bytes: Uint8Array): string | null {
  for (const offset of [17, 16, 18, 2, 4, 6]) {
    const patch = decodeBcdByte(bytes[offset] ?? 0xff);
    const major = decodeBcdByte(bytes[offset + 1] ?? 0xff);
    if (patch !== null && major !== null && major > 0) {
      return `V${major}.${String(patch).padStart(2, "0")}`;
    }
  }
  return null;
}

export function eggReadUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function eggWriteUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >> 8;
}
