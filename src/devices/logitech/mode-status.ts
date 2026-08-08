import type { MouseStatus } from "../mouse-types.ts";

export type GamingSurfaceMode = NonNullable<MouseStatus["gamingSurfaceMode"]>;
export type LightforceSwitchMode = NonNullable<MouseStatus["lightforceSwitchMode"]>;

export interface ModeStatusField<T extends string> {
  mask: number;
  shift: number;
  values: Record<T, number>;
}

/**
 * G HUB's "Gaming surface" and LightForce switch mode both live in feature 0x8090 (Mode Status).
 * 
 * setModeStatus takes 4 one-byte fields: modeStatus0, modeStatus1, changeMask0, changeMask1.
 * Both settings sit in modeStatus1, so a write is `00 <value> 00 <mask>`.
 * Confirmed on hardware: the two-byte-field form and a bare value/mask pair are both rejected with INVALID_ARGUMENT.
 *
 * The change mask means a write only touches the bits it names, so bits 3-7 (always 0 in every capture, purpose unknown) survive untouched.
 */
export const MODE_STATUS = {
  get: 0x00,
  set: 0x10,
  gamingSurface: {
    mask: 0b0000_0110,
    shift: 1,
    values: { Auto: 0, On: 1, Off: 2 },
  } satisfies ModeStatusField<GamingSurfaceMode>,
  lightforce: {
    mask: 0b0000_0001,
    shift: 0,
    values: { Optical: 0, Hybrid: 1 },
  } satisfies ModeStatusField<LightforceSwitchMode>,
} as const;

// Reads 1 field out of the mode-status byte.
export function decodeModeStatus<T extends string>(statusByte: number, field: ModeStatusField<T>): T | null {
  const encoded = (statusByte & field.mask) >> field.shift;
  const entry = (Object.entries(field.values) as Array<[T, number]>).find(([, value]) => value === encoded);
  return entry?.[0] ?? null;
}

// Replaces 1 field, carrying every other bit through from the current byte.
export function encodeModeStatus<T extends string>(statusByte: number, field: ModeStatusField<T>, mode: T): number {
  return (statusByte & ~field.mask) | (field.values[mode] << field.shift);
}

export function buildModeStatusWrite<T extends string>(
  statusByte: number,
  field: ModeStatusField<T>,
  mode: T,
): number[] {
  return [0x00, encodeModeStatus(statusByte, field, mode), 0x00, field.mask];
}

export interface ModeStatusUpdate {
  field: ModeStatusField<string>;
  mode: string;
}

/**
 * One write covering several fields of the byte, with the change mask naming
 * every bit touched. Both settings here share modeStatus1, so writing them
 * separately costs two writes to a byte whose persistence is unknown, and the
 * second is built from a read the first already invalidated.
 */
export function buildModeStatusWriteMany(statusByte: number, updates: ModeStatusUpdate[]): number[] {
  let value = statusByte;
  let mask = 0;
  for (const update of updates) {
    value = encodeModeStatus(value, update.field, update.mode);
    mask |= update.field.mask;
  }
  return [0x00, value, 0x00, mask];
}
