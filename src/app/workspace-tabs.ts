import { WORKSPACE_TAB_ORDER, type WorkspaceTab } from "../device/types.ts";
import type { CardAvailability } from "./cards/availability.ts";

export function availableWorkspaceTabs(
  connected: boolean,
  has: CardAvailability,
  options: { hideLighting?: boolean } = {},
): readonly WorkspaceTab[] {
  if (!connected) return WORKSPACE_TAB_ORDER;
  const hasButtons = has.eggButtons || has.razerButtons || has.mxMasterButtons || has.atkButtons
    || has.buttonMapping || has.debounce || has.lightforce || has.eggSpdt || has.superstrike || has.magnetic
    || has.ksnakeScroll || has.lunafuryButtons || has.lunafuryWheelGuard || has.tmrDs;
  const hasProfiles = has.profiles || has.keychronNapeLayers || has.atkProfile
    || has.onboardProfiles || has.pulsarPro;
  return WORKSPACE_TAB_ORDER.filter((tab) => {
    if (tab === "lighting") return !options.hideLighting && (has.lighting || has.teevolutionDpiLighting);
    if (tab === "buttons") return hasButtons;
    if (tab === "macro") return has.ksnakeMacros || has.wallhackMacros;
    if (tab === "profiles") return hasProfiles;
    return true;
  });
}

export function availableWorkspaceTab(
  current: WorkspaceTab,
  tabs: readonly WorkspaceTab[],
): WorkspaceTab {
  return tabs.includes(current) ? current : "overview";
}
