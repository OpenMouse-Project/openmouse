import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import {
  INCOTT_BUTTON_NAMES,
  INCOTT_MACRO_MAX_STEPS,
  INCOTT_MACRO_MOUSE_KEYS,
  incottMacroSlotForButton,
  type IncottButtonName,
  type IncottMacroLoop,
  type IncottMacroStep,
} from "@openmouse/protocol/incott";

import * as control from "../../../device/controller";
import {
  INCOTT_MACRO_DEFAULT_ACTION,
  INCOTT_MACRO_KEY_CHOICES,
  appendRecordedStep,
  clampU16,
  emptyMacro,
  incottMacroAssignment,
  incottMacroKeyForCode,
  incottMacroKeyForMouseButton,
  incottMacroKeyName,
  loadStore,
  macroDurationMs,
  saveStore,
  stepsForDevice,
  type MacroDelay,
  type MacroStore,
  type StoredMacro,
} from "../../../device/incott-macros";
import type { ControlSnapshot } from "../../../device/types";
import { displayText, t, tp } from "../../../i18n/index";

const LOOPS: ReadonlyArray<readonly [IncottMacroLoop, "macro.incottLoopHold" | "macro.incottLoopAny" | "macro.incottLoopCount"]> = [
  ["untilKeyRelease", "macro.incottLoopHold"],
  ["untilAnyKey", "macro.incottLoopAny"],
  ["cycle", "macro.incottLoopCount"],
];

const TIMINGS: ReadonlyArray<readonly [MacroDelay["mode"], "macro.timingFast" | "macro.timingRecorded" | "macro.timingFixed"]> = [
  ["none", "macro.timingFast"],
  ["recorded", "macro.timingRecorded"],
  ["fixed", "macro.timingFixed"],
];

/** The gap a hand-added step starts with, before anyone edits it. */
const MANUAL_GAP_MS = 40;

const isRecorderControl = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest("[data-macro-recorder-control]"));

/**
 * Incott onboard macros. The mouse takes a macro buffer and never returns one,
 * so the macros live in this browser (`device/incott-macros.ts`) and a button
 * only shows one while the mouse's own button mapping says it runs a macro.
 */
export function IncottMacroCard({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const status = snapshot.status;
  const locale = snapshot.preferences.locale;
  const [store, setStore] = useState<MacroStore>(() => loadStore());
  const [draft, setDraft] = useState<StoredMacro | null>(() => {
    const first = store.macros[0];
    return first ? { ...first, steps: first.steps.slice() } : null;
  });
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<IncottMacroStep[]>([]);
  const recordedRef = useRef<IncottMacroStep[]>([]);
  const clockRef = useRef<number | null>(null);
  const heldRef = useRef<Set<number>>(new Set());
  const recorderFocusRef = useRef<HTMLElement | null>(null);

  const disabled = snapshot.settingInProgress || snapshot.pending.busy;
  const controlsDisabled = disabled || isRecording;

  const finishRecording = (): void => {
    const recorded = recordedRef.current;
    setIsRecording(false);
    setDraft((current) => (current && recorded.length > 0 ? { ...current, steps: recorded } : current));
    setRecordedSteps([]);
    recordedRef.current = [];
    clockRef.current = null;
  };

  const cancelRecording = (): void => {
    setIsRecording(false);
    setRecordedSteps([]);
    recordedRef.current = [];
    clockRef.current = null;
  };

  useEffect(() => {
    if (!isRecording) return undefined;
    // The Record button keeps focus after the click, and keys aimed at it are
    // read as UI input, so move focus to the recorder before the first key.
    recorderFocusRef.current?.focus();
    const held = heldRef.current;

    const record = (key: number | null, press: boolean, event: Event): void => {
      if (key === null) return;
      event.preventDefault();
      event.stopPropagation();
      const now = performance.now();
      const gap = clockRef.current === null ? 0 : now - clockRef.current;
      clockRef.current = now;
      recordedRef.current = appendRecordedStep(recordedRef.current, key, press, gap);
      setRecordedSteps(recordedRef.current);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isRecorderControl(event.target)) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishRecording();
        return;
      }
      const key = incottMacroKeyForCode(event.code);
      // Browsers repeat a held key; the buffer wants one press, one release.
      if (event.repeat || (key !== null && held.has(key))) return;
      if (key !== null) held.add(key);
      record(key, true, event);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (isRecorderControl(event.target)) return;
      const key = incottMacroKeyForCode(event.code);
      if (key !== null) held.delete(key);
      record(key, false, event);
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (!isRecorderControl(event.target)) record(incottMacroKeyForMouseButton(event.button), true, event);
    };
    const onMouseUp = (event: MouseEvent): void => {
      if (!isRecorderControl(event.target)) record(incottMacroKeyForMouseButton(event.button), false, event);
    };
    const onContextMenu = (event: MouseEvent): void => {
      if (isRecorderControl(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      held.clear();
    };
  }, [isRecording]);

  if (!status) return null;
  const mappings = status.buttonMappings;

  const persist = (next: MacroStore): void => {
    setStore(next);
    saveStore(next);
  };

  /** What each button runs, according to the mouse first and the store second. */
  const assignment = (button: IncottButtonName): string | "elsewhere" | null =>
    incottMacroAssignment(store, button, mappings);

  /**
   * Puts a macro into the buffer belonging to a button and points the button
   * at it. A button runs only the buffer carrying its own index, so a macro
   * reaches the mouse only by being assigned, and one macro on two buttons is
   * uploaded twice.
   */
  const upload = (button: IncottButtonName, macro: StoredMacro): void => {
    const slot = incottMacroSlotForButton(button);
    control.applyIncottMacro(button, {
      bufferId: slot,
      loop: macro.loop,
      cycles: macro.cycles,
      // Echoed back in the buffer trailer and read by nothing, so the button's
      // own index is as good an identifier as any.
      uid: slot + 1,
      steps: stepsForDevice(macro),
    });
    control.applyDeviceButtonMapping(button, "Macro");
  };

  const unbind = (button: IncottButtonName): void => {
    // There is no command to empty a buffer; re-pointing the button is all
    // unassigning can do. An upload still waiting for Apply must not survive,
    // or it would bind the button to Macro again.
    control.cancelIncottMacro(button);
    if (assignment(button) !== null) control.applyDeviceButtonMapping(button, INCOTT_MACRO_DEFAULT_ACTION[button]);
  };

  const assign = (button: IncottButtonName, id: string): void => {
    const assignments = { ...store.assignments };
    if (id === "") {
      delete assignments[button];
      persist({ ...store, assignments });
      unbind(button);
      return;
    }
    const macro = store.macros.find((entry) => entry.id === id);
    if (!macro) return;
    persist({ ...store, assignments: { ...assignments, [button]: id } });
    upload(button, macro);
  };

  const openMacro = (id: string): void => {
    const macro = store.macros.find((entry) => entry.id === id);
    setDraft(macro ? { ...macro, steps: macro.steps.slice() } : null);
  };

  const newMacro = (): void => {
    setDraft(emptyMacro(tp(locale, "macro.incottDefaultName", { n: store.macros.length + 1 })));
  };

  const saveDraft = (): void => {
    if (!draft || draft.steps.length === 0) return;
    const known = store.macros.some((macro) => macro.id === draft.id);
    const next: MacroStore = {
      ...store,
      macros: known
        ? store.macros.map((macro) => (macro.id === draft.id ? draft : macro))
        : [...store.macros, draft],
    };
    persist(next);
    // Re-upload to every button running this macro, so an edit takes effect
    // instead of leaving the old steps on the mouse.
    for (const button of INCOTT_BUTTON_NAMES) {
      if (incottMacroAssignment(next, button, mappings) === draft.id) upload(button, draft);
    }
  };

  const deleteDraft = (): void => {
    if (!draft) return;
    const assignments = { ...store.assignments };
    for (const button of INCOTT_BUTTON_NAMES) {
      if (assignments[button] !== draft.id) continue;
      unbind(button);
      delete assignments[button];
    }
    const macros = store.macros.filter((macro) => macro.id !== draft.id);
    persist({ macros, assignments });
    const first = macros[0];
    setDraft(first ? { ...first, steps: first.steps.slice() } : null);
  };

  const startRecording = (): void => {
    if (controlsDisabled || !draft) return;
    recordedRef.current = [];
    setRecordedSteps([]);
    clockRef.current = null;
    setIsRecording(true);
  };

  const setSteps = (steps: IncottMacroStep[]): void => {
    setDraft((current) => (current ? { ...current, steps } : current));
  };
  const editStep = (index: number, patch: Partial<IncottMacroStep>): void => {
    if (draft) setSteps(draft.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)));
  };
  const moveStep = (index: number, by: -1 | 1): void => {
    if (!draft) return;
    const to = index + by;
    if (to < 0 || to >= draft.steps.length) return;
    const steps = draft.steps.slice();
    [steps[index], steps[to]] = [steps[to]!, steps[index]!];
    setSteps(steps);
  };
  const addTap = (): void => {
    if (!draft || draft.steps.length + 2 > INCOTT_MACRO_MAX_STEPS) return;
    // A tap, not a lone press: a key pressed and never released leaves the
    // host holding it down. Either half can be changed afterwards.
    const key = INCOTT_MACRO_MOUSE_KEYS.left;
    setSteps([
      ...draft.steps,
      { key, press: true, delayMs: MANUAL_GAP_MS },
      { key, press: false, delayMs: MANUAL_GAP_MS },
    ]);
  };

  const saved = draft ? store.macros.find((macro) => macro.id === draft.id) ?? null : null;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const onButtons = draft
    ? INCOTT_BUTTON_NAMES.some((button) => assignment(button) === draft.id)
    : false;
  const staged = snapshot.pending.keys.some((key) => key.startsWith("incott-macro-"));
  const keyOptions = (keys: readonly number[]): ReactNode =>
    keys.map((key) => <option key={key} value={key}>{displayText(locale, incottMacroKeyName(key))}</option>);
  const stepLabel = (step: IncottMacroStep): string =>
    `${t(locale, step.press ? "macro.incottPress" : "macro.incottRelease")} · ${displayText(locale, incottMacroKeyName(step.key))}`;

  return (
    <article
      id="incott-macro-settings"
      className={`setting-card${staged ? " is-staged" : ""}`}
      data-pending-key={INCOTT_BUTTON_NAMES.map((button) => `incott-macro-${button}`).join(" ")}
    >
      <div className="setting-heading ksnake-macro-heading">
        <div>
          <h2>{t(locale, "macro.build")}</h2>
          <p className="ksnake-macro-lead">{t(locale, "macro.incottLead")}</p>
        </div>
      </div>
      <p className="ksnake-macro-notice">{t(locale, "macro.incottNotice")}</p>

      <div className="ksnake-macro-slot-picker incott-macro-library">
        {store.macros.length > 0 ? (
          <label className="ksnake-macro-step-field">
            <span>{t(locale, "macro.option")}</span>
            <select
              value={saved ? draft!.id : ""}
              disabled={controlsDisabled}
              onChange={(event) => openMacro(event.currentTarget.value)}
            >
              {saved ? null : <option value="">{t(locale, "macro.incottNew")}</option>}
              {store.macros.map((macro) => (
                <option key={macro.id} value={macro.id}>
                  {macro.name}{displayText(locale, ` · ${tp(locale, "macro.steps", { n: macro.steps.length })}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {draft ? (
          <label className="ksnake-macro-step-field">
            <span>{t(locale, "macro.incottName")}</span>
            <input
              type="text"
              maxLength={24}
              value={draft.name}
              disabled={controlsDisabled}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setDraft((current) => (current ? { ...current, name } : current));
              }}
            />
          </label>
        ) : null}
        <div className="ksnake-macro-recorder-actions">
          <button type="button" data-macro-recorder-control disabled={controlsDisabled} onClick={newMacro}>
            <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
            {t(locale, "macro.incottNew")}
          </button>
        </div>
      </div>

      {store.macros.length > 0 ? (
        <div className="incott-macro-buttons" role="group" aria-label={t(locale, "macro.incottButtons")}>
          {INCOTT_BUTTON_NAMES.map((button) => {
            const runs = assignment(button);
            return (
              <label key={button} className="ksnake-macro-step-field">
                <span>{displayText(locale, button)}</span>
                <select
                  value={runs ?? ""}
                  disabled={controlsDisabled}
                  onChange={(event) => assign(button, event.currentTarget.value)}
                >
                  <option value="">{t(locale, "macro.incottUnassigned")}</option>
                  {runs === "elsewhere" ? <option value="elsewhere" disabled>{t(locale, "macro.incottElsewhere")}</option> : null}
                  {store.macros.map((macro) => <option key={macro.id} value={macro.id}>{macro.name}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      ) : null}

      {!draft ? (
        <div className="ksnake-macro-empty">
          <span>{t(locale, "macro.incottNone")}</span>
        </div>
      ) : (
        <>
          <section
            ref={recorderFocusRef}
            className={`ksnake-macro-recorder${isRecording ? " is-recording" : ""}`}
            aria-live="polite"
            aria-label={t(locale, "macro.recording")}
            tabIndex={-1}
          >
            <div className="ksnake-macro-recorder-status">
              <span className="ksnake-macro-recorder-dot" aria-hidden="true" />
              <div>
                <strong>{t(locale, isRecording ? "macro.recording" : "macro.addActions")}</strong>
                <span>{isRecording
                  ? tp(locale, "macro.eventsHint", { n: recordedSteps.length })
                  : t(locale, "macro.recorderHint")}</span>
              </div>
            </div>
            <div className="ksnake-macro-recorder-tools">
              <label className="ksnake-macro-timing-picker">
                <span>{t(locale, "macro.timing")}</span>
                <select
                  value={draft.delay.mode}
                  disabled={controlsDisabled}
                  data-macro-recorder-control
                  onChange={(event) => {
                    const mode = event.currentTarget.value as MacroDelay["mode"];
                    setDraft({ ...draft, delay: { ...draft.delay, mode } });
                  }}
                >
                  {TIMINGS.map(([value, label]) => <option key={value} value={value}>{t(locale, label)}</option>)}
                </select>
              </label>
              {draft.delay.mode === "fixed" ? (
                <label className="ksnake-macro-fixed-delay-picker">
                  <span>{t(locale, "macro.delay")}</span>
                  <span className="ksnake-macro-fixed-delay-control">
                    <input
                      type="number"
                      min={0}
                      max={65535}
                      aria-label={t(locale, "macro.delayAria")}
                      value={draft.delay.fixedMs}
                      disabled={controlsDisabled}
                      data-macro-recorder-control
                      onChange={(event) => setDraft({
                        ...draft,
                        delay: { ...draft.delay, fixedMs: clampU16(Number(event.currentTarget.value)) },
                      })}
                    />
                    <small>ms</small>
                  </span>
                </label>
              ) : null}
              <label className="ksnake-macro-timing-picker">
                <span>{t(locale, "macro.incottRepeat")}</span>
                <select
                  value={draft.loop}
                  disabled={controlsDisabled}
                  data-macro-recorder-control
                  onChange={(event) => setDraft({ ...draft, loop: event.currentTarget.value as IncottMacroLoop })}
                >
                  {LOOPS.map(([value, label]) => <option key={value} value={value}>{t(locale, label)}</option>)}
                </select>
              </label>
              {draft.loop === "cycle" ? (
                <label className="ksnake-macro-fixed-delay-picker">
                  <span>{t(locale, "macro.incottTimes")}</span>
                  <span className="ksnake-macro-fixed-delay-control">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={draft.cycles}
                      disabled={controlsDisabled}
                      data-macro-recorder-control
                      onChange={(event) => setDraft({ ...draft, cycles: clampU16(Number(event.currentTarget.value), 1) })}
                    />
                  </span>
                </label>
              ) : null}
              {isRecording ? (
                <div className="ksnake-macro-recorder-actions">
                  <button className="ksnake-macro-stop" type="button" data-macro-recorder-control onClick={finishRecording}>{t(locale, "macro.stopRecording")}</button>
                  <button type="button" data-macro-recorder-control onClick={cancelRecording}>{t(locale, "set.cancel")}</button>
                </div>
              ) : (
                <div className="ksnake-macro-recorder-actions">
                  <button type="button" data-macro-recorder-control disabled={disabled} onClick={startRecording}>{t(locale, "macro.recordInput")}</button>
                  <button type="button" data-macro-recorder-control disabled={controlsDisabled || draft.steps.length + 2 > INCOTT_MACRO_MAX_STEPS} onClick={addTap}>
                    <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t(locale, "macro.addManually")}
                  </button>
                </div>
              )}
            </div>
          </section>

          {isRecording ? (
            <div className="ksnake-macro-recording-list">
              <div className="ksnake-macro-recording-list-heading">
                <span>{t(locale, "macro.liveEvents")}</span>
                <span>{displayText(locale, `${recordedSteps.length}/${INCOTT_MACRO_MAX_STEPS}`)}</span>
              </div>
              {recordedSteps.length === 0 ? (
                <p className="ksnake-macro-recording-empty">{t(locale, "macro.recordingEmpty")}</p>
              ) : (
                <ol>
                  {recordedSteps.map((step, index) => (
                    <li key={index}>
                      <span className="ksnake-macro-recording-step-number">{displayText(locale, String(index + 1).padStart(2, "0"))}</span>
                      <strong>{stepLabel(step)}</strong>
                      <small>{step.delayMs} ms</small>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <div className="ksnake-macro-steps">
              {draft.steps.length === 0 ? (
                <div className="ksnake-macro-empty">
                  <strong>{t(locale, "macro.noActions")}</strong>
                  <span>{t(locale, "macro.noActionsHint")}</span>
                </div>
              ) : null}
              {stepsForDevice(draft).map((step, index) => (
                <div className="incott-macro-step" key={index}>
                  <span className="ksnake-macro-step-number">{displayText(locale, String(index + 1).padStart(2, "0"))}</span>
                  <label className="ksnake-macro-step-field is-narrow">
                    <span>{t(locale, "macro.colAction")}</span>
                    <select
                      value={step.press ? "press" : "release"}
                      disabled={controlsDisabled}
                      onChange={(event) => editStep(index, { press: event.currentTarget.value === "press" })}
                    >
                      <option value="press">{t(locale, "macro.incottPress")}</option>
                      <option value="release">{t(locale, "macro.incottRelease")}</option>
                    </select>
                  </label>
                  <label className="ksnake-macro-step-field">
                    <span>{t(locale, "macro.incottKey")}</span>
                    <select
                      value={step.key}
                      disabled={controlsDisabled}
                      onChange={(event) => editStep(index, { key: Number(event.currentTarget.value) })}
                    >
                      <optgroup label={t(locale, "macro.incottMouse")}>{keyOptions(INCOTT_MACRO_KEY_CHOICES.mouse)}</optgroup>
                      <optgroup label={t(locale, "macro.incottKeyboard")}>{keyOptions(INCOTT_MACRO_KEY_CHOICES.keyboard)}</optgroup>
                    </select>
                  </label>
                  {/* Only recorded timing is per step; the other modes give
                      every step the one value the timing picker shows. */}
                  <label className="ksnake-macro-step-field is-narrow">
                    <span>{t(locale, "macro.colDelay")}</span>
                    <input
                      type="number"
                      min={0}
                      max={65535}
                      value={step.delayMs}
                      disabled={controlsDisabled || draft.delay.mode !== "recorded"}
                      onChange={(event) => editStep(index, { delayMs: clampU16(Number(event.currentTarget.value)) })}
                    />
                  </label>
                  <button
                    type="button"
                    className="ksnake-macro-delete incott-macro-move"
                    disabled={controlsDisabled || index === 0}
                    onClick={() => moveStep(index, -1)}
                    aria-label={tp(locale, "macro.incottMoveUp", { n: index + 1 })}
                    title={tp(locale, "macro.incottMoveUp", { n: index + 1 })}
                  >
                    <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ksnake-macro-delete incott-macro-move"
                    disabled={controlsDisabled || index === draft.steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                    aria-label={tp(locale, "macro.incottMoveDown", { n: index + 1 })}
                    title={tp(locale, "macro.incottMoveDown", { n: index + 1 })}
                  >
                    <ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ksnake-macro-delete"
                    disabled={controlsDisabled}
                    onClick={() => setSteps(draft.steps.filter((_, at) => at !== index))}
                    aria-label={tp(locale, "macro.removeStep", { n: index + 1 })}
                    title={t(locale, "macro.removeStepTitle")}
                  >
                    <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="ksnake-macro-lead">
            {tp(locale, "macro.incottSummary", {
              n: draft.steps.length,
              max: INCOTT_MACRO_MAX_STEPS,
              s: (macroDurationMs(stepsForDevice(draft)) / 1000).toFixed(1),
            })}
            {saved && !dirty && !onButtons ? ` · ${t(locale, "macro.incottOffDevice")}` : null}
          </p>

          <div className="setting-action ksnake-macro-actions">
            <button className="ksnake-macro-save" type="button" disabled={controlsDisabled || !dirty || draft.steps.length === 0} onClick={saveDraft}>
              <Save size={16} strokeWidth={2.2} aria-hidden="true" />
              {t(locale, "macro.save")}
            </button>
            <button type="button" disabled={controlsDisabled || draft.steps.length === 0} onClick={() => setSteps([])}>
              {t(locale, "macro.incottClearSteps")}
            </button>
            <button type="button" disabled={controlsDisabled} onClick={deleteDraft}>
              {t(locale, "macro.incottDelete")}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
