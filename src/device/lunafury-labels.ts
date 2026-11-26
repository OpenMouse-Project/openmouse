import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";
import { t, type I18nKey } from "../i18n/index.ts";
import type { InterfaceLocale } from "../features/settings/interface-preferences.ts";

// Names verified against LunaFury's language.js and patternModule.vue.
// Its Competitive Mode calls setHyperMode (0x0b), while Tracking Mode
// calls setTrackingMode (0x13), exposed by the shared driver as performanceMode.
const LABEL_KEYS = {
  angleSnapping: "luna.angleSnap",
  hyperMode: "luna.competitiveMode",
  performanceMode: "luna.trackingMode",
  motionSync: "luna.motionSync",
  rippleControl: "luna.rippleControl",
} as const satisfies Record<string, I18nKey>;

export function lunafurySettingLabel(
  status: Pick<MouseStatus, "brand"> | null | undefined,
  locale: InterfaceLocale,
  setting: string,
): string | undefined {
  if (status?.brand !== "LunaFury" || !Object.hasOwn(LABEL_KEYS, setting)) return undefined;
  return t(locale, LABEL_KEYS[setting as keyof typeof LABEL_KEYS]);
}

/** Match the vendor's v-if="competition": hide tracking until competitive
 * mode is known to be on, without resetting the stored tracking setting. */
export function lunafuryTrackingVisible(
  status: Pick<MouseStatus, "brand" | "hyperMode">,
): boolean {
  return status.brand !== "LunaFury" || status.hyperMode === true;
}

/** Establish competitive mode before staged tracking edits, or leave it
 * enabled until those edits finish when switching competitive mode off. */
export function lunafurySettingPriority(
  status: Pick<MouseStatus, "brand"> | null,
  setting: string,
  enabled: boolean,
): number | undefined {
  return status?.brand === "LunaFury" && setting === "hyperMode"
    ? enabled ? -1 : 1 : undefined;
}
