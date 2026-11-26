// Bridge 1.0.0-beta.19 rejects any update archive over 16 MiB, so it can never
// update itself. Anything below this version has to be reinstalled by hand
// once. Raising it needs the same prompt treatment for the next release.
export const BRIDGE_MANUAL_UPDATE_BELOW = "1.0.0-beta.20";

const LATEST_DOWNLOAD = "https://github.com/OpenMouse-Project/OpenMouse-Bridge/releases/latest/download";

export const BRIDGE_LINUX_INSTALL_COMMAND = "curl -fsSL https://openmouse.app/bridge/download/install-linux.sh | bash";

export type BridgeManualInstall =
  | { platform: "macos" | "windows"; url: string }
  | { platform: "linux"; command: string };

interface Semver {
  core: number[];
  pre: string[];
}

function parseSemver(version: string): Semver | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split(".") : [] };
}

/** Semver precedence: negative when a < b. Null when either side is not a version. */
export function compareSemver(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
  }
  // A release outranks any of its own prereleases.
  if (left.pre.length === 0 || right.pre.length === 0) return left.pre.length === right.pre.length ? 0 : left.pre.length === 0 ? 1 : -1;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** True only for a parseable version below the threshold; anything else stays quiet. */
export function needsManualBridgeUpdate(version: string | null | undefined): boolean {
  if (!version) return false;
  const order = compareSemver(version, BRIDGE_MANUAL_UPDATE_BELOW);
  return order !== null && order < 0;
}

export function manualInstallFor(platform: string): BridgeManualInstall | null {
  switch (platform) {
    case "macos":
      return { platform, url: `${LATEST_DOWNLOAD}/OpenMouse-Bridge-macos-universal.dmg` };
    case "windows":
      return { platform, url: `${LATEST_DOWNLOAD}/openmouse-bridge-windows-x64.zip` };
    case "linux":
      return { platform, command: BRIDGE_LINUX_INSTALL_COMMAND };
    default:
      return null;
  }
}
