const BRIDGE_URL = "http://127.0.0.1:17846";
const BRIDGE_TIMEOUT_MS = 1_500;
const BRIDGE_HEARTBEAT_MS = 5_000;

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

export async function checkBridgeConnection(signal?: AbortSignal): Promise<BridgeStatus> {
  await bridgeHandshake(signal);
  return bridgeStatus(signal);
}

export type BridgeConnection =
  | { state: "checking"; status: null }
  | { state: "connected"; status: BridgeStatus }
  | { state: "disconnected"; status: null };

export function startBridgeHeartbeat(
  onConnectionChange: (connection: BridgeConnection) => void,
): () => void {
  const controller = new AbortController();
  let checking = false;
  let firstCheck = true;

  const check = async (): Promise<void> => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    if (firstCheck) onConnectionChange({ state: "checking", status: null });
    try {
      const status = await checkBridgeConnection(controller.signal);
      if (!controller.signal.aborted) onConnectionChange({ state: "connected", status });
    } catch {
      if (!controller.signal.aborted) onConnectionChange({ state: "disconnected", status: null });
    } finally {
      checking = false;
      firstCheck = false;
    }
  };

  const checkWhenVisible = (): void => {
    if (document.visibilityState === "visible") void check();
  };

  void check();
  const heartbeat = window.setInterval(() => void check(), BRIDGE_HEARTBEAT_MS);
  window.addEventListener("focus", checkWhenVisible);
  document.addEventListener("visibilitychange", checkWhenVisible);

  return () => {
    controller.abort();
    window.clearInterval(heartbeat);
    window.removeEventListener("focus", checkWhenVisible);
    document.removeEventListener("visibilitychange", checkWhenVisible);
  };
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

async function bridgeRequest<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(BRIDGE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    headers: { Accept: "application/json" },
    ...init,
    signal: combined,
  });
  if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}.`);
  return await response.json() as T;
}
