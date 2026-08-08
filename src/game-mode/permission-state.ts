export type LocalNetworkPermissionState = PermissionState | "checking" | "unsupported";
export type PermissionGraphic = "prompt" | "settings" | null;

export function permissionGraphicFor(
  state: LocalNetworkPermissionState,
  connected: boolean,
): PermissionGraphic {
  if (connected || state === "checking" || state === "granted" || state === "unsupported") return null;
  return state === "denied" ? "settings" : "prompt";
}
