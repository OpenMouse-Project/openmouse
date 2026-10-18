import type { ReactNode } from "react";
import type { LunaFuryButton, LunaFuryReceiverLightMode } from "@openmouse/protocol/lamzu";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { t, type I18nKey } from "../../../i18n/index";
import { OptionMenu, RateSlider, Segmented, StepperSlider, SwitchButton } from "../../../shared/ui";

export function LunaFuryBottomButtonCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const mode = snapshot.status?.lunafury?.bottomButtonMode;
  if (snapshot.status?.brand !== "LunaFury" || mode == null || snapshot.gameProfileDraft) return null;
  const locale = snapshot.preferences.locale;
  const staged = snapshot.pending.keys.includes("lunafury-bottom-button");
  const busy = snapshot.settingInProgress || snapshot.settingsPending || snapshot.pending.busy
    || snapshot.pending.keys.includes("onboard-profile");
  return (
    <article id="lunafury-bottom-button" className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lunafury-bottom-button">
      <div className="setting-heading compact"><div><h2>{t(locale, "luna.bottomButton")}</h2></div></div>
      <OptionMenu id="lunafury-bottom-button-select" ariaLabel={t(locale, "luna.bottomButton")}
        options={[
          { value: 1, label: t(locale, "luna.bottomPower") },
          { value: 2, label: t(locale, "luna.bottomPowerDpi") },
        ]}
        value={mode} disabled={busy}
        onChange={(value) => control.applyLunaFuryBottomButtonMode(value as 1 | 2)} />
      <small className="setting-note">{t(locale, "luna.bottomButtonNote")}</small>
    </article>
  );
}

export function LunaFuryReceiverLightCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const mode = snapshot.status?.lunafury?.receiverLightMode;
  if (snapshot.status?.brand !== "LunaFury" || mode == null || snapshot.gameProfileDraft) return null;
  const locale = snapshot.preferences.locale;
  const staged = snapshot.pending.keys.includes("lunafury-receiver-light");
  return (
    <article id="lunafury-receiver-light" className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lunafury-receiver-light">
      <div className="setting-heading compact"><div><h2>{t(locale, "luna.receiverLight")}</h2></div></div>
      <OptionMenu id="lunafury-receiver-light-select" ariaLabel={t(locale, "luna.receiverLight")}
        options={[
          { value: 2, label: t(locale, "luna.lightMixed") },
          { value: 6, label: t(locale, "luna.lightBattery") },
          { value: 11, label: t(locale, "luna.lightDpi") },
          { value: 0, label: t(locale, "common.off") },
        ]}
        value={mode} disabled={snapshot.settingInProgress || snapshot.settingsPending || snapshot.pending.busy}
        onChange={(value) => control.applyLunaFuryReceiverLightMode(value as LunaFuryReceiverLightMode)} />
      <small className="setting-note">{t(locale, "luna.receiverLightNote")}</small>
    </article>
  );
}

export function LunaFuryButtonsCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const settings = snapshot.status?.lunafury;
  if (!settings) return null;
  const locale = snapshot.preferences.locale;
  const busy = snapshot.settingInProgress || snapshot.settingsPending || snapshot.pending.busy;
  const rateBusy = busy || snapshot.pending.keys.includes("onboard-profile");
  const staged = snapshot.pending.keys.some((key) => key.startsWith("lunafury-button-") || key === "lunafury-lightning");
  const buttons: Array<{ button: LunaFuryButton; value: number | undefined; label: I18nKey; min: number; max: number }> = [
    { button: "left", value: settings.leftDebounceMs, label: "luna.leftDebounce", min: 0, max: 15 },
    { button: "right", value: settings.rightDebounceMs, label: "luna.rightDebounce", min: 0, max: 15 },
    { button: "middle", value: settings.middleDebounceMs, label: "luna.middleDebounce", min: 1, max: 30 },
  ];
  return (
    <article id="lunafury-buttons" className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key="lunafury-lightning lunafury-button-left lunafury-button-right lunafury-button-middle lunafury-button-rate">
      <div className="setting-heading compact"><div><h2>{t(locale, "luna.buttons")}</h2></div></div>
      <div className="lunafury-response-options">
        {settings.buttonPollingRateHz != null && settings.supportedButtonPollingRates?.length ? (
          <div className="field-label">
            <RateSlider id="lunafury-button-rate" locale={locale} label={t(locale, "luna.buttonPollingRate")}
              options={[...settings.supportedButtonPollingRates]} valueHz={settings.buttonPollingRateHz}
              disabled={rateBusy || settings.supportedButtonPollingRates.length < 2}
              onChange={(value) => control.applyLunaFuryButtonPollingRate(value as 1000 | 2000 | 4000 | 8000)} />
            <small className="setting-note">{t(locale, "luna.buttonPollingNote")}</small>
          </div>
        ) : null}
        {settings.lightningMode != null ? (
          <div className="field-label">
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
      </div>
      <div className="lunafury-response-delays">
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
      </div>
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
      <div className="setting-heading compact">
        <div><h2>{t(locale, "luna.wheelGuard")}</h2></div>
        <SwitchButton
          id="lunafury-wheel-guard-toggle"
          label={t(locale, "luna.wheelGuard")}
          value={guard.enabled}
          disabled={busy}
          onChange={(enabled) => control.applyLunaFuryWheelGuard({ enabled, windowMs: guard.windowMs || 100 })}
        />
      </div>
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
