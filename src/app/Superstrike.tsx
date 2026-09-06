import type { ReactNode } from "react";
import * as control from "../device/controller";
import { t, tp } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import type { AnalogTuning, ControlSnapshot } from "../device/types";

function SuperstrikeSteps({
  id,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  min: number;
  max: number;
  value: number;
  onChange: (next: number) => void;
}): ReactNode {
  return (
    <div className="superstrike-steps" role="group" aria-label={id.replace("logitech-", "").replaceAll("-", " ")}>
      <input id={id} type="hidden" value={value} readOnly />
      <div>
        {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((step) => (
          <button
            key={step}
            type="button"
            aria-pressed={step === value}
            onClick={() => onChange(step)}
          >
            {step}
          </button>
        ))}
      </div>
    </div>
  );
}

function TuningControls({
  group,
  tuning,
  limits,
  locale,
}: {
  group: "left" | "right" | "both";
  tuning: AnalogTuning;
  limits: { maxActuation: number; maxRapidTrigger: number; maxHaptics: number };
  locale: InterfaceLocale;
}): ReactNode {
  const rows = [
    {
      setting: "actuation" as const,
      label: t(locale, "super.actuation"),
      low: t(locale, "super.shortClick"),
      high: tp(locale, "super.longClick", { max: limits.maxActuation }),
      min: 1,
      max: limits.maxActuation,
      value: tuning.actuation,
    },
    {
      setting: "rapidTrigger" as const,
      label: "Rapid Trigger",
      low: t(locale, "super.fast"),
      high: tp(locale, "super.slow", { max: limits.maxRapidTrigger }),
      min: 1,
      max: limits.maxRapidTrigger,
      value: tuning.rapidTrigger,
    },
    {
      setting: "haptics" as const,
      label: t(locale, "super.clickHaptics"),
      low: t(locale, "super.off0"),
      high: tp(locale, "super.maxFeedback", { max: limits.maxHaptics }),
      min: 0,
      max: limits.maxHaptics,
      value: tuning.haptics,
    },
  ];
  const slug = { actuation: "actuation", rapidTrigger: "rapid-trigger", haptics: "haptics" } as const;
  return (
    <>
      {rows.map((row) => (
        <div key={row.setting} className="superstrike-control-row">
          <label>
            {row.label} <small>{row.low} <span>{row.high}</span></small>
          </label>
          <SuperstrikeSteps
            id={`logitech-${group}-${slug[row.setting]}`}
            min={row.min}
            max={row.max}
            value={row.value}
            onChange={(next) => control.setAnalogTuningValue(group, row.setting, next)}
          />
        </div>
      ))}
    </>
  );
}

export function Superstrike({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const tuning = snapshot.traits.logitech ? snapshot.status?.analogButtonTuning : undefined;
  if (!tuning || tuning.buttons.length !== 2) return null;
  const locale = snapshot.preferences.locale;
  const state = snapshot.analogTuning;

  return (
    <section
      id="logitech-analog-button-settings"
      className="device-data"
      role="tabpanel"
      aria-labelledby="workspace-tab-buttons"
      aria-label="HITS tuning settings"
    >
      <article className="setting-card superstrike-tuning-card">
        <div className="setting-heading superstrike-tuning-heading"><div><h2>HITS Tuning</h2></div></div>
        <div className="superstrike-tabs" role="tablist" aria-label="HITS tuning mode">
          {(["both", "independent"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={state.mode === mode}
              onClick={() => control.setAnalogTuningMode(mode)}
            >
              {mode === "both" ? t(locale, "super.both") : t(locale, "super.independent")}
            </button>
          ))}
        </div>
        <div className="superstrike-tuning-panels" data-superstrike-mode={state.mode}>
          <div className="superstrike-tuning-grid superstrike-independent-panel">
            {(["left", "right"] as const).map((side) => (
              <fieldset key={side} className="superstrike-button-card">
                <legend>
                  <span className="superstrike-button-dot" />
                  {side === "left" ? t(locale, "adv.leftButton") : t(locale, "adv.rightButton")}
                </legend>
                <TuningControls group={side} tuning={state[side]} limits={tuning} locale={locale} />
                <button
                  id={`apply-logitech-${side}-button`}
                  className="superstrike-apply-button"
                  type="button"
                  onClick={() => control.applyLogitechAnalogButton(side === "left" ? 0 : 1)}
                >
                  {side === "left" ? t(locale, "super.applyLeft") : t(locale, "super.applyRight")}
                </button>
              </fieldset>
            ))}
          </div>
          <fieldset className="superstrike-button-card superstrike-both-panel">
            <legend><span className="superstrike-button-dot" />{t(locale, "super.bothPrimary")}</legend>
            <p>{t(locale, "super.bothBody")}</p>
            <TuningControls group="both" tuning={state.both} limits={tuning} locale={locale} />
            <button
              id="apply-logitech-both-buttons"
              className="superstrike-apply-button"
              type="button"
              onClick={control.applyLogitechAnalogButtons}
            >
              {t(locale, "super.applyBoth")}
            </button>
          </fieldset>
        </div>
      </article>
    </section>
  );
}
