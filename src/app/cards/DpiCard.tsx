import { useEffect, useState, type ReactNode } from "react";
import { capabilitiesForFormat, stageLodLevel } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import * as control from "../../device/controller";
import type { ControlSnapshot, LiftOffLevel } from "../../device/types";
import { dpiPresetValues } from "../../dpi-presets";
import { IconLinked, IconUnlinked } from "../icons";
import { Segmented } from "../ui";

function DpiSlots({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const limits = snapshot.profile.slotLimits;
  const plan = snapshot.dpiSlotPlan;
  const locked = snapshot.profile.slotsLocked;
  const levels = snapshot.profileFormat
    ? capabilitiesForFormat(snapshot.profileFormat.id).supportedLods
    : [];
  const profileHasLod = levels.length > 0;

  useEffect(() => {
    if (openMenu === null) return;
    const close = (): void => setOpenMenu(null);
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", key);
    };
  }, [openMenu]);

  if (!limits || !plan) return null;

  return (
    <div id="logitech-dpi-slots">
      <div className="dpi-slot-header">
        <span>Slots in use</span>
        <div id="dpi-slot-count" className="dpi-slot-count" role="group" aria-label="Number of DPI slots">
          {Array.from({ length: limits.maxStages }, (_, step) => {
            const value = step + 1;
            const on = value === plan.stages.length;
            return (
              <button
                key={value}
                type="button"
                disabled={locked}
                className={on ? "selected" : ""}
                aria-pressed={on}
                onClick={() => control.setDpiSlotCount(value)}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>
      <div className="dpi-slot-rule" />
      <div id="dpi-slot-list" className="dpi-slot-list">
        <div className="dpi-slot-row dpi-slot-head">
          <span /><span>X</span><span /><span>Y</span><span>Lift-off</span>
        </div>
        {plan.stages.map((stage, index) => {
          const level = stageLodLevel(stage.lod);
          const isDefault = index === plan.defaultIndex;
          const axisLocked = snapshot.dpiAxisLocks[index] ?? true;
          return (
            <div key={index} className={`dpi-slot-row${isDefault ? " is-default" : ""}`}>
              <button
                type="button"
                className="dpi-slot-index"
                disabled={locked}
                title={isDefault ? "Starting slot" : "Make this the starting slot"}
                aria-pressed={isDefault}
                onClick={() => control.setDpiSlotDefault(index)}
              >
                {index + 1}
              </button>
              <input
                type="number"
                aria-label={`Slot ${index + 1} X DPI`}
                min={limits.minDpi}
                max={limits.maxDpi}
                step={limits.stepDpi}
                defaultValue={stage.x}
                key={`x-${index}-${stage.x}`}
                disabled={locked}
                onChange={(event) => control.setDpiSlotAxis(index, "x", Number(event.currentTarget.value))}
              />
              <button
                type="button"
                className={`dpi-axis-lock${axisLocked ? " is-locked" : ""}`}
                disabled={locked}
                title={axisLocked
                  ? "X and Y are linked — click to set them separately"
                  : "X and Y are separate — click to link them"}
                aria-label={`Link X and Y for slot ${index + 1}`}
                aria-pressed={axisLocked}
                onClick={() => control.setDpiAxisLock(index, !axisLocked)}
              >
                {axisLocked ? <IconLinked /> : <IconUnlinked />}
              </button>
              <input
                type="number"
                aria-label={`Slot ${index + 1} Y DPI`}
                min={limits.minDpi}
                max={limits.maxDpi}
                step={limits.stepDpi}
                defaultValue={stage.y}
                key={`y-${index}-${stage.y}`}
                disabled={locked || axisLocked}
                onChange={(event) => control.setDpiSlotAxis(index, "y", Number(event.currentTarget.value))}
              />
              <div className={`lod-select${openMenu === index ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="lod-select-value"
                  disabled={locked || !profileHasLod}
                  aria-haspopup="listbox"
                  aria-expanded={openMenu === index}
                  aria-label={`Slot ${index + 1} lift-off`}
                  title={profileHasLod ? "Set lift-off distance" : "This profile format has no lift-off setting"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenu(openMenu === index ? null : index);
                  }}
                >
                  <span>{level ?? "—"}</span>
                  <i aria-hidden="true" />
                </button>
                <ul className="lod-select-menu" role="listbox" aria-label={`Slot ${index + 1} lift-off`}>
                  {levels.map((name) => (
                    <li
                      key={name}
                      role="option"
                      aria-selected={name === level}
                      onClick={() => {
                        setOpenMenu(null);
                        control.setDpiSlotLod(index, name as LiftOffLevel);
                      }}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
      <small id="dpi-slot-note" className="setting-note">
        {locked
          ? "Read-only: writing DPI slots to a profile is not enabled yet, because the flash write sequence has not been verified on hardware."
          : `Each slot stores its own X/Y sensitivity and lift-off level. ${limits.minDpi}–${limits.maxDpi} DPI in steps of ${limits.stepDpi}. The highlighted slot is the one the mouse starts on.`}
      </small>
    </div>
  );
}

/** Shared Compx/Keychron-style stages: one DPI value per stage + active highlight. */
function DpiStages({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const editor = status?.ui?.dpiStageEditor;
  const stages = status?.dpiStages;
  if (!status || !editor || !stages || stages.length === 0) return null;

  const countEditable = editor.countEditable === true;
  const active = Math.min(status.activeDpiStage ?? 0, stages.length - 1);
  const disabled = snapshot.settingsPending;

  return (
    <div id="dpi-stages">
      {countEditable ? (
        <>
          <div id="dpi-stage-count-header" className="dpi-slot-header">
            <span>Stages in use</span>
            <div id="dpi-stage-count" className="dpi-slot-count" role="group" aria-label="Number of DPI stages">
              {Array.from({ length: editor.maxStages }, (_, step) => {
                const value = step + 1;
                const on = value === stages.length;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    className={on ? "selected" : ""}
                    aria-pressed={on}
                    onClick={() => control.applyDpiStageCount(value)}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="dpi-slot-rule" />
        </>
      ) : null}
      <div id="dpi-stage-list" className={`dpi-slot-list dpi-stage-list${status.dpiStageColors ? " has-colors" : ""}`}>
        <div className="dpi-slot-row dpi-slot-head">
          <span /><span>DPI</span>{status.dpiStageColors ? <span>Color</span> : null}
        </div>
        {stages.map((dpi, index) => {
          const isActive = index === active;
          return (
            <div key={index} className={`dpi-slot-row${isActive ? " is-default" : ""}`}>
              <button
                type="button"
                className="dpi-slot-index"
                disabled={disabled}
                title={isActive ? "Active stage" : "Make this the active stage"}
                aria-pressed={isActive}
                onClick={() => control.applyActiveDpiStage(index)}
              >
                {index + 1}
              </button>
              <input
                type="number"
                aria-label={`Stage ${index + 1} DPI`}
                min={editor.minDpi}
                max={editor.maxDpi}
                step={editor.stepDpi}
                defaultValue={dpi}
                key={`stage-${index}-${dpi}`}
                disabled={disabled}
                onChange={(event) => control.applyDpiStageValue(index, Number(event.currentTarget.value))}
              />
              {status.dpiStageColors ? (
                <input
                  type="color"
                  aria-label={`Stage ${index + 1} color`}
                  value={status.dpiStageColors[index] ?? "#000000"}
                  disabled={disabled}
                  onChange={(event) => control.applyDpiStageColor(index, event.currentTarget.value)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <small id="dpi-stage-note" className="setting-note">
        {countEditable
          ? `Presets and Custom edit the highlighted stage. ${editor.minDpi.toLocaleString()}–${editor.maxDpi.toLocaleString()} DPI. The DPI button on the mouse cycles through these stages.`
          : `Presets and Custom edit the highlighted stage. ${editor.minDpi.toLocaleString()}–${editor.maxDpi.toLocaleString()} DPI in steps of ${editor.stepDpi}. The DPI button on the mouse cycles through all ${editor.maxStages} stages.`}
      </small>
    </div>
  );
}

function AxisControls({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const [x, setX] = useState(String(status.dpi));
  const [y, setY] = useState(String(status.dpiY ?? status.dpi));
  useEffect(() => {
    setX(String(status.dpi));
    setY(String(status.dpiY ?? status.dpi));
  }, [status.dpi, status.dpiY]);
  const min = snapshot.dpiOptions.length ? Math.min(...snapshot.dpiOptions) : 100;
  const max = snapshot.dpiOptions.length ? Math.max(...snapshot.dpiOptions) : undefined;
  return (
    <div id="logitech-axis-controls">
      <div className="axis-grid">
        <label>
          X axis
          <input
            id="logitech-dpi-x"
            type="number"
            min={min}
            max={max}
            step={50}
            value={x}
            onChange={(event) => setX(event.currentTarget.value)}
          />
        </label>
        <label>
          Y axis
          <input
            id="logitech-dpi-y"
            type="number"
            min={min}
            max={max}
            step={50}
            value={y}
            onChange={(event) => setY(event.currentTarget.value)}
          />
        </label>
        <button
          id="apply-logitech-axes"
          className="axis-apply"
          type="button"
          onClick={() => control.applyLogitechAxisDpi(Number(x), Number(y))}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function DpiCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const deviceStatus = snapshot.deviceStatus;
  if (!status || !deviceStatus) return null;
  const staged = snapshot.pending.keys.includes("dpi")
    || snapshot.pending.keys.includes("dpi-stage-count")
    || snapshot.pending.keys.includes("dpi-active-stage")
    || snapshot.pending.keys.some((key) => key.startsWith("dpi-stage-"));
  const slotsAvailable = snapshot.profile.slotsAvailable;
  const stagesAvailable = Boolean(status.ui?.dpiStageEditor)
    && Array.isArray(status.dpiStages)
    && status.dpiStages.length > 0
    && !slotsAvailable;
  const showSeparateDpiAxes = snapshot.traits.logitech
    && status.supportsSeparateDpiAxes === true
    && !slotsAvailable;

  const common = dpiPresetValues(snapshot.dpiOptions);
  const values = common.includes(status.dpi) ? common : [...common, status.dpi].sort((a, b) => a - b);

  const label = (source: typeof status): string => showSeparateDpiAxes
    ? `X ${source.dpi.toLocaleString()} · Y ${(source.dpiY ?? source.dpi).toLocaleString()} DPI`
    : `${source.dpi.toLocaleString()} DPI`;

  return (
    <article
      className={`setting-card dpi-card${staged ? " is-staged" : ""}`}
      data-pending-key="dpi dpi-stage-count dpi-active-stage"
    >
      <div className="setting-heading">
        <div>
          <p>DPI</p>
          <h2>
            Sensitivity
            {snapshot.editedProfile !== null ? (
              <span className="setting-scope" id="dpi-scope-badge">{slotsAvailable ? "Per-profile" : "Host"}</span>
            ) : null}
          </h2>
        </div>
        <div className="dpi-header-actions">
          <input
            id="dpi-output"
            type="text"
            inputMode="numeric"
            value={snapshot.settingsPending ? "—" : snapshot.customDpiText}
            aria-label="DPI value"
            readOnly={!snapshot.customDpiEditing}
            onChange={(event) => control.setCustomDpiText(event.currentTarget.value)}
            onClick={() => {
              if (!snapshot.customDpiEditing) control.startCustomDpi();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                control.commitCustomDpi();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                control.cancelCustomDpi();
              }
            }}
          />
          <button
            id="custom-dpi"
            type="button"
            hidden={slotsAvailable}
            disabled={snapshot.settingsPending || snapshot.dpiOptions.length === 0}
            onClick={() => (snapshot.customDpiEditing ? control.commitCustomDpi() : control.startCustomDpi())}
          >
            {snapshot.customDpiEditing ? "Apply" : "Custom"}
          </button>
        </div>
      </div>

      {slotsAvailable ? null : (
        <Segmented
          id="dpi-presets"
          className="dpi-presets"
          ariaLabel="Common DPI values"
          options={values.map((dpi) => ({ value: dpi, label: dpi.toLocaleString() }))}
          value={status.dpi}
          disabled={snapshot.settingsPending}
          onChange={(dpi) => control.applyDpiValue(dpi)}
        />
      )}

      {showSeparateDpiAxes ? <AxisControls snapshot={snapshot} /> : null}
      {slotsAvailable ? <DpiSlots snapshot={snapshot} /> : null}
      {stagesAvailable ? <DpiStages snapshot={snapshot} /> : null}

      <div className="setting-action">
        <span id="dpi-pending">
          {staged ? `Staged ${label(status)}` : `Current ${label(deviceStatus)}`}
        </span>
      </div>
    </article>
  );
}
