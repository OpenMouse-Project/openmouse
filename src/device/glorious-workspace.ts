import type {
  GloriousAnalog,
  GloriousBoardState,
  GloriousLayerKeys,
  GloriousMacro,
  GloriousModel,
} from "@openmouse/keyboard-protocol/glorious";

/**
 * What a Glorious keyboard was last sent. The board reports none of its
 * settings, so this is OpenMouse's own record, kept per board in local
 * storage. Writes stay off until the owner turns them on.
 */
export interface GloriousWorkspace {
  model: GloriousModel;
  state: GloriousBoardState;
  unlocked: boolean;
}

export type GloriousCommand =
  | { kind: "gloriousUnlock"; unlocked: boolean }
  | { kind: "gloriousPolling"; hz: number }
  | { kind: "gloriousDebounce"; ms: number }
  | { kind: "gloriousSleep"; minutes: number }
  | { kind: "gloriousProfile"; profile: number }
  | { kind: "gloriousLayer"; layer: number }
  | { kind: "gloriousKeys"; keys: GloriousLayerKeys }
  | { kind: "gloriousAnalog"; analog: GloriousAnalog }
  /** `slot` null stores the macro in the first free slot. */
  | { kind: "gloriousMacroSave"; slot: number | null; macro: GloriousMacro }
  | { kind: "gloriousMacroDelete"; slot: number };
