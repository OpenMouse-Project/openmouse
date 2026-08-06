/**
 * Mirrors OpenMouseCompanion's Protocol/RecipeModels.cs + Messages.cs field
 * for field. The companion's WebSocket layer serializes with camelCase
 * properties and camelCase string enums (System.Text.Json Web defaults +
 * JsonStringEnumConverter), so these types line up with the wire format
 * directly — no translation layer on either side.
 */

export type RecipeStepKind = "write" | "delay" | "readExpect";
export type HidReportKind = "output" | "feature";
export type ReportFingerprintKind = "input" | "output" | "feature";

export interface RecipeStep {
  kind: RecipeStepKind;
  reportKind?: HidReportKind;
  reportId?: number;
  /** base64 — matches System.Text.Json's default byte[] wire format. */
  payload?: string;
  fromInputReport?: boolean;
  expectMask?: string;
  expectValue?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  delayMs?: number;
}

export interface ReportFingerprint {
  kind: ReportFingerprintKind;
  reportId: number;
  length: number;
}

export interface CollectionFingerprint {
  usages: number[];
  reports: ReportFingerprint[];
}

export interface EnrollDeviceMessage {
  type: "enrollDevice";
  deviceKey: string;
  vendorId: number;
  productId: number;
  brand: string;
  name: string;
  fingerprint: CollectionFingerprint;
  idleSteps: RecipeStep[];
  gamingSteps: RecipeStep[];
  idleRateHz: number;
  gamingRateHz: number;
}

export interface DeviceStatus {
  deviceKey: string;
  brand: string | null;
  name: string | null;
  gameModeEnabled: boolean;
  idleRateHz: number | null;
  gamingRateHz: number | null;
}

export interface StatusMessage {
  type: "status";
  isGaming: boolean;
  reason: string;
  devices: DeviceStatus[];
}
