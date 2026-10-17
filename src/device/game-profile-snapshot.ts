import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { LunaFuryDpiStorage } from "@openmouse/protocol/lamzu";
import { diffLunaFurySettings, isLunaFuryProfileField, pickLunaFurySettings, sanitizeLunaFurySettings } from "./lunafury-profile.ts";
import { pickLunaFuryMappings } from "./lunafury-buttons.ts";
import { canonicalLunaFuryDpiSnapshot, preserveLunaFuryDpiTables, withoutDerivedLunaFuryDpi } from "./lunafury-game-dpi.ts";

/**
 * The device settings a per-game profile can carry. A game profile is stored
 * as the values of just the fields the user changed (a `GameProfileSnapshot`);
 * applying one stages each field through its ordinary `apply*` in
 * controller.ts, and — because the same mapping works in reverse — the values
 * the mouse had before the game launched are put back the same way.
 *
 * A field belongs here only if `applyGameProfileSnapshot` can write it back.
 * While a game profile is being edited the controller refuses any staged
 * change whose preview touches a field outside this list, so a saved profile
 * never holds a value that could not be restored.
 */
export const GAME_PROFILE_FIELDS = [
  "dpi",
  "dpiY",
  "dpiStages",
  "dpiStagesY",
  "activeDpiStage",
  "dpiStageColors",
  "pollingRateHz",
  "liftOffDistance",
  "liftOffScale",
  "asymmetricLiftOff",
  "gamingSurfaceMode",
  "lightforceSwitchMode",
  "sensorMode",
  "sensorModeStored",
  "powerMode",
  "motionSync",
  "angleSnapping",
  "rippleControl",
  "performanceMode",
  "hyperMode",
  "turboMode",
  "buttonCombination",
  "longRangeMode",
  "debounceMs",
  "sleepTimeout",
  "lowBatteryWarning",
  "angleTuning",
  "lunafury",
  "wheelAcceleration",
  "wheelMode",
  "smartShiftThreshold",
  "hiResScroll",
  "invertScroll",
  "thumbWheelInverted",
  "hapticIntensity",
  "hapticEnabled",
  "hapticBatterySaving",
  "ninjutsoSystemMode",
  "ninjutsoHyperClick",
  "ninjutsoOpticalEngine",
  "ninjutsoSlamClick",
  "performanceDuration",
  "dpiLedMode",
  "dpiLedBrightness",
  "dpiLedSpeed",
  "dpiLedSleepTimeout",
  "slamclickFilter",
  "motionJitterFilter",
  "leftSpdtMode",
  "rightSpdtMode",
  "eggCpiLevels",
  "eggCpiStages",
  "eggPollingDivider",
  "eggMulticlickFilters",
  "eggButtonMappings",
  "eggLodIndex",
  "eggAngleTuning",
  "eggForceMaxFps",
  "eggLedLiftOffDisabled",
  // Handedness is not here: the firmware rewrites both main buttons to their
  // swapped defaults whenever it changes, so a profile that carried it could
  // not put a custom mapping back when the game exits.
  "buttonMappings",
  "razerButtonMappings",
  "finalmouseDongleLedMode",
  "finalmouseTournamentScrollMode",
  "finalmouseTournamentScrollTimeoutMs",
  "incottReceiverLedMode",
  "incottFireKeyTimes",
  "incottFireKeyIntervalMs",
  "dongleLedEnabled",
  "lighting",
  "lightingZones",
] as const satisfies readonly (keyof MouseStatus)[];

export type GameProfileField = (typeof GAME_PROFILE_FIELDS)[number];
export type GameProfileSnapshot = Partial<Pick<MouseStatus, GameProfileField>> & {
  /** In-memory restoration only; sanitized imports and saved drafts exclude it. */
  lunaFuryDpiStorage?: LunaFuryDpiStorage;
};

const FIELD_SET: ReadonlySet<string> = new Set(GAME_PROFILE_FIELDS);

export function isGameProfileField(field: string): field is GameProfileField {
  return FIELD_SET.has(field);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Top-level MouseStatus fields whose value differs between the two. */
export function changedFields(before: MouseStatus, after: MouseStatus): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) =>
    !same((before as unknown as Record<string, unknown>)[key], (after as unknown as Record<string, unknown>)[key]));
}

/** The game-profile fields `after` changed relative to `before`, with `after`'s values. */
export function snapshotDiff(before: MouseStatus, after: MouseStatus): GameProfileSnapshot {
  const diff: Record<string, unknown> = {};
  for (const field of GAME_PROFILE_FIELDS) {
    if (field === "lunafury") {
      const settings = diffLunaFurySettings(before.lunafury, after.lunafury);
      if (Object.keys(settings).length) diff.lunafury = settings;
    } else if (field === "buttonMappings" && before.brand === "LunaFury") {
      const mappings = pickLunaFuryMappings(before, after.buttonMappings);
      for (const button of Object.keys(mappings)) if (before.buttonMappings?.[button] === mappings[button]) delete mappings[button];
      if (Object.keys(mappings).length) diff.buttonMappings = mappings;
    } else if (!same(before[field], after[field])) diff[field] = structuredClone(after[field]);
  }
  return withoutDerivedLunaFuryDpi(after, diff as GameProfileSnapshot);
}

/** Prior values for the profile's writes; LunaFury scalar/count edits also back up their table storage. */
export function pickSnapshot(status: MouseStatus, snapshot: GameProfileSnapshot): GameProfileSnapshot {
  const picked: Record<string, unknown> = {};
  for (const field of Object.keys(snapshot)) {
    if (!isGameProfileField(field)) continue;
    if (field === "buttonMappings" && status.brand === "LunaFury") {
      const mappings = pickLunaFuryMappings(status, snapshot.buttonMappings, true);
      if (Object.keys(mappings).length) picked.buttonMappings = mappings;
      continue;
    }
    if (field === "lunafury") {
      const settings = pickLunaFurySettings(status.lunafury, snapshot.lunafury);
      if (Object.keys(settings).length) picked.lunafury = settings;
      continue;
    }
    const value = status[field];
    if (value !== undefined) picked[field] = structuredClone(value);
  }
  preserveLunaFuryDpiTables(status, snapshot, picked as GameProfileSnapshot);
  return picked as GameProfileSnapshot;
}

/** Merge per-control namespaces when games switch, not entire device settings. */
export function mergeSnapshots(base: GameProfileSnapshot, override: GameProfileSnapshot, status?: MouseStatus): GameProfileSnapshot {
  // Normalize the lower-priority legacy values before merging a newer table.
  // Override scalars still apply after the base table when switching the other way.
  if (status) base = canonicalLunaFuryDpiSnapshot(status, base);
  const merged = { ...base, ...override };
  if (base.lunafury || override.lunafury) merged.lunafury = { ...base.lunafury, ...override.lunafury };
  if (base.buttonMappings || override.buttonMappings) merged.buttonMappings = { ...base.buttonMappings, ...override.buttonMappings };
  return merged;
}

/** A comparison key that ignores field order (Bridge and the draft list fields differently). */
export function snapshotKey(snapshot: GameProfileSnapshot): string {
  const canonical = snapshot.lunafury ? { ...snapshot, lunafury: sanitizeLunaFurySettings(snapshot.lunafury) } : snapshot;
  return JSON.stringify(Object.fromEntries(Object.entries(canonical).sort(([left], [right]) => left.localeCompare(right))));
}

/** Drops anything a stored snapshot carries that this build cannot apply. */
export function sanitizeSnapshot(raw: unknown): GameProfileSnapshot {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const clean: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (field === "lunafury") {
      const settings = sanitizeLunaFurySettings(value);
      if (Object.keys(settings).length) clean.lunafury = settings;
    } else if (isGameProfileField(field) && value !== undefined) clean[field] = value;
  }
  return clean as GameProfileSnapshot;
}

/** Track nested LunaFury controls separately while retaining the old field policy. */
export function editableProfileFields(before: MouseStatus, after: MouseStatus): string[] | null {
  const fields = changedFields(before, after);
  if (!fields.every(isGameProfileField)) return null;
  return fields.flatMap((field) => {
    if (field === "lunafury") return Object.keys(diffLunaFurySettings(before.lunafury, after.lunafury)).map((key) => `lunafury.${key}`);
    if (field === "buttonMappings" && before.brand === "LunaFury") {
      return Object.keys(snapshotDiff(before, after).buttonMappings ?? {}).map((button) => `buttonMappings.${button}`);
    }
    return [field];
  });
}

export function matchingProfileFields(status: MouseStatus, snapshot: GameProfileSnapshot): string[] {
  return Object.entries(snapshot).flatMap(([field, value]) => {
    if (field === "buttonMappings" && status.brand === "LunaFury") {
      return Object.entries(pickLunaFuryMappings(status, value))
        .filter(([button, action]) => status.buttonMappings?.[button] === action).map(([button]) => `buttonMappings.${button}`);
    }
    if (field === "lunafury") {
      const target = sanitizeLunaFurySettings(value);
      return Object.keys(target).filter((key) => isLunaFuryProfileField(key) && same(status.lunafury?.[key], target[key]))
        .map((key) => `lunafury.${key}`);
    }
    return isGameProfileField(field) && same(status[field], value) ? [field] : [];
  });
}

export function draftProfileSnapshot(before: MouseStatus, preview: MouseStatus, touched: Iterable<string>): GameProfileSnapshot {
  const snapshot = snapshotDiff(before, preview);
  for (const field of touched) {
    if (before.brand === "LunaFury" && field.startsWith("buttonMappings.")) {
      const button = field.slice("buttonMappings.".length);
      const mappings = pickLunaFuryMappings(before, { [button]: preview.buttonMappings?.[button] });
      if (Object.keys(mappings).length) snapshot.buttonMappings = { ...snapshot.buttonMappings, ...mappings };
    } else if (field.startsWith("lunafury.")) {
      const key = field.slice("lunafury.".length);
      if (isLunaFuryProfileField(key) && preview.lunafury?.[key] !== undefined) {
        snapshot.lunafury = { ...snapshot.lunafury, [key]: structuredClone(preview.lunafury[key]) };
      }
    } else if (!(field in snapshot) && isGameProfileField(field) && field !== "lunafury" && preview[field] !== undefined) {
      Object.assign(snapshot, { [field]: structuredClone(preview[field]) });
    }
  }
  return withoutDerivedLunaFuryDpi(preview, snapshot);
}
