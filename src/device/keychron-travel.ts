import type { KeychronState } from "@openmouse/keyboard-protocol/drivers";

export interface KeychronTravelBounds {
  /** Millimetres per profile step. */
  stepMm: number;
  minMm: number;
  maxMm: number;
  /** The board's dead zone from Launcher's definition; it extends the top of the range. */
  deadzoneMm: number | null;
  /** False when the board's definition declares no travel range. */
  fromBoard: boolean;
}

/** Widest value a key slot can hold: 6 bits up to command v4, 14 bits in v5. */
const maxSteps = (heVersion: number): number => (heVersion >= 5 ? 0x3fff : 0x3f);

const round = (value: number): number => Number(value.toFixed(4));

export const stepsToMm = (steps: number, unit: number): number => round(steps * unit);

export const mmToSteps = (mm: number, unit: number): number => Math.round(mm / unit + 1e-9);

/**
 * Limits for actuation and rapid-trigger values, as Launcher shows them: from
 * the board's minimum to its maximum plus its dead zone. Launcher also keeps a
 * separate minimum for the rapid-trigger sliders that boards do not declare;
 * it is not invented here, so the board minimum applies to all three. Without
 * a declared range the only limit is what the slot can encode.
 */
export function travelBounds(state: KeychronState): KeychronTravelBounds {
  const stepMm = state.unit;
  const encodable = round(maxSteps(state.heVersion) * stepMm);
  const travel = state.travel;
  const deadzone = travel?.deadzone ?? null;
  const declaredMax = travel?.max;
  const declaredMin = travel?.min;
  return {
    stepMm,
    minMm: round(Math.max(declaredMin ?? stepMm, stepMm)),
    maxMm: declaredMax === undefined ? encodable : Math.min(round(declaredMax + (deadzone ?? 0)), encodable),
    deadzoneMm: deadzone,
    fromBoard: declaredMax !== undefined || declaredMin !== undefined,
  };
}

export interface KeychronTravelRequest {
  rapidTrigger?: boolean;
  pressMm: number;
  sensitivePressMm: number;
  sensitiveReleaseMm: number;
}

export interface KeychronTravelSteps {
  press: number;
  sensitivePress: number;
  sensitiveRelease: number;
}

/** Convert a request to profile steps; throws if any value leaves the board's range. */
export function travelToSteps(state: KeychronState, request: KeychronTravelRequest): KeychronTravelSteps {
  const bounds = travelBounds(state);
  const convert = (mm: number, label: string): number => {
    if (!Number.isFinite(mm) || mm < bounds.minMm - 1e-9 || mm > bounds.maxMm + 1e-9) {
      throw new RangeError(`${label} must be between ${bounds.minMm} and ${bounds.maxMm} mm.`);
    }
    const steps = mmToSteps(mm, bounds.stepMm);
    if (stepsToMm(steps, bounds.stepMm) > bounds.maxMm + 1e-9) {
      throw new RangeError(`${label} must be between ${bounds.minMm} and ${bounds.maxMm} mm.`);
    }
    return steps;
  };
  return {
    press: convert(request.pressMm, "Actuation"),
    sensitivePress: request.rapidTrigger === false ? 0 : convert(request.sensitivePressMm, "Rapid trigger press"),
    sensitiveRelease: request.rapidTrigger === false ? 0 : convert(request.sensitiveReleaseMm, "Rapid trigger release"),
  };
}
