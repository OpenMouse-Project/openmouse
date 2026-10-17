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

/** Keep an unwritable firmware value visible without adding it to the offered set. */
export function valuesWithCurrent(offered: number[], current: number | null | undefined): number[] {
  if (current === null || current === undefined || offered.includes(current)) return offered;
  return [...offered, current].sort((left, right) => left - right);
}

/** The CPI range an Egg mouse reports, with a step for each end of it. */
export interface CpiLimits {
  min: number;
  max: number;
  stepLow: number;
  stepHigh: number;
}

/**
 * The value the mouse itself would store — the protocol's `eggClampCpi`: clamp,
 * snap to the step at that end of the range, clamp again. The v2 generation
 * takes 10-CPI steps below 10,000 CPI and 50 above; v1 uses 50 throughout.
 *
 * The panel's number fields cannot express a grid whose step changes partway up
 * the range (HTML measures `step` from `min`), so they keep the fine step and
 * snap through here on Apply rather than offering the driver values it refuses.
 */
export function snapCpiToDevice(value: number, limits: CpiLimits): number {
  const clamped = Math.max(limits.min, Math.min(limits.max, Math.round(value)));
  const step = clamped <= 10_000 ? limits.stepLow : limits.stepHigh;
  const snapped = Math.floor((clamped + step / 2) / step) * step;
  return Math.max(limits.min, Math.min(limits.max, snapped));
}
