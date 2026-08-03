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
  /** Lamzu Aurora sleep timeouts are real seconds (10..1800), not Compx codes. */
  auroraSleepSeconds?: boolean;
  /** Show Angle tune control (-30°..30°). */
  showAngleTune?: boolean;
}

export interface MouseStatus {
  brand: "Logitech" | "Pulsar" | "Endgame Gear" | "WLMouse" | "Lamzu";
  name: string;
  /** Driver-supplied UI policy (optional; keeps control.ts brand-agnostic). */
  ui?: MouseUiHints;
  batteryPercent: number | null;
  batteryVoltageMv?: number | null;
  batteryState: "Charging" | "Charging slowly" | "Almost full" | "Full" | "Discharging" | "Unknown";
  dpi: number;
  dpiY?: number;
  supportsSeparateDpiAxes?: boolean;
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
  liftOffDistance: "Low" | "Medium" | "High" | null;
  firmware: string[];
}
