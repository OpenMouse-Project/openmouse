/**
 * Optional UI policy from a driver (used by control.ts).
 * Drivers added in a PR should set only the flags they need so the shell
 * stays free of brand-specific branching.
 */
export interface MouseUiHints {
  /** Stable driver id, e.g. "egg-we". */
  family?: string;
  /** When false, core settings grid stays hidden. Default true. */
  settingsReady?: boolean;
  /** Hide 0.7 mm LOD option. */
  hideLodLow?: boolean;
  /** Hide the lift-off card entirely. Set when the mouse exposes no LOD control at all. */
  hideLodCard?: boolean;
  /** Hide poll rates not listed in supportedPollingRates. */
  hideUnsupportedPollingRates?: boolean;
  /** Hide Motion Sync / angle snap / ripple card. */
  hideProcessingCard?: boolean;
  /** Always show battery column (even wired with null %). */
  forceShowBattery?: boolean;
  /** Override the polling-rate footnote. */
  pollingNote?: string;
  /** Sidebar name before first status read. */
  defaultDisplayName?: string;
}

/** Reported by drivers whose device exposes controllable RGB. Absent means no lighting. */
export interface LightingCapability {
  /** Independently addressable zones. Every zone is set to the same color for now. */
  zoneCount: number;
  /** Current color as "#rrggbb", or null when the device will not report it. */
  color: string | null;
}

export interface LightingClient {
  setLighting(color: string): Promise<string>;
}

/** Structural check: a driver opts into lighting purely by having the method. */
export function supportsLighting(client: unknown): client is LightingClient {
  return typeof (client as Partial<LightingClient> | null)?.setLighting === "function";
}

export interface MouseStatus {
  brand: "Logitech" | "Pulsar" | "Endgame Gear" | "WLMouse" | "Lamzu" | "Orbital";
  name: string;
  /** Driver-supplied UI policy (optional; keeps control.ts brand-agnostic). */
  ui?: MouseUiHints;
  batteryPercent: number | null;
  batteryVoltageMv?: number | null;
  batteryState: "Charging" | "Charging slowly" | "Almost full" | "Full" | "Discharging" | "Unknown";
  dpi: number;
  dpiY?: number;
  supportsSeparateDpiAxes?: boolean;
  /** Hall-effect primary-button tuning exposed by Logitech's 0x1B0C HID++ feature. */
  analogButtonTuning?: {
    maxActuation: number;
    maxRapidTrigger: number;
    maxHaptics: number;
    buttons: Array<{ actuation: number; rapidTrigger: number; haptics: number }>;
  };
  pollingRateHz: number;
  supportedPollingRates?: number[];
  activeProfile: number | null;
  deviceMode?: "Onboard" | "Host" | "Unknown";
  unitId?: string | null;
  modelId?: string | null;
  transportIds?: Record<string, string>;
  connectionType?: "Wired" | "Wireless";
  connectionDetail?: string;
  dongleLedEnabled?: boolean | null;
  signalStrength?: number | null;
  motionSync?: boolean | null;
  debounceMs?: number | null;
  sleepTimeout?: number | null;
  angleSnapping?: boolean | null;
  rippleControl?: boolean | null;
  slamclickFilter?: boolean | null;
  motionJitterFilter?: boolean | null;
  leftSpdtMode?: "Off" | "GX Safe" | "GX Speed" | null;
  rightSpdtMode?: "Off" | "GX Safe" | "GX Speed" | null;
  eggCpiLevels?: number;
  eggCpiStages?: Array<{ x: number; y: number }>;
  eggPollingDivider?: number;
  eggMulticlickFilters?: number[];
  eggButtonMappings?: string[];
  performanceMode?: boolean | null;
  angleTuning?: number | null;
  wheelAcceleration?: boolean | null;
  lowBatteryWarning?: number | null;
  remoteLedMode1?: number | null;
  remoteLedMode2?: number | null;
  dpiLedMode?: number | null;
  dpiLedBrightness?: number | null;
  dpiLedSpeed?: number | null;
  /** Present only when the mouse exposes controllable RGB; drives the lighting card. */
  lighting?: LightingCapability | null;
  liftOffDistance: "Low" | "Medium" | "High" | null;
  /** Explicit LOD choices when a mouse does not support all three common levels. */
  supportedLiftOffDistances?: Array<NonNullable<MouseStatus["liftOffDistance"]>>;
  firmware: string[];
}
