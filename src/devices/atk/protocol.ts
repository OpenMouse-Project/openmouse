/**
 * Pure ATK (A9 family) DPI codec, unit-tested without WebHID.
 *
 * ATK shares the Endgame Gear WE framing (see egg-we-protocol.ts): feature
 * command 0x08 reads an EEPROM address, 0x07 writes one, every frame and every
 * value/checksum pair sums to 0x55. Only the DPI stage encoding differs — ATK
 * packs a mode nibble per axis so newer sensors reach 42,000 DPI.
 */

const CHECKSUM_TOTAL = 0x55;

/**
 * Per-axis mode nibble: bits 2-3 extend the value byte, bit 1 selects the
 * 50-DPI step range above 10,000, bit 0 doubles the result above 30,000.
 */
export function atkEncodeDpiAxis(dpi: number): { byte: number; nibble: number } {
  let value = dpi;
  let doubled = 0;
  if (value > 30000) {
    doubled = 1;
    value = Math.round(value / 2);
  }
  if (value <= 10000) {
    const code = Math.floor(value / 10) - 1;
    return { byte: code & 0xff, nibble: ((code >> 8) << 2) | doubled };
  }
  const code = Math.floor((value - 10050) / 50);
  return { byte: code & 0xff, nibble: ((code >> 8) << 2) | 2 | doubled };
}

export function atkDecodeDpiAxis(byte: number, nibble: number): number {
  const code = (((nibble >> 2) & 0x03) << 8) | (byte & 0xff);
  const base = (nibble & 2) !== 0 ? 10050 + code * 50 : (code + 1) * 10;
  return (nibble & 1) !== 0 ? base * 2 : base;
}

/** One DPI stage: [x, y, packed nibbles, checksum]. */
export function atkPackDpiStage(x: number, y: number): number[] {
  const encodedX = atkEncodeDpiAxis(x);
  const encodedY = atkEncodeDpiAxis(y);
  const mode = ((encodedY.nibble & 0x0f) << 4) | (encodedX.nibble & 0x0f);
  const sum = (encodedX.byte + encodedY.byte + mode) & 0xff;
  return [encodedX.byte, encodedY.byte, mode, (CHECKSUM_TOTAL - sum) & 0xff];
}

export function atkUnpackDpiStage(data: Uint8Array | readonly number[]): { x: number; y: number } | null {
  if (data.length < 4) return null;
  const sum = (data[0]! + data[1]! + data[2]! + data[3]!) & 0xff;
  if (sum !== CHECKSUM_TOTAL) return null;
  return {
    x: atkDecodeDpiAxis(data[0]!, data[2]! & 0x0f),
    y: atkDecodeDpiAxis(data[1]!, (data[2]! >> 4) & 0x0f),
  };
}

/** Register holds tenths of a millimetre offset by 6 (code 1 = 0.7 mm). */
export function atkDecodeLiftOff(code: number): number | null {
  return code ? (code + 6) / 10 : null;
}
