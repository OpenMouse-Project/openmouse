import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  VIA_MACRO_DELAY_PROTOCOL, VIA_MACRO_MAX_DELAY_MS, decodeViaMacro, describeViaKeycode, encodeViaMacro, parseViaMacroExpression, viaKeycodePicker,
  viaMacroToExpression, type ViaMacroAction,
} from "@openmouse/keyboard-protocol/via";
import * as control from "../../../device/controller";
import type { ControlSnapshot } from "../../../device/types";
import { viaRecordKey, viaTidyRecording } from "../../../device/via-keyboard";
import { displayText, t, tp, type I18nKey } from "../../../i18n/index";
import { OptionMenu, Segmented } from "../../../shared/ui";

type EditableType = "text" | "tap" | "down" | "up" | "delay";
type Mode = "list" | "code";

const TYPE_LABEL: Record<EditableType, I18nKey> = {
  text: "kb.viaMacroTypeText",
  tap: "kb.viaMacroTypeTap",
  down: "kb.viaMacroTypeDown",
  up: "kb.viaMacroTypeUp",
  delay: "kb.viaMacroTypeDelay",
};
const DEFAULT_KEYCODE = 0x28;
const QMK_KEYCODES_URL = "https://docs.qmk.fm/keycodes_basic";
const ERROR_COLOR: CSSProperties = { color: "var(--bad)" };

/** Every basic keycode a macro can press, named for the board's protocol. */
function keyChoices(protocol: number): { value: number; label: string }[] {
  return viaKeycodePicker(protocol, 0)
    .filter((group) => group.id !== "special" && group.id !== "layers" && group.id !== "macros")
    .flatMap((group) => group.keycodes)
    .filter((code) => code <= 0xff)
    .map((code) => ({ value: code, label: describeViaKeycode(code, protocol).title }));
}

function actionError(action: ViaMacroAction, protocol: number): string | null {
  try {
    encodeViaMacro([action], protocol);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function convert(action: ViaMacroAction, type: EditableType): ViaMacroAction {
  if (type === "text") return { type, text: "" };
  if (type === "delay") return { type, ms: 100 };
  return { type, keycode: action.type === "tap" || action.type === "down" || action.type === "up" ? action.keycode : DEFAULT_KEYCODE };
}

export function ViaMacroEditor({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  const via = keyboard?.workspace.via ?? null;
  const macros = via?.macros ?? null;
  const protocol = via?.protocolVersion ?? 0;
  const [slot, setSlot] = useState(0);
  const [drafts, setDrafts] = useState<Readonly<Record<number, readonly ViaMacroAction[]>>>({});
  const [mode, setMode] = useState<Mode>("list");
  /** What is typed in the code box; null shows the actions as written out. */
  const [codeText, setCodeText] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorded = useRef<ViaMacroAction[]>([]);
  const resetCode = (): void => { setCodeText(null); setCodeError(null); };
  useEffect(() => { setDrafts({}); resetCode(); }, [macros]);
  const keys = useMemo(() => keyChoices(protocol), [protocol]);
  const slotKey = macros ? Math.min(slot, Math.max(macros.macros.length - 1, 0)) : 0;
  const recordDelays = protocol >= VIA_MACRO_DELAY_PROTOCOL;
  useEffect(() => {
    if (!recording) return;
    let last = performance.now();
    const handle = (down: boolean) => (event: KeyboardEvent): void => {
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      const now = performance.now();
      const next = viaRecordKey(recorded.current, { down, code: event.code, gapMs: now - last }, recordDelays);
      if (next.length === recorded.current.length) return;
      last = now;
      recorded.current = next;
      setDrafts((previous) => ({ ...previous, [slotKey]: next }));
    };
    const onDown = handle(true);
    const onUp = handle(false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => { window.removeEventListener("keydown", onDown, true); window.removeEventListener("keyup", onUp, true); };
  }, [recording, slotKey, recordDelays]);
  // Recording swallows every key press, so it only lasts while its Stop button is on screen.
  useEffect(() => { if (mode !== "list" || snapshot.workspaceTab !== "macro") setRecording(false); }, [mode, snapshot.workspaceTab]);
  if (!keyboard) return null;

  const locale = snapshot.preferences.locale;
  const busy = keyboard.trigger.busy;
  const delays = protocol >= VIA_MACRO_DELAY_PROTOCOL;
  const activeSlot = macros ? Math.min(slot, Math.max(macros.macros.length - 1, 0)) : 0;
  const actions: readonly ViaMacroAction[] = macros ? drafts[activeSlot] ?? decodeViaMacro(macros.macros[activeSlot] ?? [], protocol) : [];
  const update = (next: readonly ViaMacroAction[]): void => {
    recorded.current = [...next];
    setDrafts((previous) => ({ ...previous, [activeSlot]: next }));
  };
  const patch = (index: number, action: ViaMacroAction): void => update(actions.map((entry, at) => (at === index ? action : entry)));
  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= actions.length) return;
    const next = [...actions];
    [next[index], next[target]] = [next[target]!, next[index]!];
    update(next);
  };

  const encoded = macros?.macros.map((bytes, index) => {
    const draft = drafts[index];
    if (!draft) return bytes;
    try { return encodeViaMacro(draft, protocol); } catch { return null; }
  }) ?? [];
  const invalid = encoded.some((bytes) => bytes === null);
  const used = encoded.reduce((total, bytes) => total + (bytes ? bytes.length + 1 : 0), 0);
  const fits = macros ? used <= macros.bufferSize : true;
  const dirty = Object.keys(drafts).length > 0;

  const save = (): void => {
    if (!macros || invalid || !fits) return;
    void control.applyKeyboardCommand({ kind: "viaWriteMacros", macros: encoded as number[][] });
  };

  return (
    <article className="setting-card keyboard-workspace-card is-wide" hidden={snapshot.workspaceTab !== "macro"}>
      <div className="setting-heading"><div><h2>{t(locale, "kb.viaMacroTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.viaMacroNote")}</small></div></div>
      {macros ? <>
        <Segmented ariaLabel={t(locale, "kb.viaMacroSlotPicker")} value={activeSlot} disabled={busy || recording}
          options={macros.macros.map((_, index) => ({ value: index, label: drafts[index] ? `${index}•` : String(index) }))}
          onChange={(next) => { setSlot(next); resetCode(); }} />
        <Segmented ariaLabel={t(locale, "kb.viaMacroModePicker")} value={mode} disabled={busy}
          options={[{ value: "list" as Mode, label: t(locale, "kb.viaMacroModeList") }, { value: "code" as Mode, label: t(locale, "kb.viaMacroModeCode") }]}
          onChange={(next) => { setMode(next); resetCode(); }} />
        {mode === "code" ? <div className="keyboard-fields">
          <textarea rows={6} spellcheck={false} aria-label={t(locale, "kb.viaMacroCodeLabel")} value={codeText ?? viaMacroToExpression(actions, protocol)} disabled={busy}
            style={{ width: "100%", fontFamily: "var(--font-mono)" }}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setCodeText(value);
              try {
                update(parseViaMacroExpression(value, protocol));
                setCodeError(null);
              } catch (error) {
                setCodeError(error instanceof Error ? error.message : String(error));
              }
            }} />
          {codeError ? <small className="setting-note" style={ERROR_COLOR} role="alert">{displayText(locale, codeError)}</small> : null}
          <small className="setting-note">{t(locale, "kb.viaMacroCodeHelp")}</small>
          <a href={QMK_KEYCODES_URL} target="_blank" rel="noopener noreferrer">{t(locale, "kb.viaMacroCodeDocs")}</a>
        </div> : <>
          {actions.length === 0 ? <p className="keyboard-empty">{t(locale, "kb.viaMacroEmpty")}</p> : null}
          <div>
            {actions.map((action, index) => {
              const error = actionError(action, protocol);
              return (
                <div className="keyboard-macro-event" key={index}>
                  <span>{index + 1}</span>
                  {action.type === "raw"
                    ? <span className="setting-note" style={{ gridColumn: "2 / 4" }}>{tp(locale, "kb.viaMacroRaw", { n: action.bytes.length })}</span>
                    : <>
                      <div className="keyboard-field">
                        <OptionMenu ariaLabel={t(locale, "kb.viaMacroActionType")} value={action.type} disabled={busy}
                          options={(Object.keys(TYPE_LABEL) as EditableType[]).map((type) => ({ value: type, label: t(locale, TYPE_LABEL[type]), disabled: type === "delay" && !delays }))}
                          onChange={(type) => patch(index, convert(action, type))} />
                      </div>
                      <div className="keyboard-field">
                        {action.type === "text"
                          ? <input type="text" autoComplete="off" spellcheck={false} aria-label={t(locale, "kb.viaMacroText")} value={action.text} disabled={busy}
                            onInput={(event) => patch(index, { type: "text", text: event.currentTarget.value })} />
                          : action.type === "delay"
                            ? <div className="keyboard-inline-form" style={{ alignItems: "center" }}>
                              <input type="number" min={0} max={VIA_MACRO_MAX_DELAY_MS} step={10} aria-label={t(locale, "kb.viaMacroMs")} value={action.ms} disabled={busy}
                                onInput={(event) => patch(index, { type: "delay", ms: Number.parseInt(event.currentTarget.value, 10) || 0 })} />
                              <span className="setting-note">{"ms"}</span>
                            </div>
                            : <OptionMenu ariaLabel={t(locale, "kb.viaMacroKey")} value={action.keycode} disabled={busy}
                              options={keys.some((choice) => choice.value === action.keycode) ? keys
                                : [{ value: action.keycode, label: describeViaKeycode(action.keycode, protocol).title }, ...keys]}
                              onChange={(keycode) => patch(index, { type: action.type, keycode })} />}
                        {error ? <small className="setting-note" style={ERROR_COLOR}>{displayText(locale, error)}</small> : null}
                      </div>
                    </>}
                  <div className="keyboard-selected-chips">
                    <button type="button" className="om-btn is-sm" disabled={busy || index === 0} onClick={() => move(index, -1)}>{t(locale, "kb.viaMacroMoveUp")}</button>
                    <button type="button" className="om-btn is-sm" disabled={busy || index === actions.length - 1} onClick={() => move(index, 1)}>{t(locale, "kb.viaMacroMoveDown")}</button>
                    <button type="button" className="om-btn is-sm" disabled={busy} onClick={() => update(actions.filter((_, at) => at !== index))}>{t(locale, "kb.viaMacroRemove")}</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="keyboard-selection-actions">
            <button type="button" className="om-btn is-sm" disabled={busy || recording} onClick={() => update([...actions, { type: "text", text: "" }])}>{t(locale, "kb.viaMacroAdd")}</button>
            <button type="button" className={`om-btn is-sm${recording ? " is-primary" : ""}`} disabled={busy} aria-pressed={recording}
              onClick={() => {
                if (recording) update(viaTidyRecording(actions));
                else recorded.current = [...actions];
                setRecording(!recording);
              }}>{t(locale, recording ? "kb.viaMacroStop" : "kb.viaMacroRecord")}</button>
            {recording ? <small className="setting-note">{t(locale, "kb.viaMacroRecording")}</small> : null}
            {!delays ? <small className="setting-note">{t(locale, "kb.viaMacroNoDelays")}</small> : null}
          </div>
        </>}
        <div className="keyboard-selection-actions">
          <span className="keyboard-selection-count" style={fits ? undefined : ERROR_COLOR}>{tp(locale, "kb.viaMacroUsage", { used, size: macros.bufferSize })}</span>
          {fits ? null : <small className="setting-note">{t(locale, "kb.viaMacroTooLong")}</small>}
          <button type="button" className="om-btn is-sm" disabled={busy || !dirty} onClick={() => { setRecording(false); setDrafts({}); resetCode(); }}>{t(locale, "kb.viaMacroDiscard")}</button>
          <button type="button" className="om-btn is-primary is-sm" disabled={busy || recording || !dirty || invalid || !fits || codeError !== null} onClick={save}>{t(locale, "kb.viaMacroSave")}</button>
        </div>
      </> : <p className="keyboard-empty">{t(locale, "kb.viaMacroUnavailable")}</p>}
    </article>
  );
}
