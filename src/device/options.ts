export function sleepLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(hours === 1 ? "1 hour" : `${hours} hours`);
  if (minutes) parts.push(minutes === 1 ? "1 minute" : `${minutes} minutes`);
  if (rest) parts.push(`${rest} seconds`);
  return parts.join(" ");
}

export const KEYCHRON_SLEEP_MAX_HOURS = 12;
export const KEYCHRON_SLEEP_MIN_SECONDS = 60;
export const KEYCHRON_SLEEP_MAX_SECONDS = KEYCHRON_SLEEP_MAX_HOURS * 3600 + 59 * 60 + 59;

export function sleepParts(totalSeconds: number): { hours: number; minutes: number; seconds: number } {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  return {
    hours: Math.floor(clamped / 3600),
    minutes: Math.floor((clamped % 3600) / 60),
    seconds: clamped % 60,
  };
}

export function sleepTotalSeconds(hours: number, minutes: number, seconds: number): number {
  return hours * 3600 + minutes * 60 + seconds;
}

export function selectableValues(offered: number[], current: number | null | undefined): number[] | null {
  if (current === null || current === undefined) return null;
  if (current < offered[0] || current > offered[offered.length - 1]) return null;
  return offered.includes(current) ? offered : [...offered, current].sort((left, right) => left - right);
}
