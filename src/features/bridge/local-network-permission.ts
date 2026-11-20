export type LocalNetworkPermission = "granted" | "prompt" | "denied" | "unknown";

const PERMISSION_NAMES = ["loopback-network", "local-network-access", "local-network"];
const RELOAD_KEY = "openmouse.bridge-reloaded";

let current: LocalNetworkPermission = "unknown";
let watched: PermissionStatus | null = null;
const grantedListeners = new Set<() => void>();

function watch(status: PermissionStatus): void {
  if (watched === status) return;
  if (watched) watched.onchange = null;
  watched = status;
  status.onchange = () => {
    const before = current;
    const after = status.state as LocalNetworkPermission;
    if (after === before) return;
    current = after;
    if (after === "granted" && (before === "prompt" || before === "denied")) {
      for (const listener of grantedListeners) listener();
    }
  };
}

export function onLocalNetworkPermissionGranted(listener: () => void): () => void {
  grantedListeners.add(listener);
  return () => grantedListeners.delete(listener);
}

export function reloadOnceForBridge(): void {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return;
  }
  location.reload();
}

export async function refreshLocalNetworkPermission(): Promise<LocalNetworkPermission> {
  let next: LocalNetworkPermission = "unknown";
  if (typeof navigator !== "undefined" && navigator.permissions?.query) {
    for (const name of PERMISSION_NAMES) {
      try {
        const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
        next = status.state;
        watch(status);
        break;
      } catch {
        continue;
      }
    }
  }
  current = next;
  return current;
}
