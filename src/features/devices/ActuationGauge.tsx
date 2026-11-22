import { t } from "../../i18n/index";
import type { InterfaceLocale } from "../settings/interface-preferences";

export function ActuationGauge({ value, min, max, disabled, locale }: {
  value: number | null; min: number; max: number; disabled: boolean;
  locale: InterfaceLocale;
}) {
  return <div className="actuation-gauge" data-disabled={disabled}>
    <div className="actuation-ticks" aria-hidden="true">
      {Array.from({ length: max - min + 1 }, (_, i) => <i key={i} data-current={value === min + i}
        data-zone={i < 3 ? "easy" : i < 7 ? "recommended" : "hard"} />)}
    </div>
    <div className="actuation-legend">
      <span data-zone="easy">{t(locale, "magnetic.easy")}</span>
      <span data-zone="recommended">{t(locale, "magnetic.recommended")}</span>
      <span data-zone="hard">{t(locale, "magnetic.hard")}</span>
    </div>
  </div>;
}
