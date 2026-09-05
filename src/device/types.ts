import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import type { KeychronNapeLayerKeymap } from "@openmouse/protocol/keychron";
import type { LogitechReprogrammableControl } from "@openmouse/protocol/logitech";
import type { DpiStageCapabilities, DpiStagePlan, OnboardProfile } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import type { InterfacePreferences } from "../interface-preferences";
import type { PreviewMode } from "../preview-modes";
import type { DriverTraits } from "./traits";

export type WorkspaceTab = "overview" | "performance" | "lighting" | "buttons" | "profiles" | "advanced";

export const WORKSPACE_TAB_ORDER: readonly WorkspaceTab[] = [
  "overview",
  "performance",
  "lighting",
  "buttons",
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
  sleepOptions: number[] | null;
  debounceMaxMs: number | null;
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

export interface AnalogTuning {
  actuation: number;
  rapidTrigger: number;
  haptics: number;
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

  preferences: InterfacePreferences;
  sidebarHidden: boolean;
  interfaceSettingsOpen: boolean;
  workspaceTab: WorkspaceTab;

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
  stagedProfileButtonAssignments: StagedProfileButtonAssignment[];
  /** Nape Pro VIA keymap for the layer currently open in the Buttons tab. */
  napeKeymap: KeychronNapeLayerKeymap | null;
  /** Unflashed Nape Pro button and wheel remaps, including other layers. */
  stagedNapeAssignments: StagedNapeAssignment[];
  /** Nape Pro layer currently open in the Profiles tab, or null when unread. */
  editedNapeLayer: number | null;
  analogTuning: AnalogTuningState;
  eggPollingDivider: number | null;

  pending: PendingView;
  diagnostics: DiagnosticsView;
  diagnosticsOpen: boolean;
  captureAvailable: boolean;
  resetProfilesAvailable: boolean;

  previewMode: PreviewMode | null;
  previewEnabled: boolean;
  previewEntries: Array<[string, string]>;
  previewListMessage: string | null;
  buildLabel: string;
}
