import { useEffect, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import type { ControlSnapshot } from "../device/types";
import type { MagneticButtonStatus, MagneticButtonsStatus } from "@openmouse/protocol/drivers/mouse-types";

function Steps({
  id,
  min,
  max,
  value,
  onChange,
  disabled = false,
  label,
}: {
  id: string;
  min: number;
  max: number;
  value: number | null;
  onChange: (next: number) => void;
  disabled?: boolean;
  label: string;
}): ReactNode {
  return (
    <div id={id} className="superstrike-steps" role="group" aria-label={label}>
      <div>
        {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((step) => (
          <button key={step} type="button" aria-pressed={step === value} disabled={disabled} onClick={() => onChange(step)}>
            {step}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  id,
  on,
  onChange,
  disabled = false,
  label,
  locale,
}: {
  id: string;
  on: boolean | null;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  locale: InterfaceLocale;
}): ReactNode {
  return (
    <div id={id} className="superstrike-steps superstrike-switch" role="group" aria-label={label}>
      <div>
        {([false, true] as const).map((value) => (
          <button key={String(value)} type="button" aria-pressed={on === value} disabled={disabled} onClick={() => onChange(value)}>
            {t(locale, value ? "common.on" : "common.off")}
          </button>
        ))}
      </div>
    </div>
  );
}

function nextToTrigger(trigger: number | null, min: number, max: number): number {
  const value = Math.min(max, Math.max(min, trigger ?? min));
  return value === 9 ? 10 : value;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div className="superstrike-control-row">
      <label>{label}{hint ? <small>{hint}</small> : null}</label>
      {children}
    </div>
  );
}

/** Press depth runs 0 to 100; the bar has ten segments and marks where the click registers. */
function DepthMeter({ magnetic }: { magnetic: MagneticButtonsStatus }): ReactNode {
  const [depth, setDepth] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const stop = control.subscribeButtonDepth((left, right) => setDepth([left, right]));
    const suppressContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", suppressContextMenu);
    return () => {
      stop();
      window.removeEventListener("contextmenu", suppressContextMenu);
    };
  }, []);
  const span = magnetic.triggerPointRange.max;
  return (
    <div className="superstrike-press-meters">
      {(["Left", "Right"] as const).map((side, index) => {
        const trigger = magnetic.buttons[index]?.triggerPoint;
        const mark = trigger ? Math.max(0, Math.min(9, Math.round((trigger / span) * 10) - 1)) : -1;
        return (
          <div key={side} className="superstrike-press-meter" role="meter" aria-label={`${side} press depth`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={depth[index]}>
            <span>{side}</span>
            <div>
              {Array.from({ length: 10 }, (_, step) => (
                <i key={step} data-on={step * 10 < depth[index]!} data-actuation={step === mark} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ButtonControls({
  group,
  magnetic,
  state,
  locale,
  brand,
}: {
  group: 0 | 1 | "both";
  magnetic: MagneticButtonsStatus;
  state: MagneticButtonStatus;
  locale: InterfaceLocale;
  brand: string;
}): ReactNode {
  const targets: Array<0 | 1> = group === "both" ? [0, 1] : [group];
  const slug = String(group);
  const { triggerPointRange: trigger, releasePointRange: release, rapidTriggerRange: rapid } = magnetic;
  const optical = state.switchType === "optical";
  const separateRelease = state.releasePoint != null;
  const rapidLevel = state.rapidTrigger ?? rapid?.min ?? 1;
  const unit = magnetic.rapidTriggerUnit === "ms" ? " ms" : "";
  const calibrated = magnetic.calibration !== "needed";
  // Release 9 is how the mouse says "follows the trigger point", so a separate release starts beside it.
  const firstRelease = release ? nextToTrigger(state.triggerPoint, release.min, release.max) : 1;
  return (
    <>
      {magnetic.canChooseSwitchType ? (
        <Row label="Switch">
          <div id={`magnetic-${slug}-switch`} className="superstrike-steps superstrike-switch" role="group" aria-label="magnetic or optical switch">
            <div>
              {(["magnetic", "optical"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={state.switchType === type}
                  disabled={type === "magnetic" && !calibrated}
                  onClick={() => targets.forEach((button) => control.applyMagneticSwitchType(button, type))}
                >
                  {type === "magnetic" ? "Magnetic" : "Optical"}
                </button>
              ))}
            </div>
          </div>
        </Row>
      ) : null}
      <Row label={t(locale, "super.actuation")} hint={`${trigger.min}–${trigger.max}`}>
        <Steps
          id={`magnetic-${slug}-trigger`}
          label="actuation point"
          min={trigger.min}
          max={trigger.max}
          value={state.triggerPoint}
          disabled={optical}
          onChange={(next) => targets.forEach((button) => control.applyMagneticTriggerPoint(button, next))}
        />
      </Row>
      {release ? (
        <Row label="Release Point" hint={separateRelease ? `${release.min}–${release.max}` : "Follows the actuation point"}>
          <div className="superstrike-rapid-controls">
            <Toggle
              id={`magnetic-${slug}-release-separate`}
              label="separate release point"
              locale={locale}
              on={separateRelease}
              disabled={optical}
              onChange={(on) => targets.forEach((button) => control.applyMagneticReleasePoint(button, on ? firstRelease : null))}
            />
            {separateRelease ? (
              <Steps
                id={`magnetic-${slug}-release`}
                label="release point"
                min={release.min}
                max={release.max}
                value={state.releasePoint ?? null}
                disabled={optical}
                onChange={(next) => targets.forEach((button) => control.applyMagneticReleasePoint(button, next))}
              />
            ) : null}
          </div>
        </Row>
      ) : null}
      {rapid ? (
        <Row label="Rapid Trigger" hint={magnetic.rapidTriggerUnit === "ms" ? `${rapid.min}–${rapid.max} ms` : `${rapid.min}–${rapid.max}`}>
          <div className="superstrike-rapid-controls">
            <Toggle
              id={`magnetic-${slug}-rapid-enabled`}
              label="rapid trigger on or off"
              locale={locale}
              on={state.rapidTriggerEnabled}
              disabled={optical}
              onChange={(on) => targets.forEach((button) => control.applyMagneticRapidTrigger(button, on, rapidLevel, unit))}
            />
            <Steps
              id={`magnetic-${slug}-rapid`}
              label="rapid trigger"
              min={rapid.min}
              max={rapid.max}
              value={state.rapidTrigger}
              disabled={optical || state.rapidTriggerEnabled === false}
              onChange={(next) => targets.forEach((button) => control.applyMagneticRapidTrigger(button, true, next, unit))}
            />
          </div>
        </Row>
      ) : null}
      {rapid && brand === "G-Wolves" ? (
        <p className="magnetic-note">Rapid trigger is factory calibrated. Changing it may cause double or dropped inputs.</p>
      ) : null}
    </>
  );
}

function Calibration({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const view = snapshot.magneticCalibration;
  const magnetic = snapshot.status?.magneticButtons;
  if (!magnetic || magnetic.calibration === null) {
    return <p className="magnetic-note">Calibrate the magnetic switches with the mouse on its cable.</p>;
  }
  const running = view.phase === "running";
  return (
    <div className="magnetic-calibration">
      <div className="magnetic-calibration-head">
        <div>
          <strong>Button Calibration</strong>
          <p>
            {magnetic.calibration === "needed"
              ? "The magnetic switches need calibrating."
              : "Only calibrate when your buttons have problems. Keep the mouse on its cable and still while it runs."}
          </p>
        </div>
        <button
          id="magnetic-calibrate"
          className="superstrike-apply-button"
          type="button"
          disabled={running || snapshot.settingInProgress}
          onClick={() => void control.startMagneticCalibration()}
        >
          Start Calibration
        </button>
      </div>
      {view.phase !== "idle" ? (
        <div className="magnetic-calibration-progress" data-phase={view.phase} role="status">
          <p>{view.message}</p>
          {running ? (
            <div className="superstrike-press-meters">
              {(["Left", "Right"] as const).map((side, index) => (
                <div key={side} className="superstrike-press-meter">
                  <span>{side}</span>
                  <div>
                    {Array.from({ length: 10 }, (_, step) => (
                      <i key={step} data-on={step * 10 < (index === 0 ? view.left : view.right)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {running
            ? <button type="button" className="superstrike-apply-button" onClick={control.cancelMagneticCalibration}>Cancel</button>
            : <button type="button" className="superstrike-apply-button" onClick={control.dismissMagneticCalibration}>Dismiss</button>}
        </div>
      ) : null}
    </div>
  );
}

export function MagneticButtons({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const magnetic = snapshot.status?.magneticButtons;
  const [leftButton, rightButton] = magnetic?.buttons ?? [];
  // Compare the fields that decide the mode rather than serializing the whole
  // button objects on every render.
  const same = magnetic?.buttons.length === 2
    && leftButton !== undefined && rightButton !== undefined
    && leftButton.switchType === rightButton.switchType
    && leftButton.triggerPoint === rightButton.triggerPoint
    && (leftButton.releasePoint ?? null) === (rightButton.releasePoint ?? null)
    && leftButton.rapidTrigger === rightButton.rapidTrigger
    && leftButton.rapidTriggerEnabled === rightButton.rapidTriggerEnabled;
  const [mode, setMode] = useState<"both" | "independent" | null>(null);
  if (!magnetic || magnetic.buttons.length !== 2) return null;
  const locale = snapshot.preferences.locale;
  const brand = snapshot.status?.brand ?? "";
  const shown = mode ?? (same ? "both" : "independent");

  return (
    <section
      id="magnetic-button-settings"
      className="device-data"
      role="tabpanel"
      aria-labelledby="workspace-tab-buttons"
      aria-label="Magnetic button settings"
    >
      <article className="setting-card superstrike-tuning-card">
        <div className="setting-heading superstrike-tuning-heading"><div><h2>Magnetic Buttons</h2></div></div>
        {magnetic.liveDepth ? <DepthMeter magnetic={magnetic} /> : null}
        <div className="superstrike-tabs" role="tablist" aria-label="Magnetic button mode">
          {(["both", "independent"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={shown === value} onClick={() => setMode(value)}>
              {value === "both" ? t(locale, "super.both") : t(locale, "super.independent")}
            </button>
          ))}
        </div>
        <div className="superstrike-tuning-panels" data-superstrike-mode={shown}>
          <div className="superstrike-tuning-grid superstrike-independent-panel">
            {([0, 1] as const).map((side) => (
              <fieldset key={side} className="superstrike-button-card">
                <legend>
                  <span className="superstrike-button-dot" />
                  {side === 0 ? t(locale, "adv.leftButton") : t(locale, "adv.rightButton")}
                </legend>
                <ButtonControls group={side} magnetic={magnetic} state={magnetic.buttons[side]!} locale={locale} brand={brand} />
              </fieldset>
            ))}
          </div>
          <fieldset className="superstrike-button-card superstrike-both-panel">
            <legend><span className="superstrike-button-dot" />{t(locale, "super.bothPrimary")}</legend>
            <p>{t(locale, "super.bothBody")}</p>
            <ButtonControls group="both" magnetic={magnetic} state={magnetic.buttons[0]!} locale={locale} brand={brand} />
          </fieldset>
        </div>
        <Calibration snapshot={snapshot} />
      </article>
    </section>
  );
}
