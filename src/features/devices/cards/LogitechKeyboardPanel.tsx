import type { FormEvent, ReactNode } from "react";
import { logitechRgbMode, type LogitechRgbMode } from "@openmouse/keyboard-protocol/logitech";
import type { ControlSnapshot } from "../../../device/types";
import * as control from "../../../device/controller";
import { displayText, t } from "../../../i18n/index";
import { Segmented, StepperSlider, SwitchRow } from "../../../shared/ui";

const MODES: readonly LogitechRgbMode[] = ["Off", "Static", "Cycling", "Wave", "Breathing single"];

export function LogitechKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const { locale } = snapshot.preferences;
  const status = keyboard.workspace.vendorStatus?.logitech;
  const busy = keyboard.trigger.busy;
  const tab = snapshot.workspaceTab;
  const identity = keyboard.identity;
  const brightness = status?.brightness;
  const analog = status?.analog;
  const lighting = status?.lighting;
  // 0x8071 applies a mode only where supported. Offer only modes shared by all clusters.
  const modes = lighting?.rgbZones.length
    ? MODES.filter(mode => lighting.rgbZones.every(zone => zone.effects.some(effect => logitechRgbMode(effect.id) === mode)))
    : [];
  const sendColor = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const red = Number(values.get("red"));
    const green = Number(values.get("green"));
    const blue = Number(values.get("blue"));
    if ([red, green, blue].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
      void control.applyKeyboardCommand({ kind: "logitechSolidColor", red, green, blue });
    }
  };

  return <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
    {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}
    {tab === "overview" ? <article className="setting-card keyboard-identity-card keyboard-workspace-card">
      <div className="setting-heading"><div><h2>{keyboard.name}</h2></div></div>
      <dl className="keyboard-identity">
        {identity.firmwareVersion ? <div><dt>{t(locale, "kb.identityFirmware")}</dt><dd>{identity.firmwareVersion}</dd></div> : null}
        {identity.serial ? <div><dt>{t(locale, "kb.identitySerial")}</dt><dd>{identity.serial}</dd></div> : null}
        {status?.battery?.percent != null ? <div><dt>{t(locale, "kb.logitechBattery")}</dt><dd>{status.battery.percent}%</dd></div>
          : status?.battery?.level ? <div><dt>{t(locale, "kb.logitechBattery")}</dt><dd>{t(locale, `kb.logitechBattery${status.battery.level}`)}</dd></div> : null}
      </dl>
      <button type="button" className="om-btn" disabled={busy} onClick={() => void control.applyKeyboardCommand({ kind: "logitechRefresh" })}>{t(locale, "kb.refresh")}</button>
    </article> : null}
    {tab === "performance" && (status?.pollingRateHz != null && status.supportedPollingRates.length > 0 || analog?.rapidTrigger != null || analog?.keyPriority != null) ? <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div><h2>{t(locale, "kb.performance")}</h2></div></div>
      {status?.pollingRateHz != null && status.supportedPollingRates.length > 0 ? <div className="keyboard-fields">
        <span>{t(locale, "kb.pollingRate")}</span>
        <Segmented id="logitech-polling" ariaLabel={t(locale, "kb.pollingRate")} disabled={busy} value={status.pollingRateHz}
          options={status.supportedPollingRates.map(hz => ({ value: hz, label: `${hz} Hz` }))}
          onChange={hz => void control.applyKeyboardCommand({ kind: "logitechPolling", hz })} />
      </div> : null}
      {analog?.rapidTrigger != null ? <SwitchRow label={t(locale, "kb.rapidGroup")} disabled={busy} value={analog.rapidTrigger}
        onChange={enabled => void control.applyKeyboardCommand({ kind: "logitechRapidTrigger", enabled })} /> : null}
      {analog?.keyPriority != null ? <SwitchRow label={t(locale, "kb.logitechKeyPriority")} disabled={busy} value={analog.keyPriority}
        onChange={enabled => void control.applyKeyboardCommand({ kind: "logitechKeyPriority", enabled })} /> : null}
    </article> : null}
    {tab === "lighting" && (brightness || modes.length || lighting?.zones.length) ? <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div><h2>{t(locale, "kb.lighting")}</h2></div></div>
      {brightness && brightness.max > brightness.min ? <StepperSlider id="logitech-brightness" label={t(locale, "kb.brightness")}
        value={brightness.value} min={brightness.min} max={brightness.max} step={1} scale={[String(brightness.min), "", String(brightness.max)]}
        formatValue={value => String(value)} disabled={busy}
        onCommit={value => control.applyKeyboardCommand({ kind: "logitechBrightness", value })} /> : null}
      {modes.length ? <div className="keyboard-fields"><span>{t(locale, "kb.logitechRgbEffect")}</span>
        <div className="keyboard-inline-form" role="group" aria-label={t(locale, "kb.logitechRgbEffect")}>
          {modes.map(mode => <button type="button" className="om-btn" key={mode} disabled={busy}
            onClick={() => void control.applyKeyboardCommand({ kind: "logitechRgbEffect", mode })}>
            {t(locale, mode === "Off" ? "common.off" : mode === "Static" ? "kb.logitechStaticBlack" : mode === "Cycling" ? "rgb.effect.cycle" : mode === "Wave" ? "rgb.effect.wave" : "rgb.effect.breath")}
          </button>)}
        </div><p className="setting-note">{t(locale, "kb.logitechRgbNoReadback")}</p>
      </div> : null}
      {lighting?.zones.length ? <form className="keyboard-inline-form" onSubmit={sendColor}>
        <fieldset className="keyboard-fields" disabled={busy}><legend>{t(locale, "kb.logitechSolidColor")}</legend>
          {(["red", "green", "blue"] as const).map(channel => <label className="keyboard-field" key={channel}>
            <span>{t(locale, `kb.logitech${channel}`)}</span><input type="number" name={channel} min={0} max={255} step={1} required autoComplete="off" />
          </label>)}
          <button type="submit" className="om-btn">{t(locale, "kb.apply")}</button>
        </fieldset>
        <p className="setting-note">{t(locale, "kb.logitechColorNoReadback")}</p>
      </form> : null}
    </article> : null}
  </section>;
}
