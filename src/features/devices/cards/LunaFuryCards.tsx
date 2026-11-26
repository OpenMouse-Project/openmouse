import type { ReactNode } from "react";
import type { LunaFuryButton } from "@openmouse/protocol/lamzu";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { t, type I18nKey } from "../../../i18n/index";
import { Segmented, StepperSlider, SwitchRow } from "../../../shared/ui";

export function LunaFuryButtonsCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const settings = snapshot.status?.lunafury;
  if (!settings) return null;
  const locale = snapshot.preferences.locale;
  const busy = snapshot.settingInProgress || snapshot.settingsPending;
  const staged = snapshot.pending.keys.some((key) => key.startsWith("lunafury-button-") || key === "lunafury-lightning");
  const buttons: Array<{ button: LunaFuryButton; value: number | undefined; label: I18nKey; min: number; max: number }> = [
    { button: "left", value: settings.leftDebounceMs, label: "luna.leftDebounce", min: 0, max: 15 },
    { button: "right", value: settings.rightDebounceMs, label: "luna.rightDebounce", min: 0, max: 15 },
    { button: "middle", value: settings.middleDebounceMs, label: "luna.middleDebounce", min: 1, max: 30 },
  ];
  return (
    <article id="lunafury-buttons" className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lunafury-lightning lunafury-button-left lunafury-button-right lunafury-button-middle">
      <div className="setting-heading compact"><div><h2>{t(locale, "luna.buttons")}</h2></div></div>
      {settings.lightningMode != null ? (
        <div className="field-label spaced">
          <span>{t(locale, "luna.lightning")}</span>
          <Segmented
            ariaLabel={t(locale, "luna.lightning")}
            className="three"
            options={[
              { value: 1, label: t(locale, "luna.leftPriority") },
              { value: 0, label: t(locale, "common.off") },
              { value: 2, label: t(locale, "luna.rightPriority") },
            ]}
            value={settings.lightningMode}
            disabled={busy}
            onChange={(mode) => control.applyLunaFuryLightningMode(mode as 0 | 1 | 2)}
          />
        </div>
      ) : null}
      {buttons.map(({ button, value, label, min, max }) => value == null ? null : (
        <StepperSlider
          key={button}
          id={`lunafury-${button}-latency`}
          label={t(locale, label)}
          value={value}
          min={min}
          max={max}
          step={1}
          scale={[`${min} ms`, `${button === "middle" ? 15 : 7} ms`, `${max} ms`]}
          formatValue={(shown) => `${shown} ms`}
          disabled={busy || (button === "left" && settings.lightningMode === 1) || (button === "right" && settings.lightningMode === 2)}
          pendingKey={`lunafury-button-${button}`}
          onCommit={(milliseconds) => control.applyLunaFuryButtonDebounce(button, milliseconds)}
        />
      ))}
    </article>
  );
}

export function LunaFuryWheelCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const guard = snapshot.status?.lunafury?.wheelGuard;
  if (!guard) return null;
  const locale = snapshot.preferences.locale;
  const busy = snapshot.settingInProgress || snapshot.settingsPending;
  const staged = snapshot.pending.keys.includes("lunafury-wheel-guard");
  return (
    <article id="lunafury-wheel-guard" className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lunafury-wheel-guard">
      <div className="setting-heading compact"><div><h2>{t(locale, "luna.wheelGuard")}</h2></div></div>
      <SwitchRow
        id="lunafury-wheel-guard-toggle"
        label={t(locale, "luna.wheelGuard")}
        value={guard.enabled}
        disabled={busy}
        onChange={(enabled) => control.applyLunaFuryWheelGuard({ enabled, windowMs: guard.windowMs || 100 })}
      />
      {guard.enabled ? (
        <StepperSlider
          id="lunafury-wheel-guard-window"
          label={t(locale, "luna.wheelGuardWindow")}
          value={guard.windowMs}
          min={20}
          max={200}
          step={20}
          scale={["20 ms", "100 ms", "200 ms"]}
          formatValue={(shown) => `${shown} ms`}
          disabled={busy}
          pendingKey="lunafury-wheel-guard"
          onCommit={(windowMs) => control.applyLunaFuryWheelGuard({ enabled: true, windowMs })}
        />
      ) : null}
    </article>
  );
}
