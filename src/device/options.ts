import { t, tp, type I18nKey } from "../i18n.ts";
import type { InterfaceLocale } from "../interface-preferences.ts";
export function sleepLabel(seconds: number, locale: InterfaceLocale = "en"): string {
  const unit = (n: number, one: I18nKey, many: I18nKey): string =>
    n === 1 ? t(locale, one) : tp(locale, many, { n });
  // Drivers whose firmware treats zero as "no auto-sleep" offer it as an option.
  if (seconds === 0) return t(locale, "sleep.never");
  if (seconds < 60) return unit(seconds, "sleep.second1", "sleep.seconds");
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return unit(hours, "sleep.hour1", "sleep.hours");
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return unit(minutes, "sleep.minute1", "sleep.minutes");
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(unit(hours, "sleep.hour1", "sleep.hours"));
  if (minutes) parts.push(unit(minutes, "sleep.minute1", "sleep.minutes"));
  if (rest) parts.push(unit(rest, "sleep.second1", "sleep.seconds"));
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
