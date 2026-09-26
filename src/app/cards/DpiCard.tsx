import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  capabilitiesForFormat,
  stageLodLevel,
} from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import * as control from "../../device/controller";
import type { ControlSnapshot, LiftOffLevel } from "../../device/types";
import { closestDpiOption, dpiPresetValues } from "../../dpi-presets";
import { t, tp } from "../../i18n";
import { LiftOffDistance, hasLiftOff } from "./PerformanceCards";

const MAX_EDITOR_ROWS = 4;
const DEFAULT_LOD = 2;

type StageRow = { enabled: boolean; value: string; lod: number };

/**
 * One DPI editor for every device flavor. It always shows up to four rows,
 * each with a tickbox (include the stage in the DPI cycle), a typed value, and
 * a slider. Slot/stage devices instead render one row per advertised stage
 * (`maxStages`), so the row count matches what the mouse actually accepts.
 * Disabled rows keep their value locally so re-enabling restores it.
 * Logitech slots additionally carry a lift-off picker.
 */
function DpiStageEditor({
  snapshot,
  editorView,
}: {
  snapshot: ControlSnapshot;
  /** Overrides the natural mode: "single" forces the single-DPI (generic)
      editor even when the device exposes DPI stages or profile slots. */
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
  const limits = snapshot.profile.slotLimits;
  // The single-DPI (generic) view writes the live DPI, not the profile, so it
  // must not be gated behind the profile's slot-write lock.
  const locked = mode === "logitech" ? snapshot.profile.slotsLocked : snapshot.settingsPending;

  const countCap = isLogitech ? (limits?.maxStages ?? 1) : stageEditor?.maxStages ?? 1;
  const rowCap = mode === "generic" ? MAX_EDITOR_ROWS : countCap;

  const initRows = (): StageRow[] => {
    if (mode === "logitech" && snapshot.dpiSlotPlan) {
      const stages = snapshot.dpiSlotPlan.stages.slice(0, rowCap);
      const last = stages[stages.length - 1]?.x ?? status?.dpi ?? 800;
      const rows = stages.map((stage) => ({ enabled: true, value: String(stage.x), lod: stage.lod }));
      while (rows.length < rowCap) rows.push({ enabled: false, value: String(last), lod: DEFAULT_LOD });
      return rows;
    }
    if (mode === "stage" && status?.dpiStages) {
      const stages = status.dpiStages.slice(0, rowCap);
      const last = stages[stages.length - 1] ?? status.dpi ?? 800;
      const rows = stages.map((value) => ({ enabled: true, value: String(value), lod: DEFAULT_LOD }));
      while (rows.length < rowCap) rows.push({ enabled: false, value: String(last), lod: DEFAULT_LOD });
      return rows;
    }
    const presets = dpiPresetValues(options);
    const ordered = [status?.dpi, ...presets.filter((value) => value !== status?.dpi)]
      .filter((value): value is number => typeof value === "number")
      .slice(0, MAX_EDITOR_ROWS);
    while (ordered.length < MAX_EDITOR_ROWS) ordered.push(ordered[ordered.length - 1] ?? 800);
    return ordered.map((value) => ({ enabled: value === status?.dpi, value: String(value), lod: DEFAULT_LOD }));
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
  // A table the driver cannot write is inert: no value edits, no active-stage
  // switch. Kept distinct from `locked` (settings-pending) because the note
  // and the disabled reasons are different.
  const stageReadOnly = mode === "stage" && !stagesWritable && !activeWritable;

  // Rebuild local rows only when the device source clearly changes while the
  // user is not mid-edit; disabled-but-kept rows are local and must survive.
  const sourceSig = mode === "logitech"
    ? (snapshot.dpiSlotPlan?.stages.map((stage) => stage.x).join(",") ?? "-")
    : mode === "stage"
      ? (status?.dpiStages?.join(",") ?? "-")
      : String(status?.dpi ?? 0);
  const lastSigRef = useRef(sourceSig);
  useEffect(() => {
    if (sourceSig === lastSigRef.current) return;
    lastSigRef.current = sourceSig;
    if (Date.now() - touchedRef.current > 1500) setRows(initRows());
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
            lod: planLods[position] ?? row.lod,
          };
        }),
      );
      return;
    }
    if (mode === "stage") {
      const enabled = next.filter((row) => row.enabled);
      const current = status?.dpiStages ?? [];
      if (stageEditor?.countEditable === true && enabled.length !== current.length) {
        control.applyDpiStageCount(enabled.length);
      }
      enabled.forEach((row, position) => {
        const value = parseRow(row.value);
        if (value === null || current[position] === value) return;
        control.applyDpiStageValue(position, value);
      });
      return;
    }
    const active = next.find((row) => row.enabled);
    if (!active) return;
    const snap = closestDpiOption(options, parseRow(active.value) ?? status?.dpi ?? 0);
    if (snap !== null && snap !== status?.dpi) {
      control.applyDpiValue(snap);
      const next2 = next.map((row) => (row.enabled ? { ...row, value: String(snap) } : row));
      setRows(next2);
      rowsRef.current = next2;
    }
  };

  const markEdited = (next: StageRow[]): void => {
    touchedRef.current = Date.now();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(rowsRef.current), 450);
    void next;
  };

  const setEnabled = (index: number, enabled: boolean): void => {
    const next = rows.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row));
    if (mode === "generic") {
      if (!enabled || next[index].enabled === rows[index].enabled) return;
      const snap = closestDpiOption(options, parseRow(next[index].value) ?? status?.dpi ?? 0);
      if (snap === null) return;
      const selected = next.map((row, i) => (i === index ? { ...row, enabled: true } : { ...row, enabled: false }));
      setRows(selected);
      rowsRef.current = selected;
      control.applyDpiValue(snap);
      touchedRef.current = Date.now();
      return;
    }
    const count = next.filter((row) => row.enabled).length;
    if (count < 1 || count > countCap) return;
    if (fixedStageCount) return;
    setRows(next);
    rowsRef.current = next;
    markEdited(next);
  };

  const setValue = (index: number, raw: string): void => {
    const next = rows.map((row, i) => (i === index ? { ...row, value: raw.replace(/[^\d]/g, "") } : row));
    setRows(next);
    rowsRef.current = next;
    markEdited(next);
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
            : t(locale, "dpi.editorGenericNote");

  const enabledCount = rows.filter((row) => row.enabled).length;

  return (
    <div id="dpi-stage-editor" className={`dpi-editor mode-${mode}`}>
      <div className="dpi-editor-bar">
        <span className="dpi-editor-bar-label">
          {t(locale, mode === "logitech" ? "dpi.slotsInUse" : mode === "stage" ? "dpi.stagesInUse" : "dpi.presetsInUse")}
        </span>
        <span className="dpi-editor-bar-count">{enabledCount} / {rows.length}</span>
      </div>
      <div className="dpi-slot-rule" />
      <div id="dpi-editor-list" className="dpi-editor-list">
        {rows.map((row, index) => {
          const slider = sliderFor(row);
          const isActive = mode === "stage" ? compactIndex(index) === (status?.activeDpiStage ?? 0) : null;
          const isStarting = mode === "logitech" && snapshot.dpiSlotPlan
            ? compactIndex(index) === snapshot.dpiSlotPlan.defaultIndex
            : false;
          const highlighted = mode === "generic" ? row.enabled : mode === "stage" ? isActive === true : isStarting;
          return (
            <div key={index} className={`dpi-editor-row${row.enabled ? "" : " is-off"}${highlighted ? " is-active" : ""}`}>
              <input
                type="checkbox"
                className="dpi-editor-tick"
                aria-label={tp(locale, "dpi.stageToggle", { n: index + 1 })}
                checked={row.enabled}
                disabled={locked || fixedStageCount || (mode === "stage" && !stagesWritable)}
                onChange={() => setEnabled(index, !row.enabled)}
              />
              <button
                type="button"
                className="dpi-editor-index"
                disabled={locked || (mode !== "generic" && !row.enabled) || (mode === "stage" && !activeWritable)}
                title={rowTitle}
                aria-pressed={highlighted}
                onClick={() => setActive(index)}
              >
                {index + 1}
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
                onChange={(event) => setValue(index, event.currentTarget.value)}
              />
              <input
                type="range"
                className="dpi-editor-slider"
                aria-label={tp(locale, "dpi.stageDpi", { n: index + 1 })}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={slider.pos}
                disabled={locked || (mode === "stage" && !stagesWritable)}
                onChange={(event) => sliderCommit(index, Number(event.currentTarget.value))}
              />
            </div>
          );
        })}
      </div>
      <small className="setting-note">{note}</small>
    </div>
  );
}

export function SlotLiftOffPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  if (!status) return null;
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

  return (
    <div id="host-lod-row">
      <div className="setting-heading">
        <div>
          <div className="title-row">
            <h2>{t(locale, "perf.liftOff")}</h2>
            <p>SENSOR</p>
          </div>
          <small id="lod-note" className="setting-note">
            {t(locale, "perf.lodNote")}
          </small>
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
    </div>
  );
}

export function DpiCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [editorView, setEditorView] = useState<"stage" | "single">("stage");
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
              <p>DPI</p>
              <h2>
                {t(locale, "dpi.sensitivity")}
                {snapshot.editedProfile !== null ? (
                  <span className="setting-scope" id="dpi-scope-badge">{slotsAvailable ? t(locale, "dpi.perProfile") : "Host"}</span>
                ) : null}
              </h2>
            </div>
            {stageCapable ? (
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
              {snapshot.customDpiEditing ? t(locale, "common.apply") : t(locale, "common.custom")}
            </button>
          </div>
        </div>

        <DpiStageEditor
          snapshot={snapshot}
          editorView={stageCapable ? editorView : undefined}
        />

        <div className="setting-action">
          <span id="dpi-pending">
            {staged ? tp(locale, "common.staged", { v: label(status) }) : tp(locale, "common.current", { v: label(deviceStatus) })}
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