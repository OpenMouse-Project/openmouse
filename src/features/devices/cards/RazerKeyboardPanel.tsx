import type { ReactNode } from "react";
import { Gauge, Keyboard, Lightbulb } from "lucide-react";
import type { RazerMatrixEffect } from "@openmouse/keyboard-protocol/razer";
import { RAZER_GAME_MODE_LED_SUPPORT } from "@openmouse/keyboard-protocol/razer";
import type { ControlSnapshot } from "../../../device/types";
import * as control from "../../../device/controller";
import { displayText, t, type I18nKey } from "../../../i18n/index";
import { RateSlider, Segmented, StepperSlider } from "../../../shared/ui";

const EFFECT_PRESETS: readonly { label: I18nKey; effect: RazerMatrixEffect }[] = [
  { label: "kb.razerPresetOff", effect: { kind: "off" } },
  { label: "kb.razerPresetSpectrum", effect: { kind: "spectrum" } },
  { label: "kb.razerPresetWaveLeft", effect: { kind: "wave", direction: 1 } },
  { label: "kb.razerPresetWaveRight", effect: { kind: "wave", direction: 2 } },
  { label: "kb.razerPresetBreathing", effect: { kind: "breathing" } },
  { label: "kb.razerPresetStatic", effect: { kind: "static", red: 255, green: 255, blue: 255 } },
  { label: "kb.razerPresetReactive", effect: { kind: "reactive", speed: 1, red: 255, green: 255, blue: 255 } },
];

export function RazerKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const { identity, polling, trigger, workspace } = keyboard;
  const status = workspace.vendorStatus?.razer;
  const busy = trigger.busy;
  const gameModeSupported = RAZER_GAME_MODE_LED_SUPPORT.has(keyboard.productId);

  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${snapshot.workspaceTab}`}>
      {trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, trigger.statusText)}</output> : null}
      <article className="setting-card keyboard-identity-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "overview"}>
        <div className="setting-heading"><div><h2><Keyboard size={18} aria-hidden="true" /> {keyboard.name}</h2></div></div>
        <dl className="keyboard-identity">
          <div><dt>{t(locale, "kb.identityFirmware")}</dt><dd>{displayText(locale, identity.firmwareVersion ?? t(locale, "kb.notReported"))}</dd></div>
          {identity.serial ? <div><dt>{t(locale, "kb.identitySerial")}</dt><dd>{identity.serial}</dd></div> : null}
        </dl>
        {status?.verified === false ? <p className="setting-note">{t(locale, "kb.razerUnverified")}</p> : null}
        <button type="button" className="om-btn" disabled={busy} onClick={() => void control.applyKeyboardCommand({ kind: "razerRefresh" })}>{t(locale, "kb.refresh")}</button>
      </article>

      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "performance"}>
        <div className="setting-heading"><div><h2><Gauge size={18} aria-hidden="true" /> {t(locale, "kb.pollingRate")}</h2></div></div>
        {polling.supportedHz.length > 0 ? (
          <RateSlider id="razer-keyboard-polling" locale={locale} options={polling.supportedHz} valueHz={polling.currentHz}
            label={t(locale, "kb.pollingRate")} disabled={busy} onChange={hz => void control.applyKeyboardPolling(hz)} />
        ) : <p className="setting-note">{t(locale, "kb.notReported")}</p>}
        {gameModeSupported ? <>
          <div className="setting-heading tight"><div><h2>{t(locale, "kb.razerGameLed")}</h2></div></div>
          <Segmented id="razer-game-led" ariaLabel={t(locale, "kb.razerGameLed")}
            options={[{ value: 0, label: t(locale, "common.off") }, { value: 1, label: t(locale, "common.on") }]}
            value={workspace.razerGameModeLed == null ? null : Number(workspace.razerGameModeLed)}
            disabled={busy} onChange={value => void control.applyKeyboardCommand({ kind: "razerGameMode", enabled: value === 1 })} />
          {workspace.razerGameModeLed == null ? <p className="setting-note">{t(locale, "kb.notReported")}</p> : null}
        </> : null}
      </article>

      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "lighting"}>
        <div className="setting-heading"><div><h2><Lightbulb size={18} aria-hidden="true" /> {t(locale, "kb.lighting")}</h2></div></div>
        {status?.brightness != null ? (
          <StepperSlider id="razer-keyboard-brightness" label={t(locale, "kb.brightness")}
            value={status.brightness} min={0} max={255} step={1} scale={["0", "", "255"]}
            formatValue={value => `${value}/255`} disabled={busy}
            onCommit={value => control.applyKeyboardCommand({ kind: "razerBrightness", value })} />
        ) : <p className="setting-note">{t(locale, "kb.brightness")}: {t(locale, "kb.notReported")}</p>}
        <div className="setting-heading tight"><div><h2>{t(locale, "light.effect")}</h2></div></div>
        <p className="setting-note">{t(locale, "kb.razerEffectNote")}</p>
        <div className="keyboard-fields" role="group" aria-label={t(locale, "light.effect")}>
          {EFFECT_PRESETS.map(({ label, effect }) => (
            <button key={label} type="button" className="om-btn" disabled={busy}
              onClick={() => void control.applyKeyboardCommand({ kind: "razerEffect", effect })}>{t(locale, label)}</button>
          ))}
        </div>
      </article>
    </section>
  );
}
