/** Zero/non-finite rates represent a missing hardware read, not a setting. */
export function pollingRateText(rate: number): string {
  return Number.isFinite(rate) && rate > 0 ? rate.toLocaleString() : "—";
}

/** Preserve nearest-step selection for known rates; leave unknown ones blank. */
export function selectedPollingStep(options: readonly number[], rate: number | null): number | null {
  if (options.length === 0 || rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  const exact = options.indexOf(rate);
  if (exact >= 0) return exact;
  return options.reduce((best, candidate, index) =>
    Math.abs(candidate - rate) < Math.abs(options[best]! - rate) ? index : best, 0);
}
