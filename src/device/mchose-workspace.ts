import type {
  MchoseAction,
  MchoseAdvancedKeys,
  MchoseDks,
  MchoseInfo,
  MchoseKeyTravel,
  MchoseKeyTravelUpdate,
  MchoseLayoutKey,
  MchoseLighting,
  MchoseMacro,
  MchoseModTap,
  MchosePerformance,
  MchoseProduct,
  MchoseRgb,
  MchoseSettings,
} from "@openmouse/keyboard-protocol/mchose";
import type { MchoseProfileFile } from "./mchose-profile-file.ts";

/** Everything the MCHOSE panel shows, as the keyboard last confirmed it. */
export interface MchoseWorkspace {
  product: MchoseProduct;
  info: MchoseInfo;
  /** Active on-board profile; everything per-profile below belongs to it. */
  profile: number;
  profileCount: number;
  /** Names as stored by the vendor app, by slot. */
  profileNames: readonly (string | null)[];
  /** Keys with matrix slots from this keyboard's default keymap. */
  layout: readonly MchoseLayoutKey[];
  performance: MchosePerformance | null;
  settings: MchoseSettings | null;
  lighting: MchoseLighting | null;
  /** Key-travel records by matrix slot (128), in the firmware's own steps. */
  travel: readonly MchoseKeyTravel[];
  /** Keymap by layer (4), then matrix slot. */
  keymap: readonly (readonly MchoseAction[])[];
  /** Factory keymap by layer, for "restore" and keycap labels. */
  defaults: readonly (readonly MchoseAction[])[];
  advanced: MchoseAdvancedKeys | null;
  /** Shared by every profile. */
  macros: readonly MchoseMacro[] | null;
  /** Per-key colours of the Custom effect, by matrix slot. */
  colors: readonly MchoseRgb[] | null;
}

export type MchoseAdvancedBinding =
  | { kind: "dks"; dks: MchoseDks }
  | { kind: "modTap"; entry: MchoseModTap; holdMs: number }
  | { kind: "toggle"; action: MchoseAction };

export type MchoseCommand =
  | { kind: "mchoseTravel"; updates: readonly MchoseKeyTravelUpdate[] }
  | { kind: "mchosePolling"; hz: number }
  | { kind: "mchoseWinLock"; locked: boolean }
  | { kind: "mchoseProfile"; profile: number }
  | { kind: "mchoseSettings"; settings: MchoseSettings }
  | { kind: "mchoseLighting"; lighting: MchoseLighting }
  | { kind: "mchoseKeyColors"; updates: readonly { index: number; color: MchoseRgb }[] }
  | { kind: "mchoseKeymap"; layer: number; updates: readonly { index: number; action: MchoseAction }[] }
  | { kind: "mchoseMacros"; macros: readonly MchoseMacro[] }
  | { kind: "mchoseAdvanced"; layer: number; index: number; binding: MchoseAdvancedBinding }
  | { kind: "mchoseAdvancedClear"; layer: number; index: number }
  /** Pair two keys as rapid snap or SOCD; `priority` is the SOCD rule (0-3). */
  | { kind: "mchosePair"; layer: number; first: number; second: number; pair: "snapTap" | "socd"; priority?: number }
  | { kind: "mchoseProfileName"; profile: number; name: string }
  /** Replace everything the active profile holds with a saved profile file. */
  | { kind: "mchoseImport"; file: MchoseProfileFile }
  /** The vendor app's factory reset: the active profile, or the whole keyboard. */
  | { kind: "mchoseReset"; scope: "profile" | "all" }
  | { kind: "mchoseCalibrate"; step: "start" | "end" | "restart" };
