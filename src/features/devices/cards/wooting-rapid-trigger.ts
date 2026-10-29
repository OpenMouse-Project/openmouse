import {
  decodeWootingKeyIndex,
  wootingActuationMm,
  wootingMatrixKeyId,
  type WootingFullRapidTriggerProfile,
  type WootingProfileField,
  type WootingRapidTriggerGroup,
} from "@openmouse/keyboard-protocol/wooting";

/** One key's effective rapid-trigger setting, independent of firmware group packing. */
export type WootingRapidTriggerState =
  | { kind: "base" }
  | { kind: "off" }
  | {
      kind: "custom";
      sensitivityMm: number | null;
      secondarySensitivityMm: number | null;
      continuous: boolean | null;
    };

/** Profile-wide rapid trigger, resolved from the 0x27 base profile fields. */
export interface WootingRapidTriggerBase {
  enabled: boolean | null;
  sensitivityMm: number | null;
  /** Field 7 stores the inverse: strict actuation range on means continuous mode off. */
  strict: boolean | null;
  continuous: boolean | null;
}

export interface WootingUnmappedRapidTriggerKey {
  matrix: number;
  row: number | null;
  col: number | null;
  state: WootingRapidTriggerState;
}

export interface WootingRapidTriggerMap {
  /** Per-key overrides by firmware matrix index. Keys without an entry follow the profile. */
  byMatrix: ReadonlyMap<number, WootingRapidTriggerState>;
  /** Overridden matrix positions this layout cannot render; shown with raw row/column. */
  unmapped: readonly WootingUnmappedRapidTriggerKey[];
}

const EMPTY_MAP: WootingRapidTriggerMap = { byMatrix: new Map(), unmapped: [] };

function stateForGroup(group: WootingRapidTriggerGroup): WootingRapidTriggerState {
  if (group.config) {
    return {
      kind: "custom",
      sensitivityMm: group.config.primarySensitivityMm,
      secondarySensitivityMm: group.config.secondarySensitivityMm,
      continuous: group.config.continuousMode,
    };
  }
  return group.enabled === false ? { kind: "off" } : { kind: "base" };
}

/**
 * Flatten firmware groups into one lookup keyed by matrix index. Groups are an
 * encoding detail: the board repacks keys and reorders groups after a write, so
 * the UI must never render group boundaries.
 */
export function buildWootingRapidTriggerMap(
  profile: Pick<WootingFullRapidTriggerProfile, "groups"> | null | undefined,
): WootingRapidTriggerMap {
  if (!profile) return EMPTY_MAP;
  const byMatrix = new Map<number, WootingRapidTriggerState>();
  const unmapped = new Map<number, WootingUnmappedRapidTriggerKey>();
  for (const group of profile.groups) {
    const state = stateForGroup(group);
    for (const matrix of group.keys) {
      byMatrix.set(matrix, state);
      const position = decodeWootingKeyIndex(matrix);
      if (!position || !wootingMatrixKeyId(position.row, position.col)) {
        unmapped.set(matrix, { matrix, row: position?.row ?? null, col: position?.col ?? null, state });
      }
    }
  }
  return {
    byMatrix,
    unmapped: [...unmapped.values()].sort((a, b) => a.matrix - b.matrix),
  };
}

/** Resolve the profile base rapid trigger from `analogProfile.profileFields`. */
export function wootingRapidTriggerBase(
  analogProfile: { profileFields: readonly WootingProfileField[] } | null | undefined,
): WootingRapidTriggerBase {
  const fields = analogProfile?.profileFields;
  const enabled = fields?.find((entry) => entry.field === 3)?.value ?? null;
  const sensitivityRaw = fields?.find((entry) => entry.field === 4)?.value ?? null;
  const strict = fields?.find((entry) => entry.field === 7)?.value ?? null;
  return {
    enabled: enabled === null ? null : enabled !== 0,
    sensitivityMm: sensitivityRaw === null ? null : wootingActuationMm(sensitivityRaw),
    strict: strict === null ? null : strict !== 0,
    continuous: strict === null ? null : strict === 0,
  };
}

/** Wootility treats an absent `continuousMode` as false. */
export function wootingRapidTriggerStrict(continuous: boolean | null): boolean {
  return !(continuous ?? false);
}
