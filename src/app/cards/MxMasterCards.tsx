import { useEffect, useState, type ReactNode } from "react";
import {
  LOGITECH_HAPTIC_PRESETS,
  LOGITECH_SMART_SHIFT_OFF,
  type LogitechHapticPreset,
} from "@openmouse/protocol/logitech";
import * as control from "../../device/controller";
import type { ControlSnapshot } from "../../device/types";
import { t, tp } from "../../i18n";
import { Segmented, SwitchRow } from "../ui";

function HapticsCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const locale = snapshot.preferences.locale;
  if (status.hapticIntensity == null) return null;
  const preset = (Object.keys(LOGITECH_HAPTIC_PRESETS) as LogitechHapticPreset[])
    .find((name) => LOGITECH_HAPTIC_PRESETS[name] === status.hapticIntensity);
  const staged = snapshot.pending.keys.some((key) => key.startsWith("haptic-"));
  return (
    <article className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>FEEDBACK</p><h2>{t(locale, "mx.haptics")}</h2></div><output>{status.hapticEnabled ? preset ?? status.hapticIntensity : t(locale, "common.off")}</output></div>
      <SwitchRow label={t(locale, "mx.hapticFeedback")} value={status.hapticEnabled} onChange={control.applyHapticEnabled} />
      <Segmented
        ariaLabel={t(locale, "mx.hapticStrength")}
        value={preset}
        disabled={status.hapticEnabled !== true}
        options={(Object.keys(LOGITECH_HAPTIC_PRESETS) as LogitechHapticPreset[]).map((value) => ({ value, label: value }))}
        onChange={control.applyHapticIntensity}
      />
      <SwitchRow label={t(locale, "mx.batterySaving")} value={status.hapticBatterySaving} onChange={control.applyHapticBatterySaving} />
    </article>
  );
}

function WheelCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const locale = snapshot.preferences.locale;
  if (status.wheelMode == null && status.hiResScroll == null) return null;
  const smartShiftOn = status.smartShiftThreshold != null
    && status.smartShiftThreshold !== LOGITECH_SMART_SHIFT_OFF;
  const staged = snapshot.pending.keys.some((key) => [
    "wheel-mode", "smart-shift", "hi-res-scroll", "invert-scroll", "thumb-wheel-invert",
  ].includes(key));
  return (
    <article className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>SCROLLING</p><h2>MagSpeed wheel</h2></div><output>{status.wheelRatchetEngaged == null ? "—" : status.wheelRatchetEngaged ? t(locale, "mx.ratcheted") : t(locale, "mx.freeSpinning")}</output></div>
      {status.wheelMode != null ? (
        <Segmented
          ariaLabel={t(locale, "mx.wheelMode")}
          value={status.wheelMode}
          options={[{ value: "Ratchet", label: t(locale, "mx.ratchet") }, { value: "Freespin", label: t(locale, "mx.freespin") }]}
          onChange={control.applyWheelMode}
        />
      ) : null}
      {status.smartShiftThreshold != null ? (
        <>
          <SwitchRow label="SmartShift" value={smartShiftOn} onChange={(enabled) => control.applySmartShiftThreshold(enabled ? 50 : null)} />
          {smartShiftOn ? (
            <label className="field-label spaced">
              <span>{t(locale, "mx.switchThreshold")}</span>
              <span className="glass-slider-rail">
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={status.smartShiftThreshold ?? 50}
                  style={{ "--fill": `${((status.smartShiftThreshold ?? 50) - 1) / 99 * 100}%` }}
                  onChange={(event) => control.applySmartShiftThreshold(Number(event.currentTarget.value))}
                />
              </span>
              <output>{status.smartShiftThreshold}</output>
            </label>
          ) : null}
        </>
      ) : null}
      <SwitchRow label={t(locale, "mx.hiRes")} value={status.hiResScroll} onChange={control.applyHiResScroll} />
      <SwitchRow label={t(locale, "mx.invertVertical")} value={status.invertScroll} hidden={status.supportsInvertScroll !== true} onChange={control.applyInvertScroll} />
      <SwitchRow label={t(locale, "mx.invertThumb")} value={status.thumbWheelInverted} hidden={status.supportsThumbWheelInvert !== true} onChange={control.applyThumbWheelInverted} />
    </article>
  );
}

function DeviceNameCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const locale = snapshot.preferences.locale;
  const [name, setName] = useState(status.friendlyName ?? "");
  useEffect(() => setName(status.friendlyName ?? ""), [status.friendlyName]);
  if (status.friendlyName == null || status.friendlyNameMaxLength == null) return null;
  const valid = name.trim().length > 0 && name.trim() !== status.friendlyName;
  return (
    <article className={`setting-card${snapshot.pending.keys.includes("friendly-name") ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>DEVICE</p><h2>{t(locale, "mx.friendlyName")}</h2></div></div>
      <div className="axis-grid">
        <input aria-label={t(locale, "mx.friendlyNameAria")} maxLength={status.friendlyNameMaxLength} value={name} onChange={(event) => setName(event.currentTarget.value)} />
        <button className="axis-apply" type="button" disabled={!valid} onClick={() => control.applyFriendlyName(name)}>{t(locale, "mx.stageName")}</button>
      </div>
      <small className="setting-note">{tp(locale, "mx.chars", { n: name.length, max: status.friendlyNameMaxLength })}</small>
    </article>
  );
}

function EasySwitchCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const locale = snapshot.preferences.locale;
  const [pending, setPending] = useState<number | null>(null);
  if (status.hostCount == null || status.currentHost == null) return null;
  return (
    <article className="setting-card">
      <div className="setting-heading compact"><div><p>CONNECTION</p><h2>Easy-Switch</h2></div><output>{tp(locale, "mx.hostOf", { a: status.currentHost + 1, b: status.hostCount })}</output></div>
      <div className="easy-switch-slots" role="group" aria-label={t(locale, "mx.pairedComputers")}>
        {Array.from({ length: status.hostCount }, (_, slot) => {
          const current = slot === status.currentHost;
          const paired = status.hostSlotsPaired?.[slot] === true;
          return paired && !current ? (
            <button key={slot} type="button" onClick={() => setPending(slot)}>{slot + 1}</button>
          ) : <span key={slot} className={current ? "is-current" : ""}>{slot + 1}</span>;
        })}
      </div>
      {pending !== null ? (
        <div className="easy-switch-confirm">
          <p>{tp(locale, "mx.switchConfirm", { n: pending + 1 })}</p>
          <div className="easy-switch-confirm-actions">
            <button type="button" onClick={() => { const slot = pending; setPending(null); void control.requestHostSwitch(slot); }}>{t(locale, "mx.switch")}</button>
            <button type="button" onClick={() => setPending(null)}>{t(locale, "common.cancel")}</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Reprogrammable controls.
 *
 * Only the controls the device says are reprogrammable get a dropdown, and the
 * targets in it come from the device's own group mask. Left and right click
 * report an empty mask, so the firmware — not this card — is what keeps the
 * primary buttons where they are; they are still listed with a note, so the
 * absence of a dropdown reads as a restriction rather than a missing button.
 *
 * Virtual controls are left out entirely. A device reports them (the MX Master
 * 4's "virtual gesture button" is the event its gesture button emits when held
 * and dragged), but they are not something anyone can press, so a row for one
 * is noise rather than a restriction worth showing.
 */
export function MxMasterButtonsCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const locale = snapshot.preferences.locale;
  const all = snapshot.buttons;
  if (!all || all.length === 0) return null;
  const controls = all.filter((button) => !button.virtual);
  if (controls.length === 0) return null;
  const diverted = controls.filter((button) => button.diverted);
  const firmwareLocked = controls.filter((button) => !button.reprogrammable);
  const busy = snapshot.settingInProgress;
  const nameOf = (controlId: number): string =>
    all.find((candidate) => candidate.controlId === controlId)?.name
    ?? `Control 0x${controlId.toString(16).padStart(4, "0").toUpperCase()}`;
  const anyStaged = snapshot.pending.keys.some((key) => key.startsWith("button-"));
  return (
    <article className={`setting-card${anyStaged ? " is-staged" : ""}`}>
      <div className="setting-heading compact">
        <div><p>BUTTONS</p><h2>{t(locale, "mx.remapping")}</h2></div>
        <output>{controls.length}</output>
      </div>
      <div className="button-remap-list">
        {controls.map((button) => {
          const staged = snapshot.pending.keys.includes(`button-${button.controlId}`);
          const canRemap = button.reprogrammable && button.remappableTo.length > 0;
          return (
            <label
              key={button.controlId}
              className={`button-remap-row${staged ? " is-staged" : ""}`}
              data-pending-key={`button-${button.controlId}`}
            >
              <span>{button.name}</span>
              {canRemap ? (
                <select
                  value={snapshot.stagedButtonMappings[button.controlId] ?? button.mappedTo}
                  disabled={busy}
                  onChange={(event) => control.applyButtonMapping(
                    button.controlId,
                    Number(event.currentTarget.value),
                  )}
                >
                  {button.remappableTo.map((target) => (
                    <option key={target} value={target}>{nameOf(target)}</option>
                  ))}
                </select>
              ) : (
                <output>{button.taskName}</output>
              )}
            </label>
          );
        })}
      </div>
      {firmwareLocked.length > 0 ? (
        <small className="setting-note">
{firmwareLocked.length === 1
            ? tp(locale, "mx.lockedOne", { names: firmwareLocked.map((button) => button.name).join(" e ") })
            : tp(locale, "mx.lockedMany", { names: firmwareLocked.map((button) => button.name).join(", ") })}
        </small>
      ) : null}
      {diverted.length > 0 ? (
        <div className="button-remap-diverted">
          <p>
{diverted.length === 1
              ? tp(locale, "mx.divertedOne", { name: diverted[0]!.name })
              : tp(locale, "mx.divertedMany", { names: diverted.map((button) => button.name).join(", ") })}
          </p>
          <button type="button" disabled={busy} onClick={() => void control.restoreDivertedButtons()}>
            {t(locale, "mx.restoreHardware")}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function MxMasterCards({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  return <><HapticsCard snapshot={snapshot} /><WheelCard snapshot={snapshot} /><DeviceNameCard snapshot={snapshot} /><EasySwitchCard snapshot={snapshot} /></>;
}
