import { useEffect, useState, type ReactNode } from "react";
import * as control from "../../device/controller";
import type { ControlSnapshot } from "../../device/types";
import { lunaFuryDpiInput } from "../../device/lunafury-dpi";
import { t, tp } from "../../i18n";
import { OptionMenu, StepperSlider, SwitchRow } from "../ui";

/** Mirrors the vendor's active-stage sliders, stage tiles and count selector. */
export function LunaFuryDpiEditor({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status!;
  const locale = snapshot.preferences.locale;
  const xs = status.dpiStages ?? [];
  const ys = status.dpiStagesY ?? xs;
  const separate = status.lunafury?.separateDpiAxes;
  const limits = status.ui?.dpiStageEditor;
  const max = limits?.maxDpi ?? 30000;
  const active = Math.min(Math.max(status.activeDpiStage ?? 0, 0), Math.max(0, xs.length - 1));
  const busy = snapshot.settingsPending || snapshot.settingInProgress;
  const writable = snapshot.capabilities?.dpiStagesWritable === true;
  const activeWritable = snapshot.capabilities?.activeDpiStageWritable === true;
  const init = () => xs.map((x, i) => ({ x: String(x), y: String(ys[i] ?? x) }));
  const [rows, setRows] = useState(init);
  const source = `${status.activeProfile}:${separate}:${xs.join(",")}:${ys.join(",")}`;
  useEffect(() => { setRows(init()); }, [source]);

  const select = (stage: number): void => {
    if (!busy && activeWritable && stage !== active) control.applyActiveDpiStage(stage);
  };
  const change = (stage: number, axis: "x" | "y", raw: string): void => {
    setRows((current) => current.map((row, i) => i === stage ? { ...row, [axis]: raw } : row));
  };
  const commit = (stage: number, axis: "x" | "y", raw: string): void => {
    if (busy || !writable || !xs[stage]) return;
    const value = lunaFuryDpiInput(raw, max);
    const x = axis === "x" ? value : xs[stage];
    // An unread axis mode is not proof of axis lock; preserve stored Y.
    const y = separate === false ? x : axis === "y" ? value : ys[stage] ?? x;
    setRows((current) => current.map((row, i) => i === stage ? { x: String(x), y: String(y) } : row));
    if (x !== xs[stage] || y !== ys[stage]) control.applyLunaFuryDpiStageAxes(stage, x, y);
  };

  return (
    <div className="lunafury-dpi-editor" id="lunafury-dpi-editor">
      {status.lunafury?.separateDpiAxes != null ? <SwitchRow id="lunafury-dpi-axes-toggle"
        label={t(locale, "luna.separateAxes")} value={separate === true} disabled={busy || !writable}
        onChange={control.applyLunaFurySeparateDpiAxes} /> : null}
      {xs.length ? (separate ? ["x", "y"] as const : ["x"] as const).map((axis) => (
        <StepperSlider key={`${status.activeProfile}-${active}-${axis}`} id={`lunafury-dpi-${axis}`}
          label={axis.toUpperCase()} value={lunaFuryDpiInput(rows[active]?.[axis] ?? String(xs[active]), max)}
          min={limits?.minDpi ?? 50} max={max} step={limits?.stepDpi ?? 50}
          scale={["50", String(max / 2), String(max)]} formatValue={(value) => `${value.toLocaleString()} DPI`}
          disabled={busy || !writable} pendingKey={`dpi-stage-${active}`}
          onCommit={(value) => commit(active, axis, String(value))} />
      )) : null}
      <div className="lunafury-dpi-stage-bar">
        <div className="lunafury-dpi-stage-list" role="group" aria-label={t(locale, "dpi.viewStages")}>
          {xs.map((x, stage) => (
            <div className={`lunafury-dpi-stage stage-${stage + 1}${stage === active ? " is-active" : ""}`} key={stage}>
              <button className="lunafury-dpi-stage-tile" type="button" disabled={busy || !activeWritable}
                aria-label={`${tp(locale, "dpi.stageDpi", { n: stage + 1 })}: ${x} DPI`}
                aria-pressed={stage === active} title={t(locale, "dpi.makeActive")} onClick={() => select(stage)}>
              </button>
              {(separate ? ["x", "y"] as const : ["x"] as const).map((axis) => (
                <label className="lunafury-dpi-stage-value" key={axis}>
                  {separate ? <span>{axis.toUpperCase()}</span> : null}
                  <input type="number" min={limits?.minDpi ?? 50} max={max} step={limits?.stepDpi ?? 50}
                    aria-label={`${tp(locale, "dpi.stageDpi", { n: stage + 1 })}${separate ? ` ${axis.toUpperCase()}` : ""}`}
                    value={rows[stage]?.[axis] ?? String(axis === "x" ? x : ys[stage] ?? x)} disabled={busy || !writable}
                    onFocus={() => select(stage)} onChange={(event) => change(stage, axis, event.currentTarget.value)}
                    onBlur={(event) => commit(stage, axis, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") change(stage, axis, String(axis === "x" ? xs[stage] : ys[stage]));
                    }} />
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="lunafury-dpi-count">
          <span>{t(locale, "luna.dpiStageCount")}</span>
          <OptionMenu id="lunafury-dpi-count" ariaLabel={t(locale, "luna.dpiStageCount")}
            options={Array.from({ length: limits?.maxStages ?? xs.length }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
            value={xs.length} disabled={busy || !writable || limits?.countEditable !== true}
            onChange={control.applyDpiStageCount} />
        </div>
      </div>
      <small className="setting-note">{t(locale, "luna.dpiStageNote")}</small>
    </div>
  );
}
