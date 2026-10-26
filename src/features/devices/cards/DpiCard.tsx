import { displayText } from "../../../i18n/index";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
  capabilitiesForFormat,
  stageLodLevel,
} from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import * as control from "../../../device/controller";
import type { ControlSnapshot, LiftOffLevel } from "../../../device/types";
import { isNoirE1Status, isNoirKsnakeStatus, isNoirS1Status, NOIR_DPI_STAGE_COLORS } from "../../../device/noir.ts";
import { closestDpiOption, dpiPresetValues } from "../../../device/dpi-presets";
import { t, tp } from "../../../i18n/index";
import { LiftOffDistance, hasLiftOff } from "./PerformanceCards";
import { IconLinked, IconUnlinked } from "../../../shared/icons";

const MAX_EDITOR_ROWS = 4;
const DEFAULT_LOD = 2;

type StageRow = { enabled: boolean; value: string; valueY: string; lod: number; linked?: boolean };

function isUniform(stages: readonly number[] | undefined): boolean {
  return stages !== undefined && stages.length > 1 && stages.every((value) => value === stages[0]);
}

/** Single on a fixed-count stage mouse puts one DPI in every stage, so the DPI button has nothing to cycle. */
function singleFillsStageTable(snapshot: ControlSnapshot): boolean {
  const status = snapshot.status;
  const logitechSlots = snapshot.profile.slotsAvailable && snapshot.dpiSlotPlan !== null;
  return !logitechSlots
    && (status?.dpiStages?.length ?? 0) > 0
    && status?.ui?.dpiStageEditor !== undefined
    && status.ui.dpiStageEditor.countEditable !== true
    && snapshot.capabilities?.dpiStagesWritable === true;
}

function DpiStageEditor({
  snapshot,
  editorView,
}: {
  snapshot: ControlSnapshot;
  editorView?: "stage" | "single";
}): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
  const options = snapshot.dpiOptions;

  const isLogitech = snapshot.profile.slotsAvailable && snapshot.dpiSlotPlan !== null;
  const stageEditor = status?.ui?.dpiStageEditor;
  const isStage = Boolean(stageEditor) && Array.isArray(status?.dpiStages) && (status?.dpiStages?.length ?? 0) > 0;
  // A driver may publish the stage table without being able to write it (the
  // classic Razer driver never sends the unverified `0x04`/`0x06` write), so
  // edits are gated on the method actually existing rather than on the table
  // being present.
  const stagesWritable = snapshot.capabilities?.dpiStagesWritable === true;
  const activeWritable = snapshot.capabilities?.activeDpiStageWritable === true;

  const naturalMode: "logitech" | "stage" | "generic" = isLogitech ? "logitech" : isStage ? "stage" : "generic";
  const mode: "logitech" | "stage" | "generic" = editorView === "single" ? "generic" : naturalMode;
  // A per-stage Y column only exists where the driver publishes the Y table and
  // the client can write one axis without the other. Every other client mirrors
  // Y into the single stage value, so a second column would be a lie.
  const stageAxesEditable = mode === "stage"
    && snapshot.capabilities?.dpiStageAxesWritable === true
    && Array.isArray(status?.dpiStagesY);
  const slotAxesEditable = mode === "logitech" && status?.supportsSeparateDpiAxes === true;
  const showAxes = stageAxesEditable || slotAxesEditable;
  const stageColors = mode === "stage"
    ? status?.dpiStageColors ?? (isNoirKsnakeStatus(status) ? NOIR_DPI_STAGE_COLORS : null)
    : null;
  const showStageColors = mode === "stage"
    && (stageColors?.length ?? 0) >= (status?.dpiStages?.length ?? 0);
  const limits = snapshot.profile.slotLimits;
  // The single-DPI (generic) view writes the live DPI, not the profile, so it
  // must not be gated behind the profile's slot-write lock.
  const locked = mode === "logitech" ? snapshot.profile.slotsLocked : snapshot.settingsPending;

  const countCap = isLogitech ? (limits?.maxStages ?? 1) : stageEditor?.maxStages ?? 1;
  const rowCap = mode === "generic" ? MAX_EDITOR_ROWS : countCap;

  const initRows = (prev?: StageRow[]): StageRow[] => {
    if (mode === "logitech" && snapshot.dpiSlotPlan) {
      const stages = snapshot.dpiSlotPlan.stages.slice(0, rowCap);
      const last = stages[stages.length - 1]?.x ?? status?.dpi ?? 800;
      const rows = stages.map((stage, index) => ({ enabled: true, value: String(stage.x), valueY: String(stage.y ?? stage.x), lod: stage.lod, linked: (stage.y ?? stage.x) === stage.x && prev?.[index]?.linked !== false }));
      while (rows.length < rowCap) rows.push({ enabled: false, value: String(last), valueY: String(last), lod: DEFAULT_LOD, linked: true });
      return rows;
    }
    if (mode === "stage" && status?.dpiStages) {
      const stages = status.dpiStages.slice(0, rowCap);
      const stagesY = status.dpiStagesY;
      const last = stages[stages.length - 1] ?? status.dpi ?? 800;
      const rows = stages.map((value, index) => ({
        enabled: true,
        value: String(value),
        valueY: String(stagesY?.[index] ?? value),
        lod: DEFAULT_LOD,
      }));
      while (rows.length < rowCap) rows.push({ enabled: false, value: String(last), valueY: String(last), lod: DEFAULT_LOD });
      return rows;
    }
    const presets = dpiPresetValues(options);
    const ordered = [status?.dpi, ...presets.filter((value) => value !== status?.dpi)]
      .filter((value): value is number => typeof value === "number")
      .slice(0, MAX_EDITOR_ROWS);
    while (ordered.length < MAX_EDITOR_ROWS) ordered.push(ordered[ordered.length - 1] ?? 800);
    return ordered.map((value) => ({ enabled: value === status?.dpi, value: String(value), valueY: String(value), lod: DEFAULT_LOD }));
  };

  const [rows, setRows] = useState<StageRow[]>(initRows);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const touchedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const fixedStageCount = mode === "stage" && stageEditor?.countEditable !== true;
  const fillsStageTable = singleFillsStageTable(snapshot);
  const singleFillsStages = mode === "generic" && fillsStageTable;

  const stagesDifferFrom = (dpi: number): boolean => (status?.dpiStages ?? []).some((value) => value !== dpi);

  const applySingleDpi = (dpi: number): void => {
    if (!singleFillsStages) {
      control.applyDpiValue(dpi);
      return;
    }
    const deviceStages = snapshot.deviceStatus?.dpiStages;
    if (deviceStages && !isUniform(deviceStages)) control.rememberDpiStagesBeforeSingle(deviceStages);
    (status?.dpiStages ?? []).forEach((value, stage) => {
      if (value !== dpi) control.applyDpiStageValue(stage, dpi);
    });
  };

  const restoreStagesBeforeSingle = (): void => {
    const backup = control.dpiStagesBeforeSingle();
    const stages = status?.dpiStages;
    if (!backup || !stages || backup.length !== stages.length || !isUniform(stages)) return;
    backup.forEach((dpi, stage) => {
      if (stages[stage] !== dpi) control.applyDpiStageValue(stage, dpi);
    });
  };
  // A table the driver cannot write is inert: no value edits, no active-stage
  // switch. Kept distinct from `locked` (settings-pending) because the note
  // and the disabled reasons are different.
  const stageReadOnly = mode === "stage" && !stagesWritable && !activeWritable;

  // Rebuild local rows only when the device source clearly changes while the
  // user is not mid-edit; disabled-but-kept rows are local and must survive.
  const sourceSig = mode === "logitech"
    ? (snapshot.dpiSlotPlan?.stages.map((stage) => `${stage.x}/${stage.y}`).join(",") ?? "-")
    : mode === "stage"
      ? `${status?.dpiStages?.join(",") ?? "-"}|${status?.dpiStagesY?.join(",") ?? "-"}`
      : String(status?.dpi ?? 0);
  const lastSigRef = useRef(sourceSig);
  useEffect(() => {
    if (sourceSig === lastSigRef.current) return;
    lastSigRef.current = sourceSig;
    if (Date.now() - touchedRef.current > 1500 || (mode === "logitech" && !timerRef.current)) setRows(initRows(rowsRef.current));
    // initRows is recreated each render on purpose so it always reads fresh snapshot data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSig]);

  // Switching the editor pill rebuilds the rows from the other mode's source
  // (single DPI reads presets, stages read the device stage table).
  const lastModeRef = useRef(mode);
  useEffect(() => {
    if (mode === lastModeRef.current) return;
    lastModeRef.current = mode;
    setRows(initRows());
    if (singleFillsStages && status?.dpi && stagesDifferFrom(status.dpi)) applySingleDpi(status.dpi);
    if (mode === "stage" && fillsStageTable) restoreStagesBeforeSingle();
    // initRows is recreated each render on purpose so it always reads fresh snapshot data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const compactIndex = (target: number): number =>
    rows.slice(0, target).reduce((count, row) => count + (row.enabled ? 1 : 0), 0);

  const parseRow = (raw: string): number | null =>
    /^\d+$/.test(raw.trim()) && Number(raw) > 0 ? Number(raw) : null;

  const commit = (next: StageRow[]): void => {
    if (mode === "logitech") {
      // Lift-off lives in the slot plan itself now (edited from the dedicated
      // side panel), so a DPI-value commit must not clobber it with the local
      // row copy. Enabled rows map 1:1 to plan stages in order.
      const planLods = snapshot.dpiSlotPlan?.stages.map((stage) => stage.lod) ?? [];
      control.applyDpiSlotEditor(
        next.map((row, index) => {
          const position = next.slice(0, index).filter((entry) => entry.enabled).length;
          return {
            enabled: row.enabled,
            value: parseRow(row.value) ?? (limits?.minDpi ?? 100),
            valueY: slotAxesEditable ? parseRow(row.valueY) ?? undefined : undefined,
            lod: planLods[position] ?? row.lod,
          };
        }),
      );
      return;
    }
    if (mode === "stage") {
      const enabled = next.filter((row) => row.enabled);
      const current = status?.dpiStages ?? [];
      const currentY = status?.dpiStagesY ?? [];
      const currentCount = current.length;
      if (stageEditor?.countEditable === true && enabled.length !== currentCount) {
        control.applyDpiStageCount(enabled.length);
      }
      enabled.forEach((row, position) => {
        const value = parseRow(row.value);
        const valueY = parseRow(row.valueY);
        if (stageAxesEditable) {
          // Send only the axes the user actually moved, so the untouched one
          // stays whatever the mouse holds.
          const edit: { x?: number; y?: number } = {};
          if (value !== null && current[position] !== value) edit.x = value;
          if (valueY !== null && currentY[position] !== valueY) edit.y = valueY;
          if (edit.x !== undefined || edit.y !== undefined) control.applyDpiStageAxes(position, edit);
          return;
        }
        if (value === null || current[position] === value) return;
        control.applyDpiStageValue(position, value);
      });
      return;
    }
    const active = next.find((row) => row.enabled);
    if (!active) return;
    const snap = closestDpiOption(options, parseRow(active.value) ?? status?.dpi ?? 0);
    if (snap !== null && (singleFillsStages ? stagesDifferFrom(snap) : snap !== status?.dpi)) {
      applySingleDpi(snap);
      const next2 = next.map((row) => (row.enabled ? { ...row, value: String(snap) } : row));
      setRows(next2);
      rowsRef.current = next2;
    }
  };

  const markEdited = (next: StageRow[], delay = 450): void => {
    touchedRef.current = Date.now();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      commit(rowsRef.current);
    }, delay);
    void next;
  };

  const flushEdit = (): void => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    commit(rowsRef.current);
  };

  const setEnabled = (index: number, enabled: boolean): void => {
    let next = rows.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row));
    if (mode === "generic") {
      if (!enabled || next[index].enabled === rows[index].enabled) return;
      const snap = closestDpiOption(options, parseRow(next[index].value) ?? status?.dpi ?? 0);
      if (snap === null) return;
      const selected = next.map((row, i) => (i === index ? { ...row, enabled: true } : { ...row, enabled: false }));
      setRows(selected);
      rowsRef.current = selected;
      applySingleDpi(snap);
      touchedRef.current = Date.now();
      return;
    }
    // K-snake stores a stage count, not an arbitrary bitmask. Keep the local
    // editor contiguous so disabling stage 3 cannot silently move stage 6's
    // value into stage 5 on the next write.
    if (mode === "stage" && stageEditor?.countEditable === true) {
      const currentCount = rows.filter((row) => row.enabled).length;
      const nextCount = next[index]?.enabled
        ? Math.max(currentCount, index + 1)
        : Math.max(1, Math.min(currentCount, index));
      next = next.map((row, i) => ({ ...row, enabled: i < nextCount }));
    }
    const count = next.filter((row) => row.enabled).length;
    if (count < 1 || count > countCap) return;
    if (fixedStageCount) return;
    setRows(next);
    rowsRef.current = next;
    markEdited(next);
  };

  const TYPING_DELAY = 1200;

  const setValue = (index: number, raw: string, delay?: number): void => {
    const value = raw.replace(/[^\d]/g, "");
    const next = rows.map((row, i) => (i === index
      ? { ...row, value, valueY: slotAxesEditable && row.linked !== false ? value : row.valueY }
      : row));
    setRows(next);
    rowsRef.current = next;
    markEdited(next, delay);
  };

  const inputEdit = (event: Event, oldRaw: string): { raw: string; delay?: number } => {
    const raw = (event.currentTarget as HTMLInputElement).value;
    const type = (event as InputEvent).inputType;
    if (type && type !== "insertReplacementText") return { raw, delay: TYPING_DELAY };
    const old = parseRow(oldRaw);
    const wanted = Number(raw);
    if (mode !== "logitech" || old === null || !Number.isFinite(wanted) || wanted === old) return { raw };
    const sorted = [...options].sort((a, b) => a - b);
    const neighbour = wanted > old
      ? sorted.find((option) => option > old)
      : [...sorted].reverse().find((option) => option < old);
    return { raw: String(neighbour ?? wanted) };
  };

  const toggleLink = (index: number): void => {
    const next = rows.map((row, i) => {
      if (i !== index) return row;
      const linked = row.linked === false;
      return { ...row, linked, valueY: linked ? row.value : row.valueY };
    });
    setRows(next);
    rowsRef.current = next;
    markEdited(next);
  };

  const setValueY = (index: number, raw: string, delay?: number): void => {
    const next = rows.map((row, i) => (i === index ? { ...row, valueY: raw.replace(/[^\d]/g, "") } : row));
    setRows(next);
    rowsRef.current = next;
    markEdited(next, delay);
  };

  const setSlider = (index: number, numeric: number): void => setValue(index, String(numeric));

  const setActive = (index: number): void => {
    // In the single-DPI view the row number picks that preset, like its tickbox.
    if (mode === "generic") {
      if (!rows[index].enabled) setEnabled(index, true);
      return;
    }
    if (!rows[index].enabled) return;
    if (mode === "logitech") {
      control.setDpiSlotDefault(compactIndex(index));
      return;
    }
    if (mode === "stage") {
      control.applyActiveDpiStage(compactIndex(index));
      return;
    }
    setEnabled(index, !rows[index].enabled);
  };

  const sliderFor = (row: StageRow): { min: number; max: number; step: number; pos: number } => {
    if (mode === "logitech" && limits) {
      const value = Math.min(limits.maxDpi, Math.max(limits.minDpi, parseRow(row.value) ?? limits.minDpi));
      return { min: limits.minDpi, max: limits.maxDpi, step: limits.stepDpi, pos: value };
    }
    if (mode === "stage" && stageEditor) {
      const value = Math.min(stageEditor.maxDpi, Math.max(stageEditor.minDpi, parseRow(row.value) ?? stageEditor.minDpi));
      return { min: stageEditor.minDpi, max: stageEditor.maxDpi, step: stageEditor.stepDpi, pos: value };
    }
    const target = parseRow(row.value) ?? status?.dpi ?? 0;
    const pos = options.length > 0 ? closestDpiOption(options, target) ?? 0 : 0;
    const idx = Math.max(0, options.indexOf(pos));
    return { min: 0, max: Math.max(0, options.length - 1), step: 1, pos: idx };
  };

  const sliderCommit = (index: number, numeric: number): void => {
    if (mode === "generic") {
      const snapped = options[Math.round(numeric)];
      if (snapped !== undefined) setSlider(index, snapped);
      return;
    }
    setSlider(index, Math.round(numeric));
  };

  const rowTitle = mode === "logitech" ? t(locale, "dpi.makeStarting") : t(locale, "dpi.makeActive");
  const note =
    stageReadOnly
      ? t(locale, "dpi.stagesReadOnly")
      : mode === "logitech"
        ? locked
          ? t(locale, "dpi.slotReadonly")
          : t(locale, "dpi.editorCountNote")
        : fixedStageCount
          ? tp(locale, "dpi.editorFixedNote", { total: status?.dpiStages?.length ?? 0 })
          : mode === "stage"
            ? t(locale, "dpi.editorCountNote")
            : singleFillsStages
              ? tp(locale, "dpi.singleOverwritesNote", { total: status?.dpiStages?.length ?? 0 })
              : t(locale, "dpi.editorGenericNote");

  const enabledCount = rows.filter((row) => row.enabled).length;

  return (
    <div id="dpi-stage-editor" className={`dpi-editor mode-${mode}${slotAxesEditable ? " has-slot-axes" : ""}${showStageColors ? " has-m2nex-stage-colors" : ""}${showAxes ? " has-stage-axes" : ""}`}>
      <div className="dpi-editor-bar">
        <span className="dpi-editor-bar-label">
          {t(locale, mode === "logitech" ? "dpi.slotsInUse" : mode === "stage" ? "dpi.stagesInUse" : "dpi.presetsInUse")}
        </span>
        <span className="dpi-editor-bar-count">{enabledCount} / {rows.length}</span>
      </div>
      <div className="dpi-slot-rule" />
      {showAxes ? (
        <div className="dpi-editor-axes-head" aria-hidden="true">
          <span>{t(locale, "dpi.axisX")}</span>
          <span>{t(locale, "dpi.axisY")}</span>
        </div>
      ) : null}
      <div id="dpi-editor-list" className="dpi-editor-list">
        {rows.map((row, index) => {
          const slider = sliderFor(row);
          const isActive = mode === "stage" ? compactIndex(index) === (status?.activeDpiStage ?? 0) : null;
          const isStarting = mode === "logitech" && snapshot.dpiSlotPlan
            ? compactIndex(index) === snapshot.dpiSlotPlan.defaultIndex
            : false;
          const highlighted = mode === "generic" ? row.enabled : mode === "stage" ? isActive === true : isStarting;
          const stageColorClass = showStageColors ? ` m2nex-stage-${index + 1}` : "";
          const stageColor = showStageColors ? stageColors?.[index] : undefined;
          return (
            <div
              key={index}
              className={`dpi-editor-row${row.enabled ? "" : " is-off"}${highlighted ? " is-active" : ""}${stageColorClass}`}
              style={stageColor ? { "--dpi-stage-color": stageColor } as CSSProperties : undefined}
            >
              <label className="dpi-editor-check">
                <input
                  type="checkbox"
                  className="dpi-editor-tick"
                  aria-label={tp(locale, "dpi.stageToggle", { n: index + 1 })}
                  checked={row.enabled}
                  disabled={locked || fixedStageCount || (mode === "stage" && !stagesWritable)}
                  onChange={() => setEnabled(index, !row.enabled)}
                />
                <span className="dpi-editor-box" aria-hidden="true"><Check size={12} strokeWidth={3.2} /></span>
              </label>
              <button
                type="button"
                className="dpi-editor-index"
                disabled={locked || (mode !== "generic" && !row.enabled) || (mode === "stage" && !activeWritable)}
                title={displayText(locale, rowTitle)}
                aria-pressed={highlighted}
                onClick={() => setActive(index)}
              >
                {showStageColors ? <span className="dpi-editor-stage-swatch" aria-hidden="true" /> : null}
                <span>{index + 1}</span>
              </button>
              <input
                type="number"
                className="dpi-editor-value"
                aria-label={tp(locale, "dpi.stageDpi", { n: index + 1 })}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={row.value}
                disabled={locked || (mode === "stage" && !stagesWritable)}
                onChange={(event) => {
                  const edit = inputEdit(event, row.value);
                  setValue(index, edit.raw, edit.delay);
                }}
                onBlur={flushEdit}
                onKeyDown={(event) => { if (event.key === "Enter") flushEdit(); }}
              />
              {slotAxesEditable ? (
                <button
                  type="button"
                  className={`dpi-axis-lock${row.linked === false ? "" : " is-linked"}`}
                  disabled={locked || !row.enabled}
                  title={row.linked === false ? t(locale, "dpi.unlinkedHint") : t(locale, "dpi.linkedHint")}
                  aria-label={tp(locale, "dpi.linkXY", { n: index + 1 })}
                  aria-pressed={row.linked !== false}
                  onClick={() => toggleLink(index)}
                >
                  {row.linked === false ? <IconUnlinked /> : <IconLinked />}
                </button>
              ) : null}
              {showAxes ? (
                <input
                  type="number"
                  className="dpi-editor-value dpi-editor-value-y"
                  aria-label={tp(locale, "dpi.stageDpiY", { n: index + 1 })}
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={row.valueY}
                  disabled={locked || (mode === "stage" && !stagesWritable) || (slotAxesEditable && row.linked !== false)}
                  onChange={(event) => {
                    const edit = inputEdit(event, row.valueY);
                    setValueY(index, edit.raw, edit.delay);
                  }}
                  onBlur={flushEdit}
                  onKeyDown={(event) => { if (event.key === "Enter") flushEdit(); }}
                />
              ) : null}
              <input
                type="range"
                className="dpi-editor-slider"
                aria-label={tp(locale, "dpi.stageDpi", { n: index + 1 })}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={slider.pos}
                disabled={locked || (mode === "stage" && !stagesWritable)}
                style={{ "--fill": `${((slider.pos - slider.min) / Math.max(1, slider.max - slider.min)) * 100}%` } as CSSProperties}
                onChange={(event) => sliderCommit(index, Number(event.currentTarget.value))}
              />
            </div>
          );
        })}
      </div>
      <small className={`setting-note${singleFillsStages ? " setting-note-warning" : ""}`}>{displayText(locale, note)}</small>
    </div>
  );
}

export function SlotLiftOffPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
  const stages = snapshot.dpiSlotPlan?.stages ?? [];
  const locked = snapshot.profile.slotsLocked;
  const levels = snapshot.profileFormat ? capabilitiesForFormat(snapshot.profileFormat.id).supportedLods : [];
  const [openMenu, setOpenMenu] = useState<number | null>(null);

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

  // Hooks above must run every render; safe to bail once they have.
  if (!status) return null;

  return (
    <div id="host-lod-row">
      <div className="setting-heading">
        <div>
          <div className="title-row">
            <h2>{t(locale, "perf.liftOff")}</h2>
          </div>
        </div>
      </div>
      <div className="slot-lod-list">
        {stages.map((stage, index) => {
          const level = stageLodLevel(stage.lod);
          return (
            <div key={index} className="slot-lod-row">
              <span className="slot-lod-index">{index + 1}</span>
              <div className={`lod-select dpi-editor-lod${openMenu === index ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="lod-select-value"
                  disabled={locked}
                  aria-haspopup="listbox"
                  aria-expanded={openMenu === index}
                  aria-label={tp(locale, "dpi.slotLiftOff", { n: index + 1 })}
                  title={t(locale, "dpi.liftOffTitle")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenu(openMenu === index ? null : index);
                  }}
                >
                  <span>{displayText(locale, level ?? "—")}</span>
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
                      {displayText(locale, name)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
      <small id="lod-note" className="setting-note">{t(locale, "perf.lodNote")}</small>
    </div>
  );
}

export function DpiCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  // A table with one value in every stage is what Single saved, so reopen in that view.
  const [editorView, setEditorView] = useState<"stage" | "single">(() => (
    singleFillsStageTable(snapshot) && isUniform(snapshot.deviceStatus?.dpiStages) ? "single" : "stage"
  ));
  const status = snapshot.status;
  const deviceStatus = snapshot.deviceStatus;
  const locale = snapshot.preferences.locale;
  if (!status || !deviceStatus) return null;
  const staged = snapshot.pending.keys.includes("dpi")
    || snapshot.pending.keys.includes("dpi-stage-count")
    || snapshot.pending.keys.includes("dpi-active-stage")
    || snapshot.pending.keys.includes("logitech-dpi-slots")
    || snapshot.pending.keys.some((key) => key.startsWith("dpi-stage-"))
    || snapshot.pending.keys.includes("lift-off-distance");
  const slotsAvailable = snapshot.profile.slotsAvailable;
  const slotLods = snapshot.profileFormat ? capabilitiesForFormat(snapshot.profileFormat.id).supportedLods : [];
  const showLiftOff = slotsAvailable ? slotLods.length > 0 : hasLiftOff(snapshot);
  // Mice whose DPI card holds multiple values get the Slots/Single or
  // Stages/Single pill so they can collapse down to a plain single-DPI editor.
  // Logitech slot mice write the live DPI via the extended DPI feature in
  // single mode (independent of the profile); stage mice read their stage table.
  const slotsEditor = slotsAvailable && snapshot.dpiSlotPlan !== null;
  const stageCapable =
    slotsEditor
    || (Boolean(status?.ui?.dpiStageEditor)
      && Array.isArray(status?.dpiStages)
      && (status?.dpiStages?.length ?? 0) > 0);
  const singleDpiAvailable = !isNoirS1Status(status) && !isNoirE1Status(status);

  const label = (source: typeof status): string => `${source.dpi.toLocaleString()} DPI`;

  return (
    <article
      className={`setting-card dpi-card${staged ? " is-staged" : ""}${showLiftOff ? " has-lift-off" : ""}`}
      data-pending-key="dpi dpi-stage-count dpi-active-stage logitech-dpi-slots lift-off-distance"
    >
      <div className="dpi-card-main">
        <div className="setting-heading">
          <div className="dpi-heading-label">
            <div>
              <h2>
                {t(locale, "dpi.sensitivity")}
                {snapshot.editedProfile !== null ? (
                  <span className="setting-scope" id="dpi-scope-badge">{displayText(locale, slotsAvailable ? t(locale, "dpi.perProfile") : "Host")}</span>
                ) : null}
              </h2>
            </div>
            {stageCapable && singleDpiAvailable ? (
              <div
                className="dpi-view-toggle"
                role="group"
                aria-label={t(locale, slotsEditor ? "dpi.viewSlotsToggle" : "dpi.viewToggle")}
              >
                <button
                  type="button"
                  className={editorView === "stage" ? "is-on" : ""}
                  aria-pressed={editorView === "stage"}
                  onClick={() => setEditorView("stage")}
                >
                  {t(locale, slotsEditor ? "dpi.viewSlots" : "dpi.viewStages")}
                </button>
                <button
                  type="button"
                  className={editorView === "single" ? "is-on" : ""}
                  aria-pressed={editorView === "single"}
                  onClick={() => setEditorView("single")}
                >
                  {t(locale, "dpi.viewSingle")}
                </button>
              </div>
            ) : null}
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
              {displayText(locale, snapshot.customDpiEditing ? t(locale, "common.apply") : t(locale, "common.custom"))}
            </button>
          </div>
        </div>

        <DpiStageEditor
          snapshot={snapshot}
          editorView={stageCapable && singleDpiAvailable ? editorView : stageCapable ? "stage" : undefined}
        />

        <div className="setting-action">
          <span id="dpi-pending">
            {displayText(locale, staged ? tp(locale, "common.staged", { v: label(status) }) : tp(locale, "common.current", { v: label(deviceStatus) }))}
          </span>
        </div>
      </div>

      {showLiftOff ? (
        <div className="dpi-card-lift">
          {slotsAvailable ? <SlotLiftOffPanel snapshot={snapshot} /> : <LiftOffDistance snapshot={snapshot} />}
        </div>
      ) : null}
    </article>
  );
}
