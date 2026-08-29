const BRIDGE_URL = "http://127.0.0.1:17846";
const BRIDGE_TIMEOUT_MS = 1_500;

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

/**
 * A mouse the Bridge can reach natively — used for devices whose config
 * channel the browser cannot touch (e.g. the Attack Shark X11, whose settings
 * live on HID collections Chrome protects). `null` fields mean "not readable".
 */
export interface BridgeDevice {
  id: string;
  name: string;
  vendorId: number;
  productId: number;
  connection: "wired" | "wireless";
  /** True when the Bridge claimed the control interface and can send commands. */
  controllable: boolean;
  batteryPercent: number | null;
  pollingRateHz: number | null;
  supportedPollingRates: number[];
  /** DPI stages as last written through the Bridge (the mouse doesn't report them). */
  dpiStages: number[];
  /** Active DPI stage, 1-based. */
  activeDpiStage: number;
  dpiMin: number;
  dpiMax: number;
  dpiStep: number;
  note: string;
}

export async function bridgeDevices(signal?: AbortSignal): Promise<BridgeDevice[]> {
  return bridgeRequest<BridgeDevice[]>("/v1/devices", undefined, signal);
}

export async function setBridgeDevicePolling(id: string, hz: number): Promise<number> {
  const result = await bridgeRequest<{ ok: boolean; pollingRateHz: number }>(
    `/v1/devices/${encodeURIComponent(id)}/polling`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hz }),
    },
  );
  return result.pollingRateHz;
}

/** Write the six DPI stages and the active stage (1-based) to a Bridge device. */
export async function setBridgeDeviceDpi(
  id: string,
  stages: number[],
  activeStage: number,
): Promise<void> {
  await bridgeRequest(
    `/v1/devices/${encodeURIComponent(id)}/dpi`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stages, activeStage }),
    },
  );
}

/**
 * Install or remove the WinUSB driver package (Windows only) that lets the
 * Bridge reach a mouse whose config interface the HID stack blocks — e.g. the
 * Attack Shark X11. This shows a Windows UAC prompt, so it is given a long
 * timeout to allow for the elevation dialog.
 */
export async function setBridgeDriver(action: "install" | "uninstall"): Promise<void> {
  await bridgeRequest(
    "/v1/driver",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
    undefined,
    180_000,
  );
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

async function bridgeRequest<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
  timeoutMs: number = BRIDGE_TIMEOUT_MS,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    headers: { Accept: "application/json" },
    ...init,
    signal: combined,
  });
  if (!response.ok) {
    // The Bridge returns a plain-text reason for 4xx/5xx (e.g. a signing error
    // from the driver install); surface it instead of a bare status code.
    const detail = await response.text().catch(() => "");
    throw new Error(detail.trim() || `Bridge returned HTTP ${response.status}.`);
  }
  return await response.json() as T;
}
