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

export interface BridgeApplication {
  name: string;
  executable: string;
  path: string;
  foreground: boolean;
  iconId: string;
}

export function bridgeApplicationIconUrl(application: BridgeApplication): string {
  return `${BRIDGE_URL}/v1/applications/${encodeURIComponent(application.iconId)}/icon`;
}

export interface BridgeProfile {
  application: Pick<BridgeApplication, "name" | "executable" | "path">;
  device: { id: string; name: string };
  settings: { dpi: number | null; pollingRateHz: number | null };
}

export interface BridgeGame {
  name: string;
  executables: string[];
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
  if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}.`);
  return await response.json() as T;
}
