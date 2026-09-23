import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

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
export type GameProfileSnapshot = Partial<Pick<MouseStatus, GameProfileField>>;

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
    if (!same(before[field], after[field])) diff[field] = structuredClone(after[field]);
  }
  return diff as GameProfileSnapshot;
}

/** `status`'s current values for exactly the fields `snapshot` sets. */
export function pickSnapshot(status: MouseStatus, snapshot: GameProfileSnapshot): GameProfileSnapshot {
  const picked: Record<string, unknown> = {};
  for (const field of Object.keys(snapshot)) {
    if (!isGameProfileField(field)) continue;
    const value = status[field];
    if (value !== undefined) picked[field] = structuredClone(value);
  }
  return picked as GameProfileSnapshot;
}

/** A comparison key that ignores field order (Bridge and the draft list fields differently). */
export function snapshotKey(snapshot: GameProfileSnapshot): string {
  return JSON.stringify(Object.fromEntries(Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right))));
}

/** Drops anything a stored snapshot carries that this build cannot apply. */
export function sanitizeSnapshot(raw: unknown): GameProfileSnapshot {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const clean: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (isGameProfileField(field) && value !== undefined) clean[field] = value;
  }
  return clean as GameProfileSnapshot;
}
