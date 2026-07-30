export interface MouseStatus {
  brand: "Logitech" | "Pulsar" | "Endgame Gear";
  name: string;
  batteryPercent: number | null;
  batteryVoltageMv?: number | null;
  batteryState: "Charging" | "Charging slowly" | "Almost full" | "Full" | "Discharging" | "Unknown";
  dpi: number;
  pollingRateHz: number;
  activeProfile: number | null;
  connectionDetail?: string;
  dongleLedEnabled?: boolean | null;
  signalStrength?: number | null;
  motionSync?: boolean | null;
  debounceMs?: number | null;
  sleepTimeout?: number | null;
  angleSnapping?: boolean | null;
  rippleControl?: boolean | null;
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
