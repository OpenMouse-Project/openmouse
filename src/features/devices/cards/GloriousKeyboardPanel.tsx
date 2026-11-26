import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  GLORIOUS_FUNCTIONS,
  GLORIOUS_HE_ACTUATION_MM,
  GLORIOUS_HE_SENSITIVITY_MM,
  GLORIOUS_LAYERS,
  GLORIOUS_MEDIA,
  GLORIOUS_MODIFIERS,
  GLORIOUS_MOUSE,
  GLORIOUS_PROFILES,
  GLORIOUS_USAGES,
  gloriousBindingProblem,
  gloriousDebounceChoices,
  gloriousKeyLabel,
  gloriousLayerSwitches,
  gloriousLayoutKeys,
  gloriousLockedKeys,
  gloriousMacroProblem,
  gloriousPollingChoices,
  gloriousRemappableKeys,
  gloriousSleepChoices,
  type GloriousBinding,
  type GloriousMacro,
  type GloriousMacroEvent,
  type GloriousMacroMode,
  type GloriousModifier,
} from "@openmouse/keyboard-protocol/glorious";
import * as control from "../../../device/controller";
import type { GloriousWorkspace } from "../../../device/glorious-workspace";
import type { ControlSnapshot } from "../../../device/types";
import type { InterfaceLocale } from "../../settings/interface-preferences";
import { displayText, t, tp } from "../../../i18n/index";
import { OptionMenu, RateSlider, Segmented, StepperSlider, SwitchRow } from "../../../shared/ui";

type Kind = "default" | GloriousBinding["kind"];
const USAGE_NAMES = new Map(Object.entries(GLORIOUS_USAGES).map(([name, usage]) => [usage, name] as const));
const usageLabel = (usage: number): string => {
  const name = USAGE_NAMES.get(usage);
  return name ? gloriousKeyLabel(name) || name : `#${usage}`;
};
const MOD_LABELS: Record<GloriousModifier, string> = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", super: "Win" };

function bindingText(b: GloriousBinding | undefined, workspace: GloriousWorkspace): string {
  if (!b) return "";
  switch (b.kind) {
    case "disabled": return "Off";
    case "key": return [...(b.mods ?? []).map((mod) => MOD_LABELS[mod]), usageLabel(b.code)].join("+");
    case "media": return GLORIOUS_MEDIA[b.code as keyof typeof GLORIOUS_MEDIA] ?? "Media";
    case "mouse": return GLORIOUS_MOUSE[b.code as keyof typeof GLORIOUS_MOUSE] ?? "Mouse";
    case "function": return GLORIOUS_FUNCTIONS[b.code as keyof typeof GLORIOUS_FUNCTIONS] ?? "Function";
    case "macro": return workspace.state.macros[b.slot]?.name ?? `Macro ${b.slot}`;
  }
}

function Heading({ title, note }: { title: string; note?: string }): ReactNode {
  return <div className="setting-heading"><div><h2>{title}</h2>{note ? <small className="setting-note">{note}</small> : null}</div></div>;
}

function IdentityCard({ locale, name, workspace, busy }: { locale: InterfaceLocale; name: string; workspace: GloriousWorkspace; busy: boolean }): ReactNode {
  return (
    <article id="keyboard-card" className="setting-card keyboard-identity-card keyboard-workspace-card">
      <Heading title={name} note={t(locale, "kb.glNote")} />
      <dl className="keyboard-identity">
        <div><dt>{t(locale, "kb.glLayout")}</dt><dd>{workspace.model.layout.toUpperCase()}</dd></div>
        <div><dt>{t(locale, "kb.glUsbId")}</dt><dd>{`${workspace.model.vendorId.toString(16).padStart(4, "0")}:${workspace.model.productId.toString(16).padStart(4, "0")}`.toUpperCase()}</dd></div>
      </dl>
      <SwitchRow id="glorious-unlock" label={t(locale, "kb.glUnlock")} value={workspace.unlocked} disabled={busy}
        onChange={(unlocked) => void control.applyKeyboardCommand({ kind: "gloriousUnlock", unlocked })} />
      <small className="setting-note">{t(locale, workspace.unlocked ? "kb.glUnlockedNote" : "kb.glLockedNote")}</small>
    </article>
  );
}

function ProfileCard({ locale, workspace, disabled }: { locale: InterfaceLocale; workspace: GloriousWorkspace; disabled: boolean }): ReactNode {
  const { model, state } = workspace;
  const slots = (n: number, key: "kb.glProfileN" | "kb.glLayerN") => Array.from({ length: n }, (_, value) => ({ value, label: tp(locale, key, { n: value + 1 }) }));
  return (
    <article className="setting-card keyboard-workspace-card">
      <Heading title={t(locale, "kb.glProfileTitle")} note={t(locale, "kb.glProfileNote")} />
      <Segmented id="glorious-profile" ariaLabel={t(locale, "kb.glProfileTitle")} value={state.profile} disabled={disabled}
        options={slots(GLORIOUS_PROFILES, "kb.glProfileN")} onChange={(profile) => void control.applyKeyboardCommand({ kind: "gloriousProfile", profile })} />
      <Segmented id="glorious-layer" ariaLabel={t(locale, "kb.glLayerTitle")} value={state.layer} disabled={disabled}
        options={slots(GLORIOUS_LAYERS, "kb.glLayerN")} onChange={(layer) => void control.applyKeyboardCommand({ kind: "gloriousLayer", layer })} />
      {!gloriousLayerSwitches(model) ? <small className="setting-note">{t(locale, "kb.glLayerEditOnly")}</small> : null}
    </article>
  );
}

function SettingsCard({ locale, workspace, disabled }: { locale: InterfaceLocale; workspace: GloriousWorkspace; disabled: boolean }): ReactNode {
  const { model, state } = workspace;
  const debounce = gloriousDebounceChoices(model);
  const sleep = gloriousSleepChoices(model);
  return (
    <article id="keyboard-polling-card" className="setting-card keyboard-workspace-card">
      <Heading title={t(locale, "kb.pollingRate")} note={t(locale, "kb.glSentNote")} />
      <RateSlider id="glorious-polling" locale={locale} options={gloriousPollingChoices(model)} valueHz={state.polling}
        label={t(locale, "kb.pollingRate")} disabled={disabled} onChange={(hz) => void control.applyKeyboardCommand({ kind: "gloriousPolling", hz })} />
      {debounce.length ? (
        <div className="keyboard-fields">
          <h3>{t(locale, "kb.glDebounce")}</h3>
          <Segmented id="glorious-debounce" ariaLabel={t(locale, "kb.glDebounce")} value={state.debounce[state.profile] ?? null} disabled={disabled}
            options={debounce.map((ms) => ({ value: ms, label: `${ms} ms` }))} onChange={(ms) => void control.applyKeyboardCommand({ kind: "gloriousDebounce", ms })} />
          <small className="setting-note">{t(locale, model.protocol === "eternal" ? "kb.glDebounceBoard" : "kb.glDebounceNote")}</small>
        </div>
      ) : null}
      {sleep.length ? (
        <div className="keyboard-fields">
          <h3>{t(locale, "kb.glSleep")}</h3>
          <OptionMenu id="glorious-sleep" ariaLabel={t(locale, "kb.glSleep")} value={state.sleep} disabled={disabled}
            options={sleep.map((minutes) => ({ value: minutes, label: minutes === 255 ? t(locale, "kb.glNever") : tp(locale, "kb.glMinutes", { n: minutes }) }))}
            onChange={(minutes) => void control.applyKeyboardCommand({ kind: "gloriousSleep", minutes })} />
          {model.protocol === "gmmk" ? <small className="setting-note">{t(locale, "kb.glLightingReset")}</small> : null}
        </div>
      ) : null}
    </article>
  );
}

const mm = (value: number): string => `${value.toFixed(1)} mm`;

function AnalogCard({ locale, workspace, disabled }: { locale: InterfaceLocale; workspace: GloriousWorkspace; disabled: boolean }): ReactNode {
  const { analog } = workspace.state;
  const apply = (patch: Partial<typeof analog>) => void control.applyKeyboardCommand({ kind: "gloriousAnalog", analog: { ...analog, ...patch } });
  const range = ([min, max]: readonly [number, number]) => ({ min, max, step: 0.1, scale: [min.toFixed(1), "", max.toFixed(1)] as const });
  return (
    <article id="keyboard-trigger-card" className="setting-card keyboard-workspace-card">
      <Heading title={t(locale, "kb.glAnalogTitle")} note={t(locale, "kb.glAnalogNote")} />
      <StepperSlider id="glorious-actuation" label={t(locale, "kb.glActuation")} value={analog.actuation} {...range(GLORIOUS_HE_ACTUATION_MM)}
        formatValue={mm} disabled={disabled} onCommit={(actuation) => apply({ actuation: Math.round(actuation * 10) / 10 })} />
      <SwitchRow id="glorious-rapid" label={t(locale, "kb.glRapid")} value={analog.rapid} disabled={disabled} onChange={(rapid) => apply({ rapid })} />
      {analog.rapid ? (
        <StepperSlider id="glorious-sensitivity" label={t(locale, "kb.glSensitivity")} value={analog.sensitivity} {...range(GLORIOUS_HE_SENSITIVITY_MM)}
          formatValue={mm} disabled={disabled} onCommit={(sensitivity) => apply({ sensitivity: Math.round(sensitivity * 10) / 10 })} />
      ) : null}
    </article>
  );
}

function KeysCard({ locale, workspace, disabled }: { locale: InterfaceLocale; workspace: GloriousWorkspace; disabled: boolean }): ReactNode {
  const { model, state } = workspace;
  const caps = useMemo(() => gloriousLayoutKeys(model.form, model.layout), [model]);
  const remappable = useMemo(() => new Set(gloriousRemappableKeys(model)), [model]);
  const locked = gloriousLockedKeys(model);
  const keys = state.keys[state.profile]?.[state.layer] ?? {};
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<GloriousBinding | null>(null);
  const width = Math.max(...caps.map((k) => k.x + k.w));
  const rows = Math.max(...caps.map((k) => k.y + k.h));
  const choose = (id: string) => {
    const key = id === "EnterLower" ? "Enter" : id;
    setSelected(key);
    setDraft(keys[key] ?? null);
  };
  const kind: Kind = draft?.kind ?? "default";
  const macroSlots = Object.keys(state.macros).map(Number);
  const problem = draft ? gloriousBindingProblem(model, draft, macroSlots) : "";
  const kinds: Kind[] = ["default", "disabled", "key", "media", "mouse", "function", ...(model.macros ? ["macro" as const] : [])];
  const functions = Object.entries(GLORIOUS_FUNCTIONS).filter(([code]) => model.protocol !== "eternal" || code === "1" || code === "2");
  const setKind = (next: Kind) => {
    if (next === "default") setDraft(null);
    else if (next === "disabled") setDraft({ kind: "disabled" });
    else if (next === "key") setDraft({ kind: "key", code: GLORIOUS_USAGES.KeyA! });
    else if (next === "macro") setDraft({ kind: "macro", slot: macroSlots[0] ?? 0 });
    else if (next === "function") setDraft({ kind: "function", code: Number(functions[0]![0]) });
    else setDraft({ kind: next, code: 1 });
  };
  const apply = () => {
    if (!selected) return;
    const next = { ...keys };
    if (draft) next[selected] = draft;
    else delete next[selected];
    void control.applyKeyboardCommand({ kind: "gloriousKeys", keys: next });
  };
  const unchanged = JSON.stringify(draft) === JSON.stringify(selected ? keys[selected] ?? null : null);
  const toggleMod = (mod: GloriousModifier, on: boolean) => {
    if (draft?.kind !== "key") return;
    const mods = GLORIOUS_MODIFIERS.filter((m) => (m === mod ? on : draft.mods?.includes(m)));
    setDraft({ kind: "key", code: draft.code, ...(mods.length ? { mods } : {}) });
  };
  return (
    <article id="keyboard-bindings-card" className="setting-card keyboard-workspace-card glorious-wide">
      <Heading title={t(locale, "kb.glKeysTitle")} note={tp(locale, "kb.glKeysNote", { profile: state.profile + 1, layer: state.layer + 1 })} />
      <div className="keyboard-key-deck glorious-deck-scroll">
        <div className="glorious-deck" role="group" aria-label={t(locale, "kb.glKeysTitle")} style={{ aspectRatio: `${width} / ${rows}` }}>
          {caps.map((cap) => {
            const key = cap.id === "EnterLower" ? "Enter" : cap.id;
            const mapped = bindingText(keys[key], workspace);
            const fixed = locked.has(key) || !remappable.has(key);
            return (
              <button type="button" key={cap.id}
                className={`keyboard-key glorious-key${selected === key ? " is-selected" : ""}${mapped ? " is-mapped" : ""}`}
                style={{ left: `${(cap.x / width) * 100}%`, top: `${(cap.y / rows) * 100}%`, width: `${(cap.w / width) * 100}%`, height: `${(cap.h / rows) * 100}%` }}
                disabled={disabled || fixed} aria-pressed={selected === key}
                aria-label={displayText(locale, mapped ? `${key} · ${mapped}` : key)}
                onClick={() => choose(cap.id)}>
                <span>{cap.id === "EnterLower" ? "" : gloriousKeyLabel(cap.id)}</span>
                {mapped && cap.id !== "EnterLower" ? <small>{mapped}</small> : null}
              </button>
            );
          })}
        </div>
      </div>
      {selected ? (
        <div className="keyboard-fields">
          <p className="setting-note">{tp(locale, "kb.glEditing", { key: gloriousKeyLabel(selected) || selected })}</p>
          <OptionMenu id="glorious-kind" ariaLabel={t(locale, "kb.glAction")} value={kind} disabled={disabled}
            options={kinds.map((value) => ({ value, label: t(locale, KIND_LABEL[value]) }))} onChange={setKind} />
          {draft?.kind === "key" ? (
            <>
              <OptionMenu id="glorious-usage" ariaLabel={t(locale, "kb.glKey")} value={draft.code} disabled={disabled}
                options={Object.entries(GLORIOUS_USAGES).map(([name, value]) => ({ value, label: `${gloriousKeyLabel(name) || name} (${name})` }))}
                onChange={(code) => setDraft({ ...draft, code })} />
              <div className="glorious-mods">
                {GLORIOUS_MODIFIERS.map((mod) => (
                  <SwitchRow key={mod} id={`glorious-mod-${mod}`} label={MOD_LABELS[mod]} value={draft.mods?.includes(mod) ?? false} disabled={disabled}
                    onChange={(on) => toggleMod(mod, on)} />
                ))}
              </div>
            </>
          ) : null}
          {draft?.kind === "media" || draft?.kind === "mouse" || draft?.kind === "function" ? (
            <OptionMenu id="glorious-code" ariaLabel={t(locale, "kb.glAction")} value={draft.code} disabled={disabled}
              options={(draft.kind === "media" ? Object.entries(GLORIOUS_MEDIA) : draft.kind === "mouse" ? Object.entries(GLORIOUS_MOUSE) : functions)
                .map(([code, label]) => ({ value: Number(code), label: displayText(locale, label) }))}
              onChange={(code) => setDraft({ kind: draft.kind, code })} />
          ) : null}
          {draft?.kind === "macro" ? (
            macroSlots.length ? (
              <OptionMenu id="glorious-macro" ariaLabel={t(locale, "kb.glMacro")} value={draft.slot} disabled={disabled}
                options={macroSlots.map((slot) => ({ value: slot, label: state.macros[slot]!.name }))} onChange={(slot) => setDraft({ kind: "macro", slot })} />
            ) : <p className="setting-note">{t(locale, "kb.glNoMacros")}</p>
          ) : null}
          {problem ? <p className="setting-note" role="alert">{displayText(locale, problem)}</p> : null}
          <div className="keyboard-selection-actions">
            <button type="button" className="om-btn is-primary is-sm" disabled={disabled || unchanged || problem !== ""} onClick={apply}>{t(locale, "kb.glApply")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled || Object.keys(keys).length === 0}
              onClick={() => void control.applyKeyboardCommand({ kind: "gloriousKeys", keys: {} })}>{t(locale, "kb.glResetLayer")}</button>
          </div>
        </div>
      ) : <p className="keyboard-empty">{t(locale, "kb.glSelectKey")}</p>}
    </article>
  );
}

const KIND_LABEL: Record<Kind, "kb.glKindDefault" | "kb.glKindDisabled" | "kb.glKindKey" | "kb.glKindMedia" | "kb.glKindMouse" | "kb.glKindFunction" | "kb.glKindMacro"> = {
  default: "kb.glKindDefault", disabled: "kb.glKindDisabled", key: "kb.glKindKey", media: "kb.glKindMedia",
  mouse: "kb.glKindMouse", function: "kb.glKindFunction", macro: "kb.glKindMacro",
};

const MODES: readonly GloriousMacroMode[] = ["once", "repeat", "toggle"];
const MODE_LABEL: Record<GloriousMacroMode, "kb.glModeOnce" | "kb.glModeRepeat" | "kb.glModeToggle"> = {
  once: "kb.glModeOnce", repeat: "kb.glModeRepeat", toggle: "kb.glModeToggle",
};

function MacroEditor({ locale, slot, initial, disabled, onDone }: {
  locale: InterfaceLocale; slot: number | null; initial: GloriousMacro; disabled: boolean; onDone: () => void;
}): ReactNode {
  const [name, setName] = useState(initial.name);
  const [mode, setMode] = useState<GloriousMacroMode>(initial.mode);
  const [events, setEvents] = useState<GloriousMacroEvent[]>([...initial.events]);
  const [recording, setRecording] = useState(false);
  const last = useRef(0);
  const record = (type: "press" | "release", code: string, repeat: boolean) => {
    const usage = GLORIOUS_USAGES[code];
    if (usage === undefined || repeat) return;
    const now = performance.now();
    setEvents((current) => {
      const next = [...current];
      if (next.length) next[next.length - 1] = { ...next[next.length - 1]!, delay: Math.min(0x7fff, Math.max(1, Math.round(now - last.current))) };
      last.current = now;
      return [...next, { type, code: usage, delay: 10 }];
    });
  };
  const problem = gloriousMacroProblem(events);
  return (
    <div className="keyboard-fields glorious-macro-editor">
      <input type="text" className="om-input" autoComplete="off" spellcheck={false} maxLength={40} aria-label={t(locale, "kb.glMacroName")}
        placeholder={t(locale, "kb.glMacroName")} value={name} disabled={disabled} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <Segmented id="glorious-macro-mode" ariaLabel={t(locale, "kb.glMacroMode")} value={mode} disabled={disabled}
        options={MODES.map((value) => ({ value, label: t(locale, MODE_LABEL[value]) }))} onChange={setMode} />
      <div className={`glorious-recorder${recording ? " is-recording" : ""}`} tabIndex={0} role="textbox" aria-label={t(locale, "kb.glRecordHint")}
        onKeyDown={(e) => { if (!recording) return; e.preventDefault(); record("press", e.code, e.repeat); }}
        onKeyUp={(e) => { if (!recording) return; e.preventDefault(); record("release", e.code, false); }}>
        {events.length === 0 ? <span className="setting-note">{t(locale, recording ? "kb.glRecordHint" : "kb.glMacroEmpty")}</span> : events.map((e, i) => (
          <span key={i} className="glorious-step">{`${e.type === "press" ? "↓" : "↑"}${usageLabel(e.code)} ${e.delay} ms`}</span>
        ))}
      </div>
      {problem && events.length ? <p className="setting-note" role="alert">{displayText(locale, problem)}</p> : null}
      <div className="keyboard-selection-actions">
        <button type="button" className="om-btn is-sm" disabled={disabled} onClick={() => { last.current = performance.now(); setRecording(!recording); }}>
          {t(locale, recording ? "kb.glStopRecording" : "kb.glRecord")}
        </button>
        <button type="button" className="om-btn is-sm" disabled={disabled || events.length === 0} onClick={() => setEvents([])}>{t(locale, "kb.glClear")}</button>
        <button type="button" className="om-btn is-sm" onClick={onDone}>{t(locale, "kb.glCancel")}</button>
        <button type="button" className="om-btn is-primary is-sm" disabled={disabled || recording || problem !== ""}
          onClick={() => { void control.applyKeyboardCommand({ kind: "gloriousMacroSave", slot, macro: { name, mode, events } }).then(onDone); }}>
          {t(locale, "kb.glSave")}
        </button>
      </div>
    </div>
  );
}

function MacrosCard({ locale, workspace, disabled }: { locale: InterfaceLocale; workspace: GloriousWorkspace; disabled: boolean }): ReactNode {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const { model, state } = workspace;
  if (!model.macros) {
    return <article className="setting-card keyboard-workspace-card"><Heading title={t(locale, "kb.glMacrosTitle")} /><p className="keyboard-empty">{t(locale, "kb.glNoMacroSupport")}</p></article>;
  }
  const slots = Object.keys(state.macros).map(Number).sort((a, b) => a - b);
  return (
    <article className="setting-card keyboard-workspace-card">
      <Heading title={t(locale, "kb.glMacrosTitle")} note={t(locale, "kb.glMacrosNote")} />
      {slots.length === 0 && editing === null ? <p className="keyboard-empty">{t(locale, "kb.glNoMacros")}</p> : null}
      <ul className="glorious-macro-list">
        {slots.map((slot) => {
          const macro = state.macros[slot]!;
          return (
            <li key={slot}>
              <span>{macro.name}</span>
              <small>{`${t(locale, MODE_LABEL[macro.mode])} · ${tp(locale, "kb.glSteps", { n: macro.events.length })}`}</small>
              <button type="button" className="om-btn is-sm" disabled={disabled || editing !== null} onClick={() => setEditing(slot)}>{t(locale, "kb.glEdit")}</button>
              <button type="button" className="om-btn is-sm" disabled={disabled || editing !== null}
                onClick={() => void control.applyKeyboardCommand({ kind: "gloriousMacroDelete", slot })}>{t(locale, "kb.glDelete")}</button>
            </li>
          );
        })}
      </ul>
      {editing !== null ? (
        <MacroEditor key={String(editing)} locale={locale} disabled={disabled} slot={editing === "new" ? null : editing}
          initial={editing === "new" ? { name: "", mode: "once", events: [] } : state.macros[editing]!} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="om-btn" disabled={disabled || slots.length >= 10} onClick={() => setEditing("new")}>{t(locale, "kb.glNewMacro")}</button>
      )}
    </article>
  );
}

/**
 * Glorious keyboards on stock firmware. The boards report nothing back, so
 * every value shown is what OpenMouse last sent, and changes stay off until
 * the owner turns them on.
 */
export function GloriousKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const workspace = keyboard.workspace.glorious ?? null;
  const busy = keyboard.trigger.busy;
  const tab = snapshot.workspaceTab;
  const disabled = busy || !workspace?.unlocked;
  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
      {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}
      <p className="setting-note arbiter-note">{t(locale, "kb.glUnverified")}</p>
      {workspace === null ? (
        <article className="setting-card keyboard-workspace-card"><p className="keyboard-empty">{t(locale, "kb.arbReading")}</p></article>
      ) : (
        <>
          {tab === "overview" ? <><IdentityCard locale={locale} name={keyboard.name} workspace={workspace} busy={busy} /><ProfileCard locale={locale} workspace={workspace} disabled={disabled} /></> : null}
          {tab === "performance" ? <><SettingsCard locale={locale} workspace={workspace} disabled={disabled} />{workspace.model.protocol === "he" ? <AnalogCard locale={locale} workspace={workspace} disabled={disabled} /> : null}</> : null}
          {tab === "buttons" ? <KeysCard locale={locale} workspace={workspace} disabled={disabled} /> : null}
          {tab === "macro" ? <MacrosCard locale={locale} workspace={workspace} disabled={disabled} /> : null}
        </>
      )}
    </section>
  );
}
