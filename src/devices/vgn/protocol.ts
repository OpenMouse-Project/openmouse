export const VGN_REPORT_ID = 0x08;
export const VGN_PAYLOAD_LENGTH = 16;
export const VGN_MAX_CHUNK = 10;

export const VGN_COMMAND = {
  handshake: 0x01,
  online: 0x03,
  battery: 0x04,
  write: 0x07,
  read: 0x08,
  profile: 0x0e,
  firmware: 0x12,
  dongleFirmware: 0x1d,
} as const;

export const VGN_ADDRESS = {
  pollingRate: 0x00,
  dpiStageCount: 0x02,
  activeDpiStage: 0x04,
  lod: 0x0a,
  dpiStages: 0x0c,
  debounce: 0xa9,
  motionSync: 0xab,
  sleep: 0xad,
  angleSnapping: 0xaf,
  rippleControl: 0xb1,
  performanceMode: 0xb5,
} as const;

export interface VgnBattery {
  percent: number;
  charging: boolean;
  voltageMv: number;
}

export interface VgnProfile {
  dpi: number;
  dpiStageCount: number;
  activeDpiStage: number;
  pollingRateHz: number;
  liftOffDistance: "Low" | "Medium" | "High" | null;
  debounceMs: number | null;
  sleepTimeout: number | null;
  motionSync: boolean | null;
  angleSnapping: boolean | null;
  rippleControl: boolean | null;
  performanceMode: boolean | null;
}

function assertByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label} must be one byte.`);
  }
}

export function vgnReportChecksum(data15: Iterable<number>): number {
  let sum = VGN_REPORT_ID;
  for (const byte of data15) sum += byte & 0xff;
  return (0x55 - (sum & 0xff)) & 0xff;
}

export function vgnReportChecksumIsValid(payload: Uint8Array | readonly number[]): boolean {
  if (payload.length !== VGN_PAYLOAD_LENGTH) return false;
  return ((VGN_REPORT_ID + [...payload].reduce((sum, byte) => sum + (byte & 0xff), 0)) & 0xff) === 0x55;
}

function finalize(payload: Uint8Array): Uint8Array {
  payload[15] = vgnReportChecksum(payload.subarray(0, 15));
  return payload;
}

export function vgnBuildSimplePayload(command: number): Uint8Array {
  assertByte(command, "VGN command");
  const payload = new Uint8Array(VGN_PAYLOAD_LENGTH);
  payload[0] = command;
  return finalize(payload);
}

export function vgnBuildReadPayload(address: number, length: number): Uint8Array {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new Error("VGN address is out of range.");
  if (!Number.isInteger(length) || length < 1 || length > VGN_MAX_CHUNK) throw new Error("VGN read length must be 1–10 bytes.");
  const payload = vgnBuildSimplePayload(VGN_COMMAND.read);
  payload[2] = address >> 8;
  payload[3] = address & 0xff;
  payload[4] = length;
  return finalize(payload);
}

export function vgnBuildWritePayload(address: number, data: readonly number[]): Uint8Array {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new Error("VGN address is out of range.");
  if (data.length < 1 || data.length > VGN_MAX_CHUNK) throw new Error("VGN write length must be 1–10 bytes.");
  const payload = vgnBuildSimplePayload(VGN_COMMAND.write);
  payload[2] = address >> 8;
  payload[3] = address & 0xff;
  payload[4] = data.length;
  payload.set(data.map((byte) => byte & 0xff), 5);
  return finalize(payload);
}

export function vgnBuildWriteScalarPayload(address: number, value: number): Uint8Array {
  assertByte(value, "VGN scalar");
  return vgnBuildWritePayload(address, [value, (0x55 - value) & 0xff]);
}

export function vgnParseReadResponse(response: Uint8Array, address: number, length: number): Uint8Array | null {
  if (!vgnReportChecksumIsValid(response)) return null;
  if (response[0] !== VGN_COMMAND.read || response[1] !== 0) return null;
  if (response[2] !== ((address >> 8) & 0xff) || response[3] !== (address & 0xff)) return null;
  if (response[4] !== length || response.length < 5 + length) return null;
  return response.slice(5, 5 + length);
}

export function vgnParseBattery(response: Uint8Array): VgnBattery | null {
  if (!vgnReportChecksumIsValid(response) || response[0] !== VGN_COMMAND.battery || response[1] !== 0) return null;
  const percent = response[5];
  if (percent === undefined || percent > 100) return null;
  return {
    percent,
    charging: response[6] === 1,
    voltageMv: ((response[7] ?? 0) << 8) | (response[8] ?? 0),
  };
}

export function vgnEncodePollingRate(rate: number): number {
  const raw: Record<number, number> = { 125: 8, 250: 4, 500: 2, 1000: 1, 2000: 16, 4000: 32, 8000: 64 };
  const value = raw[rate];
  if (value === undefined) throw new Error("VGN polling rate must be 125, 250, 500, 1000, 2000, 4000, or 8000 Hz.");
  return value;
}

export function vgnDecodePollingRate(raw: number): number | null {
  return ({ 8: 125, 4: 250, 2: 500, 1: 1000, 16: 2000, 32: 4000, 64: 8000 } as Record<number, number>)[raw] ?? null;
}

export function vgnEncodeDpi(dpi: number): Uint8Array {
  if (!Number.isInteger(dpi) || dpi < 50 || dpi > 26000 || dpi % 50 !== 0) {
    throw new Error("VGN DPI must be 50–26,000 in 50 DPI steps.");
  }
  const encoded = dpi / 50 - 1;
  const low = encoded & 0xff;
  const high = (encoded >> 8) & 0x03;
  const flags = (high << 2) | (high << 6);
  return new Uint8Array([low, low, flags, (0x55 - low - low - flags) & 0xff]);
}

export function vgnDecodeDpi(stage: Uint8Array | readonly number[]): number | null {
  if (stage.length < 4) return null;
  const low = stage[0]! & 0xff;
  const duplicate = stage[1]! & 0xff;
  const flags = stage[2]! & 0xff;
  const checksum = stage[3]! & 0xff;
  if (low !== duplicate || ((low + duplicate + flags + checksum) & 0xff) !== 0x55) return null;
  return ((((flags >> 2) & 0x03) << 8) + low + 1) * 50;
}

export function vgnUnpackScalar(value: number, parity: number): number | null {
  return ((value + parity) & 0xff) === 0x55 ? value : null;
}

export function vgnDecodeProfile(profile: Uint8Array): VgnProfile {
  const scalar = (address: number): number | null => profile.length > address + 1
    ? vgnUnpackScalar(profile[address]!, profile[address + 1]!)
    : null;
  const stageCount = Math.min(Math.max(scalar(VGN_ADDRESS.dpiStageCount) ?? 1, 1), 8);
  const activeStage = Math.min(Math.max(scalar(VGN_ADDRESS.activeDpiStage) ?? 0, 0), stageCount - 1);
  const stageOffset = VGN_ADDRESS.dpiStages + activeStage * 4;
  const dpi = vgnDecodeDpi(profile.subarray(stageOffset, stageOffset + 4)) ?? 800;
  const lodRaw = scalar(VGN_ADDRESS.lod);
  const pollingRaw = scalar(VGN_ADDRESS.pollingRate);
  const boolean = (address: number): boolean | null => {
    const value = scalar(address);
    return value === null ? null : value !== 0;
  };

  return {
    dpi,
    dpiStageCount: stageCount,
    activeDpiStage: activeStage,
    pollingRateHz: pollingRaw === null ? 1000 : (vgnDecodePollingRate(pollingRaw) ?? 1000),
    liftOffDistance: lodRaw === 3 ? "Low" : lodRaw === 1 ? "Medium" : lodRaw === 2 ? "High" : null,
    debounceMs: scalar(VGN_ADDRESS.debounce),
    sleepTimeout: (scalar(VGN_ADDRESS.sleep) ?? 0) * 10 || null,
    motionSync: boolean(VGN_ADDRESS.motionSync),
    angleSnapping: boolean(VGN_ADDRESS.angleSnapping),
    rippleControl: boolean(VGN_ADDRESS.rippleControl),
    performanceMode: boolean(VGN_ADDRESS.performanceMode),
  };
}
