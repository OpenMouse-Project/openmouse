import type { MouseStatus } from "./mouse-types";

export type EggButtonActionKey =
  | "mouse-left" | "mouse-right" | "mouse-middle" | "mouse-back" | "mouse-forward"
  | "scroll-up" | "scroll-down" | "keyboard" | "cpi-loop" | "fixed-cpi"
  | "media-play" | "media-next" | "media-previous" | "media-mute" | "media-volume-up"
  | "media-volume-down" | "browser-home" | "file-explorer" | "disabled" | "raw";

export interface EggButtonAction {
  key: EggButtonActionKey;
  modifiers?: number;
  usage?: number;
  x?: number;
  y?: number;
  rawType?: number;
  rawParams?: number[];
}

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
  eggButtonActions: EggButtonAction[];
  eggLeftHanded: boolean;
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
  handedButton: 71,
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

export const EGG_BUTTON_ACTION_OPTIONS = [
  { group: "Mouse", key: "mouse-left", label: "Left Click" },
  { group: "Mouse", key: "mouse-right", label: "Right Click" },
  { group: "Mouse", key: "mouse-middle", label: "Middle Click" },
  { group: "Mouse", key: "mouse-back", label: "Back" },
  { group: "Mouse", key: "mouse-forward", label: "Forward" },
  { group: "Scroll", key: "scroll-up", label: "Wheel Up" },
  { group: "Scroll", key: "scroll-down", label: "Wheel Down" },
  { group: "Keyboard", key: "keyboard", label: "Keyboard shortcut" },
  { group: "CPI", key: "cpi-loop", label: "CPI Loop" },
  { group: "CPI", key: "fixed-cpi", label: "Fixed CPI" },
  { group: "Media", key: "media-play", label: "Play / Pause" },
  { group: "Media", key: "media-next", label: "Next Track" },
  { group: "Media", key: "media-previous", label: "Previous Track" },
  { group: "Media", key: "media-mute", label: "Mute" },
  { group: "Media", key: "media-volume-up", label: "Volume Up" },
  { group: "Media", key: "media-volume-down", label: "Volume Down" },
  { group: "System", key: "browser-home", label: "Browser Home" },
  { group: "System", key: "file-explorer", label: "File Explorer" },
  { group: "Other", key: "disabled", label: "Disabled" },
] as const;

export interface EggEncodedButtonAction {
  type: number;
  params: [number, number, number, number, number];
}

export function eggDecodeButtonAction(type: number, params: readonly number[]): EggButtonAction {
  const p = (index: number): number => params[index] ?? 0;
  if (type === 0x00) {
    const key = ({
      0x01: "mouse-left",
      0x02: "mouse-right",
      0x04: "mouse-middle",
      0x08: "mouse-back",
      0x10: "mouse-forward",
    } as const)[p(0) as 0x01 | 0x02 | 0x04 | 0x08 | 0x10];
    if (key) return { key };
  }
  if (type === 0x01 && p(0) === 0x01) return { key: "scroll-up" };
  if (type === 0x01 && p(0) === 0xff) return { key: "scroll-down" };
  if (type === 0x02) return { key: "keyboard", modifiers: p(0) & 0x0f, usage: p(1) };
  if (type === 0x09) return { key: "cpi-loop" };
  if (type === 0x0c) {
    return { key: "fixed-cpi", x: p(1) | (p(2) << 8), y: p(3) | (p(4) << 8) };
  }
  if (type === 0x18 && p(0) === 0x96) return { key: "browser-home" };
  if (type === 0x18 && p(0) === 0x94) return { key: "file-explorer" };
  const media = ({
    0xcd: "media-play",
    0xb5: "media-next",
    0xb6: "media-previous",
    0xe2: "media-mute",
    0xe9: "media-volume-up",
    0xea: "media-volume-down",
  } as const)[p(0) as 0xcd | 0xb5 | 0xb6 | 0xe2 | 0xe9 | 0xea];
  if (type === 0x20 && media) return { key: media };
  if (type === 0xff) return { key: "disabled" };
  return { key: "raw", rawType: type, rawParams: Array.from({ length: 5 }, (_, index) => p(index)) };
}

export function eggEncodeButtonAction(action: EggButtonAction): EggEncodedButtonAction | null {
  const params = (...values: number[]): [number, number, number, number, number] => {
    const result: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    values.slice(0, 5).forEach((value, index) => { result[index] = value & 0xff; });
    return result;
  };
  switch (action.key) {
    case "mouse-left": return { type: 0x00, params: params(0x01) };
    case "mouse-right": return { type: 0x00, params: params(0x02) };
    case "mouse-middle": return { type: 0x00, params: params(0x04) };
    case "mouse-back": return { type: 0x00, params: params(0x08) };
    case "mouse-forward": return { type: 0x00, params: params(0x10) };
    case "scroll-up": return { type: 0x01, params: params(0x01) };
    case "scroll-down": return { type: 0x01, params: params(0xff) };
    case "keyboard": return { type: 0x02, params: params(action.modifiers ?? 0, action.usage ?? 0) };
    case "cpi-loop": return { type: 0x09, params: params(0xf1) };
    case "fixed-cpi": {
      const x = action.x ?? 1600;
      const y = action.y ?? x;
      return { type: 0x0c, params: params(0, x, x >> 8, y, y >> 8) };
    }
    case "browser-home": return { type: 0x18, params: params(0x96) };
    case "file-explorer": return { type: 0x18, params: params(0x94) };
    case "media-play": return { type: 0x20, params: params(0xcd) };
    case "media-next": return { type: 0x20, params: params(0xb5) };
    case "media-previous": return { type: 0x20, params: params(0xb6) };
    case "media-mute": return { type: 0x20, params: params(0xe2) };
    case "media-volume-up": return { type: 0x20, params: params(0xe9) };
    case "media-volume-down": return { type: 0x20, params: params(0xea) };
    case "disabled": return { type: 0xff, params: params() };
    case "raw": return null;
  }
}

export function eggButtonActionLabel(action: EggButtonAction): string {
  if (action.key === "raw") return "Custom (preserved)";
  if (action.key === "keyboard") {
    const modifiers = [
      [0x01, "Ctrl"], [0x02, "Shift"], [0x04, "Alt"], [0x08, "Win"],
    ] as const;
    const parts: string[] = modifiers.filter(([mask]) => (action.modifiers ?? 0) & mask).map(([, label]) => label);
    parts.push(action.usage ? `HID 0x${action.usage.toString(16).padStart(2, "0")}` : "Unassigned");
    return parts.join(" + ");
  }
  if (action.key === "fixed-cpi") {
    return action.x === action.y ? `CPI ${action.x}` : `X ${action.x} / Y ${action.y}`;
  }
  return EGG_BUTTON_ACTION_OPTIONS.find((option) => option.key === action.key)?.label ?? action.key;
}

export function eggIsPlainLeftAction(bytes: readonly number[]): boolean {
  return bytes[0] === 0x00 && bytes[1] === 0x01 && !bytes.slice(2, 6).some(Boolean);
}

const BUTTON_CONTROL_INDEX = [0, 1, 2, 3, 4, null, null] as const;
const BUTTON_MAPPING_INDEX = [null, 0, 1, 2, 3, 5, 6] as const;

export function eggButtonControlOffset(button: number): number | null {
  const index = BUTTON_CONTROL_INDEX[button];
  return index === null || index === undefined ? null : EGG_OFFSET.firstButton + index * 7;
}

export function eggButtonMappingOffset(button: number, leftHanded: boolean): number | null {
  if (button === 0) return leftHanded ? EGG_OFFSET.handedButton : null;
  if (button === 1 && leftHanded) return null;
  const index = BUTTON_MAPPING_INDEX[button];
  return index === null || index === undefined ? null : EGG_OFFSET.firstButton + index * 7 + 1;
}
