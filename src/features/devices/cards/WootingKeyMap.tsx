import type { CSSProperties, ReactNode } from "react";
import type { WootingAnalogSnapshot } from "@openmouse/keyboard-protocol/drivers";
import { t } from "../../../i18n/index";
import type { InterfaceLocale } from "../../settings/interface-preferences";
import { WOOTING_60_LAYOUT, WOOTING_KEY_MATRIX_INDEX } from "./wooting-layout";
import type { WootingRapidTriggerBase, WootingRapidTriggerState } from "./wooting-rapid-trigger";

const MAX_TRAVEL_MM = 4;

/**
 * 60% keyboard drawing. Each key shows its actuation point and its effective
 * rapid-trigger setting: the per-key override when it has one (accent), the
 * profile base otherwise. A key also fills with its travel from the last
 * analog snapshot. Unknown values are left out.
 */
export function WootingKeyMap({ snapshot, locale, defaultMm, overrides, rapidTrigger, rapidTriggerBase, selected, disabled, onSelect }: {
  snapshot: WootingAnalogSnapshot | null | undefined;
  locale: InterfaceLocale;
  defaultMm: number | null;
  /** Per-key actuation overrides by matrix index. */
  overrides: ReadonlyMap<number, number>;
  /** Per-key rapid-trigger state by matrix index; missing keys follow the profile. */
  rapidTrigger: ReadonlyMap<number, WootingRapidTriggerState>;
  rapidTriggerBase: WootingRapidTriggerBase;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onSelect: (id: string) => void;
}): ReactNode {
  const travel = new Map<number, number>();
  if (snapshot?.available) for (const key of snapshot.keys) travel.set(key.usage, key.mm);
  return (
    <div className="wooting-map" role="group" aria-label={t(locale, "kb.wootingMap")}>
      <div className="wooting-map-body">
        {WOOTING_60_LAYOUT.map((row, index) => (
          <div className="wooting-map-row" key={index}>
            {row.map((key) => {
              const pressed = key.usage == null ? undefined : travel.get(key.usage);
              const matrix = WOOTING_KEY_MATRIX_INDEX.get(key.id) ?? null;
              const custom = matrix === null ? undefined : overrides.get(matrix);
              const rapid = matrix === null ? undefined : rapidTrigger.get(matrix);
              const mm = matrix === null ? null : custom ?? defaultMm;
              const rapidMm = rapid?.kind === "custom"
                ? rapid.sensitivityMm
                : rapid?.kind === "off" || rapidTriggerBase.enabled === false
                  ? null
                  : rapidTriggerBase.sensitivityMm;
              const rapidText = rapid?.kind === "off" || (rapid?.kind !== "custom" && rapidTriggerBase.enabled === false)
                ? t(locale, "kb.wootingRtOff")
                : rapidMm == null ? null : rapidMm.toFixed(2);
              const style = { gridColumn: `span ${key.width}`, "--travel": pressed ? Math.min(1, pressed / MAX_TRAVEL_MM) : 0 } as CSSProperties;
              const className = `wooting-key${pressed ? " is-down" : ""}${custom !== undefined ? " has-override" : ""}${rapid?.kind === "custom" ? " has-rt-custom" : rapid?.kind === "off" ? " has-rt-off" : ""}${selected.has(key.id) ? " is-selected" : ""}`;
              return (
                <button type="button" key={key.id} className={className} style={style}
                  disabled={disabled || matrix === null} aria-pressed={selected.has(key.id)} onClick={() => onSelect(key.id)}>
                  <span className="wooting-key-label">{key.label}</span>
                  {mm == null ? null : <span className="wooting-key-mm">{mm.toFixed(2)}</span>}
                  {rapidText == null ? null : <span className="wooting-key-rt-value">{"RT "}{rapidText}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}


