export function sleepLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function selectableValues(offered: number[], current: number | null | undefined): number[] | null {
  if (current === null || current === undefined) return null;
  if (current < offered[0] || current > offered[offered.length - 1]) return null;
  return offered.includes(current) ? offered : [...offered, current].sort((left, right) => left - right);
}
