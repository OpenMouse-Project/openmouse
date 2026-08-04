/** Round numbers the DPI row offers when a mouse can reach them. */
export const COMMON_DPI_PRESETS = [400, 800, 1600, 3200, 6400, 8000] as const;

/**
 * How far a nominal preset may be snapped onto a mouse's own DPI grid before it
 * stops being a believable stand-in for the round number on the button.
 */
const DPI_SNAP_TOLERANCE = 0.1;

/** Closest DPI the mouse can actually reach, or null when it advertises none. */
export function closestDpiOption(options: readonly number[], target: number): number | null {
  let closest: number | null = null;
  for (const option of options) {
    if (closest === null || Math.abs(option - target) < Math.abs(closest - target)) closest = option;
  }
  return closest;
}

/**
 * Presets snapped onto the mouse's advertised grid. Mice that list the round
 * numbers exactly — most of them — get those values back untouched. Mice with
 * an unusual step (the G402 counts in 84s from 252, so vendor software shows
 * "2400" for a mouse actually holding 2436) get the nearest value they can
 * really hold, instead of a preset row that collapses to a single button.
 *
 * A preset with no option within the tolerance is dropped, so a mouse that
 * simply cannot reach 8000 DPI still does not get a button for it.
 */
export function dpiPresetValues(options: readonly number[]): number[] {
  const snapped = COMMON_DPI_PRESETS.map((preset) => {
    const option = closestDpiOption(options, preset);
    return option !== null && Math.abs(option - preset) <= preset * DPI_SNAP_TOLERANCE ? option : null;
  }).filter((dpi): dpi is number => dpi !== null);
  return [...new Set(snapped)].sort((left, right) => left - right);
}
