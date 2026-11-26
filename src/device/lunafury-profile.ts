import type { LunaFuryButton, LunaFuryLightningMode, LunaFurySettings, LunaFuryWheelGuard } from "@openmouse/protocol/lamzu";

export const LUNAFURY_PROFILE_FIELDS = [
  "lightningMode", "leftDebounceMs", "rightDebounceMs", "middleDebounceMs", "wheelGuard",
] as const satisfies readonly (keyof LunaFurySettings)[];
type Field = (typeof LUNAFURY_PROFILE_FIELDS)[number];

export function isLunaFuryProfileField(field: string): field is Field {
  return LUNAFURY_PROFILE_FIELDS.some((known) => known === field);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function sanitizeLunaFurySettings(raw: unknown): LunaFurySettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const clean: LunaFurySettings = {};
  if (integer(value.lightningMode, 0, 2)) clean.lightningMode = value.lightningMode as LunaFuryLightningMode;
  if (integer(value.leftDebounceMs, 0, 15)) clean.leftDebounceMs = value.leftDebounceMs;
  if (integer(value.rightDebounceMs, 0, 15)) clean.rightDebounceMs = value.rightDebounceMs;
  if (integer(value.middleDebounceMs, 1, 30)) clean.middleDebounceMs = value.middleDebounceMs;
  if (value.wheelGuard && typeof value.wheelGuard === "object" && !Array.isArray(value.wheelGuard)) {
    const guard = value.wheelGuard as Record<string, unknown>;
    if (typeof guard.enabled === "boolean" &&
      ((integer(guard.windowMs, 20, 200) && guard.windowMs % 20 === 0) || (!guard.enabled && guard.windowMs === 0))) {
      clean.wheelGuard = { enabled: guard.enabled, windowMs: guard.windowMs as number };
    }
  }
  return clean;
}

/** Keep the namespace partial: editing one control must not save its peers. */
export function diffLunaFurySettings(before: LunaFurySettings | undefined, after: LunaFurySettings | undefined): LunaFurySettings {
  const diff: Record<string, unknown> = {};
  for (const field of LUNAFURY_PROFILE_FIELDS) {
    if (after?.[field] !== undefined && JSON.stringify(before?.[field]) !== JSON.stringify(after[field])) {
      diff[field] = structuredClone(after[field]);
    }
  }
  return sanitizeLunaFurySettings(diff);
}

export function pickLunaFurySettings(current: LunaFurySettings | undefined, target: unknown): LunaFurySettings {
  const picked: Record<string, unknown> = {};
  for (const field of Object.keys(sanitizeLunaFurySettings(target))) {
    if (isLunaFuryProfileField(field) && current?.[field] !== undefined) picked[field] = structuredClone(current[field]);
  }
  return sanitizeLunaFurySettings(picked);
}

export interface LunaFuryProfileActions {
  lightning(mode: LunaFuryLightningMode): void;
  button(button: LunaFuryButton, milliseconds: number): void;
  wheel(guard: LunaFuryWheelGuard): void;
}

/** Disable priority before changing latencies; enable it after them. */
export function lunaFuryLightningPriority(mode: LunaFuryLightningMode): number {
  return mode === 0 ? -10 : 10;
}

export function stageLunaFuryProfile(raw: unknown, current: LunaFurySettings | undefined, actions: LunaFuryProfileActions): void {
  if (!current) return;
  const target = sanitizeLunaFurySettings(raw);
  if (target.lightningMode !== undefined && current.lightningMode !== undefined) actions.lightning(target.lightningMode);
  for (const button of ["left", "right", "middle"] as const) {
    const field = `${button}DebounceMs` as const;
    if (target[field] !== undefined && current[field] !== undefined) actions.button(button, target[field]);
  }
  if (target.wheelGuard && current.wheelGuard) actions.wheel(target.wheelGuard);
}
