import { useEffect, useState, type ReactNode } from "react";
import {
  LOGITECH_HAPTIC_PRESETS,
  LOGITECH_SMART_SHIFT_OFF,
  type LogitechHapticPreset,
} from "@openmouse/protocol/logitech";
import * as control from "../../device/controller";
import type { ControlSnapshot } from "../../device/types";
import { Segmented, SwitchRow } from "../ui";

function HapticsCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  if (status.hapticIntensity == null) return null;
  const preset = (Object.keys(LOGITECH_HAPTIC_PRESETS) as LogitechHapticPreset[])
    .find((name) => LOGITECH_HAPTIC_PRESETS[name] === status.hapticIntensity);
  const staged = snapshot.pending.keys.some((key) => key.startsWith("haptic-"));
  return (
    <article className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>FEEDBACK</p><h2>Haptics</h2></div><output>{status.hapticEnabled ? preset ?? status.hapticIntensity : "Off"}</output></div>
      <SwitchRow label="Haptic feedback" value={status.hapticEnabled} onChange={control.applyHapticEnabled} />
      <Segmented
        ariaLabel="Haptic strength"
        value={preset}
        disabled={status.hapticEnabled !== true}
        options={(Object.keys(LOGITECH_HAPTIC_PRESETS) as LogitechHapticPreset[]).map((value) => ({ value, label: value }))}
        onChange={control.applyHapticIntensity}
      />
      <SwitchRow label="Battery saving" value={status.hapticBatterySaving} onChange={control.applyHapticBatterySaving} />
    </article>
  );
}

function WheelCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  if (status.wheelMode == null && status.hiResScroll == null) return null;
  const smartShiftOn = status.smartShiftThreshold != null
    && status.smartShiftThreshold !== LOGITECH_SMART_SHIFT_OFF;
  const staged = snapshot.pending.keys.some((key) => [
    "wheel-mode", "smart-shift", "hi-res-scroll", "invert-scroll", "thumb-wheel-invert",
  ].includes(key));
  return (
    <article className={`setting-card${staged ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>SCROLLING</p><h2>MagSpeed wheel</h2></div><output>{status.wheelRatchetEngaged == null ? "—" : status.wheelRatchetEngaged ? "Ratcheted" : "Free-spinning"}</output></div>
      {status.wheelMode != null ? (
        <Segmented
          ariaLabel="Wheel mode"
          value={status.wheelMode}
          options={[{ value: "Ratchet", label: "Ratchet" }, { value: "Freespin", label: "Free-spin" }]}
          onChange={control.applyWheelMode}
        />
      ) : null}
      {status.smartShiftThreshold != null ? (
        <>
          <SwitchRow label="SmartShift" value={smartShiftOn} onChange={(enabled) => control.applySmartShiftThreshold(enabled ? 50 : null)} />
          {smartShiftOn ? (
            <label className="field-label spaced">
              <span>Switch threshold</span>
              <input type="range" min={1} max={100} value={status.smartShiftThreshold ?? 50} onChange={(event) => control.applySmartShiftThreshold(Number(event.currentTarget.value))} />
              <output>{status.smartShiftThreshold}</output>
            </label>
          ) : null}
        </>
      ) : null}
      <SwitchRow label="High-resolution scrolling" value={status.hiResScroll} onChange={control.applyHiResScroll} />
      <SwitchRow label="Invert vertical scroll" value={status.invertScroll} hidden={status.supportsInvertScroll !== true} onChange={control.applyInvertScroll} />
      <SwitchRow label="Invert thumb wheel" value={status.thumbWheelInverted} hidden={status.supportsThumbWheelInvert !== true} onChange={control.applyThumbWheelInverted} />
    </article>
  );
}

function DeviceNameCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const [name, setName] = useState(status.friendlyName ?? "");
  useEffect(() => setName(status.friendlyName ?? ""), [status.friendlyName]);
  if (status.friendlyName == null || status.friendlyNameMaxLength == null) return null;
  const valid = name.trim().length > 0 && name.trim() !== status.friendlyName;
  return (
    <article className={`setting-card${snapshot.pending.keys.includes("friendly-name") ? " is-staged" : ""}`}>
      <div className="setting-heading compact"><div><p>DEVICE</p><h2>Friendly name</h2></div></div>
      <div className="axis-grid">
        <input aria-label="Device friendly name" maxLength={status.friendlyNameMaxLength} value={name} onChange={(event) => setName(event.currentTarget.value)} />
        <button className="axis-apply" type="button" disabled={!valid} onClick={() => control.applyFriendlyName(name)}>Stage name</button>
      </div>
      <small className="setting-note">{name.length}/{status.friendlyNameMaxLength} characters</small>
    </article>
  );
}

function EasySwitchCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const [pending, setPending] = useState<number | null>(null);
  if (status.hostCount == null || status.currentHost == null) return null;
  return (
    <article className="setting-card">
      <div className="setting-heading compact"><div><p>CONNECTION</p><h2>Easy-Switch</h2></div><output>{status.currentHost + 1} of {status.hostCount}</output></div>
      <div className="easy-switch-slots" role="group" aria-label="Paired computers">
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
          <p>Switch to computer {pending + 1}? The mouse will disconnect immediately. Use its underside button to bring it back.</p>
          <div className="easy-switch-confirm-actions">
            <button type="button" onClick={() => { const slot = pending; setPending(null); void control.requestHostSwitch(slot); }}>Switch</button>
            <button type="button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function MxMasterCards({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  return <><HapticsCard snapshot={snapshot} /><WheelCard snapshot={snapshot} /><DeviceNameCard snapshot={snapshot} /><EasySwitchCard snapshot={snapshot} /></>;
}
