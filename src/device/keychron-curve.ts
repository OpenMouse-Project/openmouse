import { KEYCHRON_ADVANCE_MODE, type KeychronCurve, type KeychronProfileBuffer } from "@openmouse/keyboard-protocol/keychron";
import type { KeychronState } from "@openmouse/keyboard-protocol/drivers";

/**
 * Ranges for the response curve, as Keychron Launcher's curve editor uses them
 * (read from its code, not verified on hardware): x is key travel in 0.1 mm
 * steps up to the board's maximum travel plus dead zone, y is output strength
 * 0 to 127, and the four points keep x non-decreasing left to right.
 */
export const CURVE_MAX_Y = 127;
/** Millimetres per x step, as Launcher derives it (mm * 10). */
export const CURVE_X_STEP_MM = 0.1;

export interface CurveScale {
  /** Largest x byte. */
  maxX: number;
  /** False when neither the board definition nor the axis type gave a travel range, so the byte limit is used. */
  fromBoard: boolean;
  /** Command v5 uses another travel step; Launcher still scales x by 10, so that scale is unverified there. */
  unverifiedStep: boolean;
}

export function curveScale(state: KeychronState, axisMaxMm: number | null): CurveScale {
  const travel = state.travel;
  const mm = travel?.max !== undefined ? travel.max + (travel.deadzone ?? 0) : axisMaxMm;
  const maxX = mm === null || mm <= 0 ? 255 : Math.min(255, Math.floor(mm / CURVE_X_STEP_MM + 1e-6));
  return { maxX, fromBoard: mm !== null && mm > 0, unverifiedStep: state.heVersion >= 5 };
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, Math.round(Number.isFinite(value) ? value : low)));

/** Move one point, keeping every byte in range and x between its neighbours. */
export function setCurvePoint(curve: KeychronCurve, index: number, x: number, y: number, maxX: number): KeychronCurve {
  const low = index === 0 ? 0 : curve[index - 1]![0];
  const high = index === curve.length - 1 ? maxX : curve[index + 1]![0];
  return curve.map((point, i) => (i === index ? [clamp(x, low, Math.max(low, high)), clamp(y, 0, CURVE_MAX_Y)] : point)) as unknown as KeychronCurve;
}

/** Bring any curve into range, left to right. */
export function clampCurve(curve: KeychronCurve, maxX: number): KeychronCurve {
  let previous = 0;
  return curve.map(([x, y]) => {
    previous = clamp(x, previous, maxX);
    return [previous, clamp(y, 0, CURVE_MAX_Y)];
  }) as unknown as KeychronCurve;
}

export function curveInRange(curve: KeychronCurve, maxX: number): boolean {
  let previous = 0;
  return curve.every(([x, y]) => {
    const ok = Number.isInteger(x) && Number.isInteger(y) && x >= previous && x <= maxX && y >= 0 && y <= CURVE_MAX_Y;
    previous = x;
    return ok;
  });
}

/** Launcher's linear preset: from (0, 0) to (max, 127) with the middle points a third and two thirds along. */
export function linearCurve(maxX: number): KeychronCurve {
  const at = (fraction: number): [number, number] => [Math.round(maxX * fraction), Math.round(CURVE_MAX_Y * fraction)];
  return [[0, 0], at(1 / 3), at(2 / 3), [maxX, CURVE_MAX_Y]];
}

/** Keys set to the analog advanced mode; the curve shapes their output. */
export function analogKeyCount(profile: KeychronProfileBuffer | null): number {
  if (!profile) return 0;
  return profile.keys.reduce((sum, row) => sum + row.filter((key) => key.advanceMode === KEYCHRON_ADVANCE_MODE.analog).length, 0);
}
