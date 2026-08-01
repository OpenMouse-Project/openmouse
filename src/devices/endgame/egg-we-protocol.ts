/**
 * Pure Endgame Gear WE-series (OP1we) profile protocol helpers.
 * Used by EggWeHidClient and unit-tested without WebHID.
 *
 * Framing: feature report id 0x08, 16-byte payload, full report sum == 0x55.
 * ReadEEPROM cmd 0x08 / WriteEEPROM cmd 0x07 — body [0, hi, lo, len, data…].
 */

export const WE_REPORT_ID = 0x08;
export const WE_PAYLOAD_LEN = 16;
export const WE_CHECKSUM_TARGET = 0x55;
export const WE_CMD_GET_POWER = 0x04;
export const WE_CMD_READ_EEPROM = 0x08;
export const WE_CMD_WRITE_EEPROM = 0x07;
export const WE_CMD_GET_CONNECT = 0x03;
export const WE_CMD_GET_CUR_PROFILE = 0x0e;
export const WE_MAX_EEPROM_CHUNK = 8;

/** Profile map (NOTES.md / OEM GetProfile logs). */
export const WE_OFF = {
  /**
   * Header value+crc pairs (live dump: 01 54 | 04 51 | 01 54 | … | 02 53).
   * Report-rate was briefly mis-mapped to 0x04, which is DEFLEVEL — writing “Hz”
   * changed the active CPI stage. Correct map:
   */
  /** Report-rate divider: 8→125, 4→250, 2→500, 1→1000 Hz (OEM max 1000). */
  reportRate: 0x00,
  dpiStageCount: 0x02, // DM
  activeDpiLevel: 0x04, // DEFLEVEL — which CPI stage is active (not report rate!)
  lod: 0x0a, // 1=Medium, 2=High
  dpiStages: 0x0c, // 8 × 4-byte stages
  dpiStageBytes: 4,
  maxDpiStages: 8,
  debounce: 0xa9, // ms
  sleep: 0xad, // raw; OEM displays raw*10
} as const;

/** OEM-style rates only (upper bound 1000 Hz — no 2K/4K/8K). */
export const WE_POLLING_RATES = [125, 250, 500, 1000] as const;
export type WePollingRate = (typeof WE_POLLING_RATES)[number];

export type WeLod = "Medium" | "High";

export interface WeDpiStage {
  x: number;
  y: number;
  flags: number;
}

export interface WeProfile {
  activeDpiLevel: number;
  dpiStageCount: number;
  pollingRateHz: number;
  lod: WeLod | null;
  lodRaw: number | null;
  debounceMs: number | null;
  sleepRaw: number | null;
  stages: WeDpiStage[];
  /** Active stage CPI (X axis). */
  dpi: number;
}

/** Sum of reportId + first 15 payload bytes; last payload byte is checksum. */
export function weReportChecksum(reportId: number, data15: readonly number[]): number {
  let sum = reportId;
  for (const byte of data15) sum += byte & 0xff;
  return (WE_CHECKSUM_TARGET - (sum & 0xff)) & 0xff;
}

/** Build 16-byte WebHID feature payload (no report id). */
export function weBuildCmdPayload(cmd: number, dataAfterCmd: readonly number[] = []): Uint8Array {
  const payload = new Uint8Array(WE_PAYLOAD_LEN);
  payload[0] = cmd & 0xff;
  for (let i = 0; i < Math.min(14, dataAfterCmd.length); i += 1) {
    payload[i + 1] = dataAfterCmd[i]! & 0xff;
  }
  const data15 = [...payload.subarray(0, 15)];
  payload[15] = weReportChecksum(WE_REPORT_ID, data15);
  return payload;
}

export function weBuildReadEepromPayload(addr: number, length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > WE_MAX_EEPROM_CHUNK) {
    throw new Error(`WE ReadEEPROM length must be 1–${WE_MAX_EEPROM_CHUNK}.`);
  }
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff) {
    throw new Error("WE EEPROM address out of range.");
  }
  const hi = (addr >> 8) & 0xff;
  const lo = addr & 0xff;
  return weBuildCmdPayload(WE_CMD_READ_EEPROM, [0, hi, lo, length]);
}

export function weBuildWriteEepromPayload(addr: number, data: readonly number[]): Uint8Array {
  if (data.length < 1 || data.length > WE_MAX_EEPROM_CHUNK) {
    throw new Error(`WE WriteEEPROM length must be 1–${WE_MAX_EEPROM_CHUNK}.`);
  }
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff) {
    throw new Error("WE EEPROM address out of range.");
  }
  const hi = (addr >> 8) & 0xff;
  const lo = addr & 0xff;
  return weBuildCmdPayload(WE_CMD_WRITE_EEPROM, [0, hi, lo, data.length, ...data.map((b) => b & 0xff)]);
}

/**
 * Parse input report 9 body (WebHID omits report id).
 * ReadEEPROM success: [cmd, status, 0, addr_lo, len, data…]
 */
export function weParseReadEepromResponse(
  response: Uint8Array,
  expectedAddr: number,
  expectedLen: number,
): Uint8Array | null {
  let data = response;
  if (data.length > 0 && data[0] === 0x09) data = data.subarray(1);
  if (data.length < 5 + expectedLen) return null;
  if (data[0] !== WE_CMD_READ_EEPROM) return null;
  if (data[1] !== 0) return null;
  if (data[3] !== (expectedAddr & 0xff)) return null;
  if (data[4] !== expectedLen) return null;
  return data.subarray(5, 5 + expectedLen);
}

/** WriteEEPROM ACK: status 0 and optional echo. */
export function weParseWriteEepromResponse(response: Uint8Array): boolean {
  let data = response;
  if (data.length > 0 && data[0] === 0x09) data = data.subarray(1);
  if (data.length < 2) return false;
  return data[0] === WE_CMD_WRITE_EEPROM && data[1] === 0;
}

export function weScalarCrc(value: number): number {
  return (WE_CHECKSUM_TARGET - (value & 0xff)) & 0xff;
}

export function wePackScalarPair(value: number): [number, number] {
  const v = value & 0xff;
  return [v, weScalarCrc(v)];
}

export function weUnpackScalarPair(value: number, crc: number): number | null {
  if (weScalarCrc(value) !== (crc & 0xff)) return null;
  return value & 0xff;
}

/** CPI ↔ stage byte: cpi = (byte + 1) * 50  (50…12800). */
export function weCpiToByte(cpi: number): number {
  if (!Number.isInteger(cpi) || cpi < 50 || cpi > 12800 || cpi % 50 !== 0) {
    throw new Error("WE CPI must be 50–12,800 in steps of 50.");
  }
  return cpi / 50 - 1;
}

export function weByteToCpi(byte: number): number {
  return ((byte & 0xff) + 1) * 50;
}

export function weStageCrc(x: number, y: number, flags: number): number {
  return (WE_CHECKSUM_TARGET - ((x + y + flags) & 0xff)) & 0xff;
}

export function wePackDpiStage(xCpi: number, yCpi: number, flags = 0): Uint8Array {
  const x = weCpiToByte(xCpi);
  const y = weCpiToByte(yCpi);
  const f = flags & 0xff;
  return new Uint8Array([x, y, f, weStageCrc(x, y, f)]);
}

export function weUnpackDpiStage(bytes: Uint8Array | readonly number[]): WeDpiStage | null {
  if (bytes.length < 4) return null;
  const x = bytes[0]! & 0xff;
  const y = bytes[1]! & 0xff;
  const flags = bytes[2]! & 0xff;
  const crc = bytes[3]! & 0xff;
  if (weStageCrc(x, y, flags) !== crc) return null;
  return { x: weByteToCpi(x), y: weByteToCpi(y), flags };
}

export function weEncodeLod(value: WeLod): number {
  if (value === "Medium") return 1;
  if (value === "High") return 2;
  throw new Error("OP1we LOD supports Medium (1 mm class) or High only.");
}

export function weDecodeLod(raw: number): WeLod | null {
  if (raw === 1) return "Medium";
  if (raw === 2) return "High";
  return null;
}

/** Divider byte → Hz (1=1000, 2=500, 4=250, 8=125). */
export function weDecodeReportRate(raw: number): number | null {
  const map: Record<number, number> = { 1: 1000, 2: 500, 4: 250, 8: 125 };
  return map[raw & 0xff] ?? null;
}

export function weEncodeReportRate(hz: number): number {
  const map: Record<number, number> = { 1000: 1, 500: 2, 250: 4, 125: 8 };
  if (!(hz in map)) {
    throw new Error("OP1we supports 125, 250, 500, or 1000 Hz report rate.");
  }
  return map[hz]!;
}

export function weIsValidPollingRate(hz: number): hz is WePollingRate {
  return (WE_POLLING_RATES as readonly number[]).includes(hz);
}

/**
 * Decode a contiguous profile memory image starting at address 0
 * (at least through 0xB4 for full basics).
 */
export function weDecodeProfile(mem: Uint8Array): WeProfile {
  const pair = (addr: number): number | null => {
    if (mem.length < addr + 2) return null;
    return weUnpackScalarPair(mem[addr]!, mem[addr + 1]!);
  };

  const activeDpiLevel = pair(WE_OFF.activeDpiLevel) ?? 0;
  let dpiStageCount = pair(WE_OFF.dpiStageCount) ?? 1;
  dpiStageCount = Math.min(Math.max(dpiStageCount, 1), WE_OFF.maxDpiStages);

  const rateRaw = pair(WE_OFF.reportRate);
  const pollingRateHz = rateRaw !== null ? (weDecodeReportRate(rateRaw) ?? 1000) : 1000;

  const lodRaw = pair(WE_OFF.lod);
  const debounceMs = pair(WE_OFF.debounce);
  const sleepRaw = pair(WE_OFF.sleep);

  const stages: WeDpiStage[] = [];
  for (let i = 0; i < WE_OFF.maxDpiStages; i += 1) {
    const off = WE_OFF.dpiStages + i * WE_OFF.dpiStageBytes;
    if (mem.length < off + 4) break;
    const stage = weUnpackDpiStage(mem.subarray(off, off + 4));
    if (stage) stages.push(stage);
    else stages.push({ x: 800, y: 800, flags: 0 });
  }

  const level = Math.min(Math.max(activeDpiLevel, 0), Math.max(stages.length - 1, 0));
  const active = stages[level] ?? stages[0];
  const dpi = active?.x ?? 800;

  return {
    activeDpiLevel: level,
    dpiStageCount,
    pollingRateHz,
    lod: lodRaw !== null ? weDecodeLod(lodRaw) : null,
    lodRaw,
    debounceMs,
    sleepRaw,
    stages,
    dpi,
  };
}

/** Patch only the selected DPI stage, preserving its protocol flags. */
export function wePatchActiveDpi(mem: Uint8Array, cpi: number, activeLevel: number): void {
  if (!Number.isInteger(activeLevel) || activeLevel < 0 || activeLevel >= WE_OFF.maxDpiStages) {
    throw new Error("WE active DPI stage is out of range.");
  }
  const off = WE_OFF.dpiStages + activeLevel * WE_OFF.dpiStageBytes;
  if (mem.length < off + WE_OFF.dpiStageBytes) throw new Error("WE profile is missing the active DPI stage.");
  const existing = weUnpackDpiStage(mem.subarray(off, off + WE_OFF.dpiStageBytes));
  if (!existing) throw new Error("WE active DPI stage checksum is invalid.");
  mem.set(wePackDpiStage(cpi, cpi, existing.flags), off);
}

export function wePatchScalar(mem: Uint8Array, addr: number, value: number): void {
  const [v, c] = wePackScalarPair(value);
  mem[addr] = v;
  mem[addr + 1] = c;
}

export function weIsValidCpi(cpi: number): boolean {
  return Number.isInteger(cpi) && cpi >= 50 && cpi <= 12800 && cpi % 50 === 0;
}
