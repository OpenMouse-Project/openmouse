import type { GameProfileSnapshot } from "../../device/game-profile-snapshot";

const BRIDGE_URL = "http://127.0.0.1:17846";
const BRIDGE_TIMEOUT_MS = 1_500;
// Native settings writes go through a real hardware channel Bridge alone can
// reach (e.g. a libusb claim on an interface WebHID cannot see), so they get
// a much longer budget than the plain REST calls above.
const BRIDGE_NATIVE_TIMEOUT_MS = 12_000;

export interface BridgeStatus {
  version: string;
  platform: string;
  linuxDistribution: string | null;
  uptimeSeconds: number;
  activeGames: string[];
  trackedGameCount: number;
  batteryThresholdPercent: number;
  autostartEnabled: boolean;
  foregroundApplication: BridgeApplication | null;
  activeProfile: BridgeProfile | null;
  visibleApplicationCount: number;
  profileCount: number;
  clientConnected: boolean;
}

export interface BridgeTargetMetadata {
  activation?: "running" | "focused";
  bundlePath?: string;
  bundleIdentifier?: string;
}

export interface BridgeApplication extends BridgeTargetMetadata {
  name: string;
  executable: string;
  path: string;
  foreground: boolean;
  iconId: string;
}

export function bridgeIconUrl(iconId: string): string {
  return `${BRIDGE_URL}/v1/applications/${encodeURIComponent(iconId)}/icon`;
}

export function bridgeApplicationIconUrl(application: BridgeApplication): string {
  return bridgeIconUrl(application.iconId);
}

export interface BridgeProfile {
  application: Pick<BridgeApplication, "name" | "executable" | "path"> & BridgeTargetMetadata & { localId?: string };
  device: { id: string; name: string };
  /**
   * False keeps the profile stored without Bridge ever matching it (the
   * game's automatic apply is off). Absent means enabled: Bridge versions
   * before the flag only stored active profiles.
   */
  enabled?: boolean;
  settings: {
    dpi: number | null;
    pollingRateHz: number | null;
    /**
     * Every other setting the profile changes. Bridge stores it untouched;
     * only DPI and polling rate above are applied natively (Pulsar), the rest
     * is applied by an open OpenMouse tab over WebHID.
     */
    snapshot?: GameProfileSnapshot | null;
  };
}

export interface BridgeGame extends BridgeTargetMetadata {
  name: string;
  executables: string[];
  id?: string;
  source?: "preset" | "local";
  path?: string;
  kind?: "game" | "app";
  /** Bridge's icon for a local target; missing from older Bridge builds. */
  iconId?: string;
}

export interface LocalApplication extends BridgeTargetMetadata {
  id: string;
  name: string;
  executable: string;
  path: string;
  kind: "game" | "app";
  /** Read-only: Bridge derives it from the path, so it is never sent back. */
  iconId?: string;
}

export class BridgeHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Bridge returned HTTP ${status}.`);
    this.status = status;
  }
}

export async function bridgeLocalApplications(signal?: AbortSignal): Promise<LocalApplication[]> {
  return bridgeRequest<LocalApplication[]>("/v1/local-applications", undefined, signal);
}

export async function saveBridgeLocalApplications(applications: LocalApplication[]): Promise<void> {
  await bridgeRequest("/v1/local-applications", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applications: applications.map(({ iconId: _iconId, ...application }) => application) }),
  });
}

export async function bridgeStatus(signal?: AbortSignal): Promise<BridgeStatus> {
  return bridgeRequest<BridgeStatus>("/v1/status", undefined, signal);
}

export async function bridgeHandshake(signal?: AbortSignal): Promise<void> {
  await bridgeRequest("/v1/handshake", { method: "PUT" }, signal);
}

export async function bridgeApplications(signal?: AbortSignal): Promise<BridgeApplication[]> {
  return bridgeRequest<BridgeApplication[]>("/v1/applications", undefined, signal);
}

/**
 * Every visible application, not just the registered games `/v1/applications`
 * is limited to — the picker in GameRequestDialog. Bridge versions before the
 * endpoint answer 404, which callers treat like an empty list.
 */
export async function bridgeRunningApplications(signal?: AbortSignal): Promise<BridgeApplication[]> {
  return bridgeRequest<BridgeApplication[]>("/v1/running-applications", undefined, signal);
}

export async function bridgeProfiles(signal?: AbortSignal): Promise<BridgeProfile[]> {
  return bridgeRequest<BridgeProfile[]>("/v1/profiles", undefined, signal);
}

export async function bridgeGames(signal?: AbortSignal): Promise<BridgeGame[]> {
  return bridgeRequest<BridgeGame[]>("/v1/games", undefined, signal);
}

export async function saveBridgeProfiles(profiles: BridgeProfile[]): Promise<void> {
  await bridgeRequest("/v1/profiles", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profiles }),
  });
}

/** The profile Bridge uses whenever no game's is active, or null when none is saved. */
export async function bridgeDefaultProfile(signal?: AbortSignal): Promise<BridgeProfile | null> {
  return bridgeRequest<BridgeProfile | null>("/v1/default-profile", undefined, signal);
}

export async function saveBridgeDefaultProfile(profile: BridgeProfile): Promise<void> {
  await bridgeRequest("/v1/default-profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}


export interface BridgeBatteryReading {
  deviceId: string;
  deviceName: string;
  percent: number;
  charging: boolean;
  /** The settings currently in the mouse's onboard memory, when the panel
   * can see them — Bridge's tray panel shows them next to the battery. */
  dpi?: number;
  pollingRateHz?: number;
  switchMode?: string;
}

export async function saveBridgeBattery(
  reading: BridgeBatteryReading,
  signal?: AbortSignal,
): Promise<void> {
  await bridgeRequest("/v1/battery", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reading),
  }, signal);
}

/**
 * Ask Bridge to apply settings on a device it controls natively, bypassing
 * WebHID entirely (e.g. the Attack Shark X11 family, whose config channel is
 * an interface a browser is never allowed to open — see
 * `attackSharkNativeOnlyMessage` in @openmouse/protocol). Bridge itself claims
 * the hardware and applies the change, which can take longer than a normal
 * status round-trip.
 */
export async function applyBridgeNativeSettings(settings: {
  brand: string;
  dpi?: number;
  pollingRateHz?: number;
}): Promise<void> {
  await bridgeRequest("/v1/native/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }, undefined, BRIDGE_NATIVE_TIMEOUT_MS);
}

async function bridgeRequest<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
  timeoutMs = BRIDGE_TIMEOUT_MS,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    headers: { Accept: "application/json" },
    ...init,
    signal: combined,
  });
  if (!response.ok) throw new BridgeHttpError(response.status);
  return await response.json() as T;
}
