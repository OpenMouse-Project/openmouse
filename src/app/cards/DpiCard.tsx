import { useEffect, useState, type ReactNode } from "react";
import { capabilitiesForFormat, stageLodLevel } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import * as control from "../../device/controller";
import type { ControlSnapshot, LiftOffLevel } from "../../device/types";
import { dpiPresetValues } from "../../dpi-presets";
import { t, tp } from "../../i18n";
import { IconLinked, IconUnlinked } from "../icons";
import { Segmented } from "../ui";

function DpiSlots({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const locale = snapshot.preferences.locale;
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
        <span>{t(locale, "dpi.slotsInUse")}</span>
        <div id="dpi-slot-count" className="dpi-slot-count" role="group" aria-label={t(locale, "dpi.slotsCount")}>
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
                title={isDefault ? t(locale, "dpi.startingSlot") : t(locale, "dpi.makeStarting")}
                aria-pressed={isDefault}
                onClick={() => control.setDpiSlotDefault(index)}
              >
                {index + 1}
              </button>
              <input
                type="number"
                aria-label={tp(locale, "dpi.slotX", { n: index + 1 })}
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
                  ? t(locale, "dpi.linkedHint")
                  : t(locale, "dpi.unlinkedHint")}
                aria-label={tp(locale, "dpi.linkXY", { n: index + 1 })}
                aria-pressed={axisLocked}
                onClick={() => control.setDpiAxisLock(index, !axisLocked)}
              >
                {axisLocked ? <IconLinked /> : <IconUnlinked />}
              </button>
              <input
                type="number"
                aria-label={tp(locale, "dpi.slotY", { n: index + 1 })}
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
                  aria-label={tp(locale, "dpi.slotLiftOff", { n: index + 1 })}
                  title={profileHasLod ? t(locale, "dpi.liftOffTitle") : t(locale, "dpi.noLiftOff")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenu(openMenu === index ? null : index);
                  }}
                >
                  <span>{level ?? "—"}</span>
                  <i aria-hidden="true" />
                </button>
                <ul className="lod-select-menu" role="listbox" aria-label={tp(locale, "dpi.slotLiftOff", { n: index + 1 })}>
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
          ? t(locale, "dpi.slotReadonly")
          : tp(locale, "dpi.slotNote", { min: limits.minDpi, max: limits.maxDpi, step: limits.stepDpi })}
      </small>
    </div>
  );
}

/** Shared Compx/Keychron-style stages: one DPI value per stage + active highlight. */
function DpiStages({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
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
            <span>{t(locale, "dpi.stagesInUse")}</span>
            <div id="dpi-stage-count" className="dpi-slot-count" role="group" aria-label={t(locale, "dpi.stagesCount")}>
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
          <span /><span>DPI</span>{status.dpiStageColors ? <span>{t(locale, "dpi.color")}</span> : null}
        </div>
        {stages.map((dpi, index) => {
          const isActive = index === active;
          return (
            <div key={index} className={`dpi-slot-row${isActive ? " is-default" : ""}`}>
              <button
                type="button"
                className="dpi-slot-index"
                disabled={disabled}
                title={isActive ? t(locale, "dpi.activeStage") : t(locale, "dpi.makeActive")}
                aria-pressed={isActive}
                onClick={() => control.applyActiveDpiStage(index)}
              >
                {index + 1}
              </button>
              <input
                type="number"
                aria-label={tp(locale, "dpi.stageDpi", { n: index + 1 })}
                min={editor.minDpi}
                max={editor.maxDpi}
                step={editor.stepDpi}
                defaultValue={dpi}
                key={`stage-${index}-${dpi}`}
                disabled={disabled}
                // Commit on blur/Enter, never per keystroke: clearing the
                // field to type a new value used to apply Number("") = 0 on
                // the first Backspace, snapping the stage to the minimum
                // and stealing focus via the key remount mid-typing.
                onBlur={(event) => {
                  const raw = event.currentTarget.value.trim();
                  if (raw === "") {
                    event.currentTarget.value = String(dpi);
                    return;
                  }
                  const next = Number(raw);
                  if (Number.isInteger(next) && next !== dpi) control.applyDpiStageValue(index, next);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.currentTarget.value = String(dpi);
                    event.currentTarget.blur();
                  }
                }}
              />
              {status.dpiStageColors ? (
                <input
                  type="color"
                  aria-label={tp(locale, "dpi.stageColor", { n: index + 1 })}
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
          ? tp(locale, "dpi.stageNoteCount", { min: editor.minDpi.toLocaleString(), max: editor.maxDpi.toLocaleString() })
          : tp(locale, "dpi.stageNoteSteps", { min: editor.minDpi.toLocaleString(), max: editor.maxDpi.toLocaleString(), step: editor.stepDpi, total: editor.maxStages })}
      </small>
    </div>
  );
}

function AxisControls({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const locale = snapshot.preferences.locale;
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
          {t(locale, "dpi.xAxis")}
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
          {t(locale, "dpi.yAxis")}
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
          {t(locale, "common.apply")}
        </button>
      </div>
    </div>
  );
}

export function DpiCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const deviceStatus = snapshot.deviceStatus;
  const locale = snapshot.preferences.locale;
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
  // Stage-editor mice list every stage below with the active one highlighted
  // — injecting the current DPI as an extra preset chip only makes it blink
  // in and out while cycling non-round stages. Keep presets stable there.
  const values = stagesAvailable || common.includes(status.dpi) ? common : [...common, status.dpi].sort((a, b) => a - b);

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
            {t(locale, "dpi.sensitivity")}
            {snapshot.editedProfile !== null ? (
              <span className="setting-scope" id="dpi-scope-badge">{slotsAvailable ? t(locale, "dpi.perProfile") : "Host"}</span>
            ) : null}
          </h2>
        </div>
        <div className="dpi-header-actions">
          <input
            id="dpi-output"
            type="text"
            inputMode="numeric"
            value={snapshot.settingsPending ? "—" : snapshot.customDpiText}
            aria-label={t(locale, "dpi.value")}
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
            {snapshot.customDpiEditing ? t(locale, "common.apply") : t(locale, "common.custom")}
          </button>
        </div>
      </div>

      {slotsAvailable ? null : (
        <Segmented
          id="dpi-presets"
          className="dpi-presets"
          ariaLabel={t(locale, "dpi.presets")}
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
          {staged ? tp(locale, "common.staged", { v: label(status) }) : tp(locale, "common.current", { v: label(deviceStatus) })}
        </span>
      </div>
    </article>
  );
}
