/**
 * The HITS speed test. A normal mouse switch fires at one fixed point, about
 * step 5 of the HITS scale. HITS fires at the chosen actuation step, so the time
 * saved is how long the finger takes to travel from the actuation step down to
 * step 5, read from the press-depth stream.
 */

export interface DepthSample {
  /** Milliseconds, from any steady clock. */
  t: number;
  /** HITS depth, 0 to 10. */
  depth: number;
}

/** What a conventional switch is compared against. */
export const CONVENTIONAL_STEP = 5;

/**
 * Milliseconds saved by firing at `actuation` instead of at the conventional step
 * (negative when the actuation is deeper), or null when the press never got deep
 * enough to tell. Accurate to the spacing of the depth reports, a few milliseconds.
 */
export function savedMs(samples: readonly DepthSample[], actuation: number): number | null {
  const reached = (step: number) => samples.find((sample) => sample.depth >= step)?.t;
  const fired = reached(actuation);
  const conventional = reached(CONVENTIONAL_STEP);
  if (fired === undefined || conventional === undefined) return null;
  return conventional - fired;
}

/**
 * When each step 1 to 10 was first reached, in milliseconds after `start`
 * (null for a step the press skipped or never reached).
 */
export function stepTimes(samples: readonly DepthSample[], start: number): (number | null)[] {
  return Array.from({ length: 10 }, (_, index) => {
    const hit = samples.find((sample) => sample.depth >= index + 1);
    return hit ? hit.t - start : null;
  });
}

export function averageMs(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
}

