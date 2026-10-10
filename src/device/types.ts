import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { KsnakeMacroProfile } from "@openmouse/protocol/ksnake";
import type { KeychronNapeLayerKeymap } from "@openmouse/protocol/keychron";
import type { LogitechReprogrammableControl } from "@openmouse/protocol/logitech";
import type { WallhackCurvePoint, WallhackMacroStep } from "@openmouse/protocol/wallhack";
import type { DpiStageCapabilities, DpiStagePlan, OnboardProfile } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import type { InterfacePreferences } from "../interface-preferences";
import type { PreviewMode } from "../preview-modes";
import type { DriverTraits } from "./traits";
import type { M2NexProfile } from "./m2nex-profiles";

export type WorkspaceTab = "overview" | "performance" | "buttons" | "macro" | "lighting" | "profiles" | "advanced";

export const WORKSPACE_TAB_ORDER: readonly WorkspaceTab[] = [
  "overview",
  "performance",
  "buttons",
  "macro",
  "lighting",
  "profiles",
  "advanced",
];

export type LiftOffLevel = NonNullable<MouseStatus["liftOffDistance"]>;
export type PulsarToggleSetting =
  | "motionSync"
  | "angleSnapping"
  | "rippleControl"
  | "performanceMode"
  | "hyperMode"
  | "turboMode"
  | "buttonCombination"
  | "longRangeMode";

export interface TeevolutionProfile {
  sleepOptions: readonly number[];
  debounce: { max: number };
  performanceTimeOptions: readonly number[];
  sensorModes: readonly ("Eco" | "High")[];
  dpiLighting: {
    modes: readonly (0 | 1 | 2)[];
    brightness: { min: number; max: number };
    speed: { min: number; max: number };
  };
}

export interface DeviceCapabilities {
  canDisableSleep: boolean;
  angleTuningWritable: boolean;
  /** Whether the connected driver can write DPI stage table values, or reports the table read-only. */
  dpiStagesWritable: boolean;
  /** Whether the connected driver can select which DPI stage is active. */
  activeDpiStageWritable: boolean;
  sleepOptions: number[] | null;
  debounceMaxMs: number | null;
  debounceOptions?: number[] | null;
  razerSleepOptions: number[] | null;
  razerLowPowerOptions: number[] | null;
  lowPowerPollingCeiling: number | null;
  teevolutionProfile: TeevolutionProfile | null;
}

export interface SidebarDevice {
  index: number;
  name: string;
  detail: string;
  selected: boolean;
  vendorId: number;
  productId: number;
  kind: "mouse" | "keyboard";
  /** "bridge" when this device was opened through OpenMouse Bridge's native
   *  HID socket rather than the browser's own WebHID (see bridge-hid.ts). */
  transport: "bridge" | "webhid";
}

export interface DiagnosticsView {
  overview: Array<[string, string]>;
  snapshot: string;
  reads: string;
  downloadReady: boolean;
  downloadStatus: string;
}

export interface PendingView {
  count: number;
  labels: string[];
  busy: boolean;
  statusText: string | null;
  suppressed: boolean;
  keys: readonly string[];
}

export interface MagneticCalibrationView {
  phase: "idle" | "running" | "done" | "failed";
  message: string;
  left: number;
  right: number;
  step: number;
  steps: number;
}

export interface AnalogTuning {
  actuation: number;
  rapidTrigger: number;
  haptics: number;
  /** Rapid trigger on/off. Undefined when the mouse does not report it. */
  rapidTriggerEnabled?: boolean;
}

export interface AnalogTuningState {
  mode: "independent" | "both";
  left: AnalogTuning;
  right: AnalogTuning;
  both: AnalogTuning;
}

export interface StagedProfileButtonAssignment {
  layer: "primary" | "g-shift";
  button: number;
  value: string;
}

export type NapeAssignmentControl =
  | { kind: "key"; col: number }
  | { kind: "wheel"; clockwise: boolean }
  | { kind: "orientation" };

export interface StagedNapeAssignment {
  layer: number;
  control: NapeAssignmentControl;
  action: string;
  keycode: number;
}

export interface ProfileView {
  entry: OnboardProfile | null;
  summary: { name: string; detail: string };
  slotsAvailable: boolean;
  slotsLocked: boolean;
  slotLimits: DpiStageCapabilities | null;
  lodLevels: readonly string[];
  rateOptions: { wireless: number[]; wired: number[] };
  ratesPerProfile: boolean;
  ratesShared: boolean;
  ratesLocked: boolean;
  bunnyHopSupported: boolean;
}

export type ToastKind = "success" | "error" | "warning" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  action?: {
    label: string;
    href: string;
  };
  prominent?: boolean;
  persistent?: boolean;
  leaving?: boolean;
}

export interface ControlSnapshot {
  deviceStatus: MouseStatus | null;
  status: MouseStatus | null;
  traits: DriverTraits;
  capabilities: DeviceCapabilities | null;
  settingsPending: boolean;

  deviceStatusText: string;
  readStatus: string;
  onboardStatus: string;
  connectDisabled: boolean;
  connectLabel: string;

  toasts: Toast[];

  devices: SidebarDevice[];
  hasActiveDevice: boolean;
  deviceArtwork: string | null;
  settingInProgress: boolean;
  atkR1SePlusPairingAvailable: boolean;

  /**
   * Receiver's own firmware (HID++ 1.0 register 0xF1), read once per
   * wireless Logitech connection on the same interface (device 0xFF).
   * Null when wired, non-Logitech, or unreadable — the mouse card is
   * unaffected either way.
   */
  /**
   * Per-MCU firmware readouts from the receiver (HID++ 1.0 register 0xF1,
   * one (mcu, index) combo each). MCU numbering follows the dfu package
   * target entities (MCU1/MPR7, MCU2/CC14). Versions are dotted-decimal
   * triplets of the raw reply bytes; their mapping to package versions is
   * established empirically (see firmware-updates.ts).
   */
  receiverFirmware: { interfaceId: string; mcus: Array<{ mcu: number; version: string | null; raw: number[] }> } | null;

  preferences: InterfacePreferences;
  sidebarHidden: boolean;
  interfaceSettingsOpen: boolean;
  workspaceTab: WorkspaceTab;
  /** "list" shows the welcome/cross-device picker, "device" shows the opened dashboard. */
  deviceView: "list" | "device";

  dpiOptions: number[];
  customDpiEditing: boolean;
  customDpiText: string;

  onboardProfiles: OnboardProfile[] | null;
  /**
   * Reprogrammable controls, or null on a mouse that has none. Two round-trips
   * per control is too much for the refresh poll, so this is read on connect
   * and after a write rather than alongside the status.
   */
  buttons: LogitechReprogrammableControl[] | null;
  editedProfile: number | "host" | null;
  profilesExpanded: boolean;
  deviceMode: MouseStatus["deviceMode"];
  profileFormat: MouseStatus["onboardProfileFormat"];
  profile: ProfileView;
  dpiSlotPlan: DpiStagePlan | null;
  dpiAxisLocks: boolean[];
  stagedBunnyHopMs: number | null;
  stagedProfileRates: { wireless: number | null; wired: number | null };
  stagedProfileName: string | null;
  /** Control id → staged remap target, for controls with an unflashed remap. */
  stagedButtonMappings: Record<number, number>;
  /** M2-NEX/K-snake onboard macro slots, prepared locally for a full-table write. */
  ksnakeMacros: KsnakeMacroProfile[] | null;
  ksnakeMacrosLoading: boolean;
  ksnakeMacrosError: string | null;
  /**
   * WALLHACK M-001 onboard macro slots (4, up to 30 steps each), read from
   * the device. Empty slots are null. Macros are saved per slot, so unlike
   * ksnake there is no staged draft: the card edits a local copy and writes
   * it through applyWallhackMacroSlot.
   */
  wallhackMacros: (WallhackMacroStep[] | null)[] | null;
  wallhackMacrosLoading: boolean;
  wallhackMacrosError: string | null;
  /** WALLHACK M-001 DPI-acceleration curve tables, read on demand. */
  wallhackCurves: Record<"classic" | "natural" | "jump" | "custom", WallhackCurvePoint[]> | null;
  wallhackCurvesLoading: boolean;
  wallhackCurvesError: string | null;
  /** Local profile slots matching the M2-NEX vendor configurator. */
  m2nexProfiles: M2NexProfile[] | null;
  activeM2NexProfile: number;
  /** True when the selected local profile differs from the device. */
  m2nexProfileDirty: boolean;
  stagedProfileButtonAssignments: StagedProfileButtonAssignment[];
  /** Nape Pro VIA keymap for the layer currently open in the Buttons tab. */
  napeKeymap: KeychronNapeLayerKeymap | null;
  /** Unflashed Nape Pro button and wheel remaps, including other layers. */
  stagedNapeAssignments: StagedNapeAssignment[];
  /** Nape Pro layer currently open in the Profiles tab, or null when unread. */
  editedNapeLayer: number | null;
  analogTuning: AnalogTuningState;
  magneticCalibration: MagneticCalibrationView;
  eggPollingDivider: number | null;

  pending: PendingView;
  /** True while the Games page is editing a game profile: edits are staged into a draft that is never flashed. */
  gameProfileDraft: boolean;
  diagnostics: DiagnosticsView;
  diagnosticsOpen: boolean;
  captureAvailable: boolean;
  resetProfilesAvailable: boolean;
  /** A Logitech mouse with no stored profiles that OpenMouse can set up itself. */
  setupProfilesAvailable: boolean;

  previewMode: PreviewMode | null;
  previewEnabled: boolean;
  previewEntries: Array<[string, string]>;
  previewListMessage: string | null;
  buildLabel: string;
}
