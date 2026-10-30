import { useEffect, useState, type ReactNode } from "react";
import { KEYCHRON_ADVANCE_MODE } from "@openmouse/keyboard-protocol/keychron";
import type { KeychronCurve } from "@openmouse/keyboard-protocol/keychron";
import type { ControlSnapshot } from "../../../device/types";
import type { KeychronWorkspace } from "../../../device/keychron-keyboard";
import { legendFor } from "../../../device/keychron-legend";
import { stepsToMm, travelBounds } from "../../../device/keychron-travel";
import { CURVE_MAX_Y, CURVE_X_STEP_MM, analogKeyCount, clampCurve, curveInRange, curveScale, linearCurve, setCurvePoint } from "../../../device/keychron-curve";
import * as control from "../../../device/controller";
import { displayText, t, tp, type I18nKey } from "../../../i18n/index";
import type { InterfaceLocale } from "../../settings/interface-preferences";
import { Segmented, StepperSlider, SwitchRow } from "../../../shared/ui";
import { KeychronCurveGraph } from "./KeychronCurveGraph";
import { KeychronKeyMap, keyId } from "./KeychronKeyMap";
import { KeychronRemapCard } from "./KeychronRemapCard";

const send = control.applyKeyboardCommand;
const millimetres = (value: number): string => `${value.toFixed(3)} mm`;
const fixed = (value: number): string => String(Number(value.toFixed(4)));

type Locale = InterfaceLocale;
type Vars = Record<string, string | number>;
const l = (locale: Locale, key: string, vars?: Vars): string =>
  vars ? tp(locale, `kb.keychron${key}` as I18nKey, vars) : t(locale, `kb.keychron${key}` as I18nKey);

interface KeyRef { row: number; col: number }

const ADVANCE_LABELS: ReadonlyArray<readonly [number, string]> = [
  [KEYCHRON_ADVANCE_MODE.none, "AdvanceNone"],
  [KEYCHRON_ADVANCE_MODE.dks, "AdvanceDks"],
  [KEYCHRON_ADVANCE_MODE.analog, "AdvanceAnalog"],
  [KEYCHRON_ADVANCE_MODE.toggle, "AdvanceToggle"],
  [KEYCHRON_ADVANCE_MODE.dkr, "AdvanceDkr"],
  [KEYCHRON_ADVANCE_MODE.turbo, "AdvanceTurbo"],
];

/** Named only for the modes the protocol documents; anything else stays a number. */
function advanceLabel(locale: Locale, mode: number): string {
  const known = ADVANCE_LABELS.find(([value]) => value === mode);
  return known ? l(locale, known[1]) : l(locale, "AdvanceRaw", { n: mode });
}

function Card({ title, hidden, children }: { title: string; hidden: boolean; children: ReactNode }): ReactNode {
  return <article className="setting-card keyboard-workspace-card" hidden={hidden}>
    <div className="setting-heading"><div><h2>{title}</h2></div></div>
    {children}
  </article>;
}

/** Two-step button, the same inline pattern the SteelSeries panel uses for overwrites. */
function Confirmed({ label, question, yes, locale, disabled, onConfirm }: {
  label: string; question: string; yes: string; locale: Locale; disabled: boolean; onConfirm: () => void;
}): ReactNode {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className="om-btn" disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return <div role="group" aria-label={label} className="keychron-confirm">
    <p className="setting-note">{question}</p>
    <div className="keychron-actions">
      <button type="button" className="om-btn is-danger" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{yes}</button>
      <button type="button" className="om-btn" onClick={() => setAsking(false)}>{l(locale, "Cancel")}</button>
    </div>
  </div>;
}

function IdentityCard({ kc, locale, busy, hidden, name }: { kc: KeychronWorkspace | null; locale: Locale; busy: boolean; hidden: boolean; name: string }): ReactNode {
  const state = kc?.status.keychron;
  return <Card title={name} hidden={hidden}>
    {kc && state ? <dl className="keyboard-identity">
      {([
        ["IdCommand", `v${state.heVersion}`],
        ["IdMatrix", l(locale, "IdMatrixValue", { rows: state.rows, cols: state.cols })],
        ["IdStep", `${fixed(state.unit)} mm`],
        ["IdProfiles", String(kc.status.profileCount ?? "–")],
      ] as const).map(([label, value]) => <div key={label}><dt>{l(locale, label)}</dt><dd>{value}</dd></div>)}
    </dl> : <p className="setting-note">{l(locale, busy ? "Loading" : "NoData")}</p>}
    <p className="setting-note">{l(locale, "CaveatConnection")}</p>
    <p className="setting-note">{l(locale, "CaveatRaw")}</p>
    <button type="button" className="om-btn" disabled={busy} onClick={() => send({ kind: "refresh" })}>{t(locale, "kb.refresh")}</button>
  </Card>;
}

function KeysCard({ kc, locale, busy, hidden, selection, primary, onSelect, onSelectAll, onClear }: {
  kc: KeychronWorkspace; locale: Locale; busy: boolean; hidden: boolean; selection: ReadonlySet<string>; primary: KeyRef | null;
  onSelect: (row: number, col: number, additive: boolean) => void; onSelectAll: () => void; onClear: () => void;
}): ReactNode {
  const state = kc.status.keychron;
  const slot = primary ? kc.profile?.keys[primary.row]?.[primary.col] : undefined;
  const legend = primary && kc.keymap ? legendFor(kc.keymap[primary.row]?.[primary.col], kc.remap.context) : null;
  const unit = state?.unit ?? 0.1;
  return <Card title={l(locale, "Keys")} hidden={hidden}>
    <div className="keychron-keys-legend" aria-label={l(locale, "LegendLabel")}>
      <span><i className="keychron-swatch" aria-hidden="true" />{l(locale, "LegendStatic")}</span>
      <span><i className="keychron-swatch is-rapid" aria-hidden="true" />{l(locale, "LegendRapid")}</span>
      <span><i className="keychron-swatch is-advanced" aria-hidden="true" />{l(locale, "LegendAdvanced")}</span>
      <span>{l(locale, "LegendUnit")}</span>
    </div>
    <KeychronKeyMap kc={kc} locale={locale} keymap={kc.keymap} context={kc.remap.context} selected={selection} disabled={busy} onSelect={onSelect} />
    <p className="setting-note">{l(locale, kc.keymap ? "KeysLegends" : "KeysNoKeymap")}{kc.layout.physical ? "" : ` ${l(locale, "KeysGrid")}`}</p>
    <div className="keychron-keys-actions">
      <span>{selection.size === 0 ? l(locale, "KeysHint") : l(locale, "SelectedCount", { n: selection.size })}</span>
      <span>
        <button type="button" className="om-btn is-sm" disabled={busy} onClick={onSelectAll}>{l(locale, "SelectAll")}</button>
        <button type="button" className="om-btn is-sm" disabled={busy || selection.size === 0} onClick={onClear}>{l(locale, "ClearSelection")}</button>
      </span>
    </div>
    {primary && slot && selection.size === 1 ? <dl className="keyboard-identity">
      <div><dt>{legend?.title || l(locale, "KeyLabel", { row: primary.row, col: primary.col })}</dt><dd>{l(locale, "KeyLabel", { row: primary.row, col: primary.col })}</dd></div>
      <div><dt>{l(locale, "Actuation")}</dt><dd>{millimetres(stepsToMm(slot.distance, unit))}</dd></div>
      <div><dt>{l(locale, "RtPress")}</dt><dd>{millimetres(stepsToMm(slot.advancePress, unit))}</dd></div>
      <div><dt>{l(locale, "RtRelease")}</dt><dd>{millimetres(stepsToMm(slot.advanceRelease, unit))}</dd></div>
      <div><dt>{l(locale, "AdvanceMode")}</dt><dd>{advanceLabel(locale, slot.advanceMode)}</dd></div>
    </dl> : null}
  </Card>;
}

function TravelCard({ kc, locale, busy, hidden, selection, primary }: {
  kc: KeychronWorkspace; locale: Locale; busy: boolean; hidden: boolean; selection: ReadonlySet<string>; primary: KeyRef | null;
}): ReactNode {
  const single = selection.size === 1 && primary ? kc.profile?.keys[primary.row]?.[primary.col] : undefined;
  const source = single ?? kc.profile?.global ?? null;
  return <TravelForm key={`${single && primary ? keyId(primary.row, primary.col) : "all"}:${JSON.stringify(source)}`}
    state={kc.status.keychron ?? null} unsaved={kc.unsaved} source={source} locale={locale} busy={busy} hidden={hidden} selection={selection} />;
}

function TravelForm({ state, unsaved, source, locale, busy, hidden, selection }: {
  state: KeychronWorkspace["status"]["keychron"] | null; unsaved: KeychronWorkspace["unsaved"];
  source: { distance: number; advancePress: number; advanceRelease: number } | null;
  locale: Locale; busy: boolean; hidden: boolean; selection: ReadonlySet<string>;
}): ReactNode {
  const [draft, setDraft] = useState(() => state && source
    ? { press: stepsToMm(source.distance, state.unit), rtPress: stepsToMm(source.advancePress, state.unit), rtRelease: stepsToMm(source.advanceRelease, state.unit) }
    : null);
  const [rapidTrigger, setRapidTrigger] = useState(() => source !== null && (source.advancePress > 0 || source.advanceRelease > 0));
  const [target, setTarget] = useState<"all" | "selected">("all");
  if (!state || !draft) return <Card title={l(locale, "Travel")} hidden={hidden}><p className="setting-note">{l(locale, "NoData")}</p></Card>;
  const bounds = travelBounds(state);
  const clamp = (mm: number): number => Math.min(bounds.maxMm, Math.max(bounds.minMm, mm));
  const slider = (id: string, label: string, field: keyof typeof draft) => <StepperSlider
    id={id} label={label} value={clamp(draft[field])} min={bounds.minMm} max={bounds.maxMm} step={bounds.stepMm}
    scale={[fixed(bounds.minMm), "", fixed(bounds.maxMm)]} formatValue={millimetres} disabled={busy}
    onCommit={value => setDraft({ ...draft, [field]: value })} />;
  const scope = target === "selected" && selection.size > 0 ? "selected" : "all";
  const keys = scope === "selected" ? [...selection].map(id => { const [row, col] = id.split(":").map(Number); return { row: row!, col: col! }; }) : undefined;
  return <Card title={l(locale, "Travel")} hidden={hidden}>
    <p className="setting-note">{bounds.fromBoard
      ? l(locale, "Range", { min: fixed(bounds.minMm), max: fixed(bounds.maxMm), step: fixed(bounds.stepMm) })
      : l(locale, "RangeUnknown", { max: fixed(bounds.maxMm), step: fixed(bounds.stepMm) })}</p>
    {bounds.deadzoneMm !== null ? <p className="setting-note">{l(locale, "Deadzone", { value: fixed(bounds.deadzoneMm) })}</p> : null}
    <Segmented id="keychron-target" ariaLabel={l(locale, "TargetLabel")} disabled={busy}
      options={[{ value: "all", label: l(locale, "TargetAll") }, { value: "selected", label: l(locale, "TargetSelected", { n: selection.size }), disabled: selection.size === 0 }]}
      value={scope} onChange={setTarget} />
    {slider("keychron-actuation", l(locale, "Actuation"), "press")}
    <SwitchRow id="keychron-rapid-trigger" label={l(locale, "RapidTrigger")} value={rapidTrigger} disabled={busy} onChange={setRapidTrigger} />
    {rapidTrigger ? <>
      {slider("keychron-rt-press", l(locale, "RtPress"), "rtPress")}
      {slider("keychron-rt-release", l(locale, "RtRelease"), "rtRelease")}
    </> : null}
    {unsaved ? <p className="setting-note setting-note-warning" role="status">{l(locale, "Unsaved", {
      press: fixed(stepsToMm(unsaved.press, state.unit)), rtPress: fixed(stepsToMm(unsaved.sensitivePress, state.unit)), rtRelease: fixed(stepsToMm(unsaved.sensitiveRelease, state.unit)),
    })}</p> : null}
    <div className="keychron-actions">
      <button type="button" className="om-btn" disabled={busy}
        onClick={() => send({ kind: "keychronSetTravel", rapidTrigger, keys, pressMm: draft.press, sensitivePressMm: draft.rtPress, sensitiveReleaseMm: draft.rtRelease })}>
        {l(locale, "Write")}
      </button>
      <button type="button" className="om-btn is-primary" disabled={busy || !unsaved} onClick={() => send({ kind: "keychronSave" })}>{l(locale, "Save")}</button>
    </div>
  </Card>;
}

function LiveCard({ kc, locale, busy, hidden, primary }: { kc: KeychronWorkspace; locale: Locale; busy: boolean; hidden: boolean; primary: KeyRef | null }): ReactNode {
  const state = kc.status.keychron;
  const [follow, setFollow] = useState(false);
  useEffect(() => {
    if (!follow || !primary) return undefined;
    const timer = setInterval(() => { void send({ kind: "keychronKeyTravel", ...primary }); }, 500);
    return () => clearInterval(timer);
  }, [follow, primary]);
  if (!state) return null;
  const reading = kc.keyTravel && primary && kc.keyTravel.row === primary.row && kc.keyTravel.col === primary.col ? kc.keyTravel : null;
  return <Card title={l(locale, "Live")} hidden={hidden}>
    <p className="setting-note">{primary ? l(locale, "KeyLabel", { row: primary.row, col: primary.col }) : l(locale, "LiveNone")}</p>
    {reading ? <output className="keychron-figure">{l(locale, "LiveValue", { mm: fixed(stepsToMm(reading.steps, state.unit)), steps: reading.steps })}</output> : null}
    <button type="button" className="om-btn" disabled={busy || !primary} onClick={() => primary && send({ kind: "keychronKeyTravel", ...primary })}>{l(locale, "LiveRead")}</button>
    <SwitchRow id="keychron-follow" label={l(locale, "LiveFollow")} value={follow} disabled={!primary} onChange={setFollow} />
  </Card>;
}

function ProfileCard({ kc, locale, busy, hidden }: { kc: KeychronWorkspace; locale: Locale; busy: boolean; hidden: boolean }): ReactNode {
  const { status } = kc;
  const [name, setName] = useState("");
  const active = status.activeProfile ?? 0;
  const names = status.profileNames ?? [];
  const slots = Array.from({ length: status.profileCount ?? 0 }, (_, slot) => slot);
  const label = (slot: number): string => names[slot] || l(locale, "ProfileSlot", { n: slot + 1 });
  return <Card title={l(locale, "Profile")} hidden={hidden}>
    {kc.unsaved ? <p className="setting-note setting-note-warning">{l(locale, "UnsavedBlock")}</p> : null}
    <Segmented id="keychron-profile" ariaLabel={l(locale, "ProfileActive")} disabled={busy || kc.unsaved !== null}
      options={slots.map(slot => ({ value: slot, label: label(slot) }))} value={active}
      onChange={slot => send({ kind: "keychronSelectProfile", slot })} />
    <form className="keyboard-inline-form" onSubmit={event => { event.preventDefault(); void send({ kind: "keychronRename", slot: active, name }); setName(""); }}>
      <label className="keyboard-field"><span>{l(locale, "RenameLabel")}</span>
        <input type="text" maxLength={14} value={name} placeholder={label(active)} onChange={event => setName(event.currentTarget.value)} /></label>
      <button type="submit" className="om-btn" disabled={busy || kc.unsaved !== null || name.trim() === ""}>{l(locale, "Rename")}</button>
    </form>
    <Confirmed label={l(locale, "Clear")} question={l(locale, "ClearConfirm", { n: active + 1 })} yes={l(locale, "ClearYes")}
      locale={locale} disabled={busy} onConfirm={() => send({ kind: "keychronClear", confirmed: true })} />
  </Card>;
}

function CurveCard({ kc, locale, busy, hidden }: { kc: KeychronWorkspace; locale: Locale; busy: boolean; hidden: boolean }): ReactNode {
  const state = kc.status.keychron;
  const scale = state ? curveScale(state, kc.axis?.maxMm ?? null) : null;
  const analog = analogKeyCount(kc.profile);
  const [draft, setDraft] = useState<KeychronCurve | null>(() => (kc.curve && scale ? clampCurve(kc.curve, scale.maxX) : null));
  const [active, setActive] = useState<number | null>(null);
  if (!kc.curve || !draft || !scale) return <Card title={l(locale, "Curve")} hidden={hidden}><p className="setting-note">{l(locale, "CurveNone")}</p></Card>;
  const { maxX } = scale;
  const locked = busy || analog === 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(kc.curve);
  const edit = (index: number, x: number, y: number) => setDraft(setCurvePoint(draft, index, x, y, maxX));
  const shown = active ?? 0;
  const [sx, sy] = draft[shown]!;
  return <Card title={l(locale, "Curve")} hidden={hidden}>
    <p className="setting-note">{l(locale, "CurveIntro")}</p>
    <p className={`setting-note${analog === 0 ? " setting-note-warning" : ""}`}>{analog === 0 ? l(locale, "CurveAnalogNone") : l(locale, "CurveAnalogSome", { n: analog })}</p>
    <div className="keychron-curve-body">
      <div>
        <small className="setting-note">{l(locale, "CurveAxisY")}</small>
        <KeychronCurveGraph curve={draft} maxX={maxX} locale={locale} disabled={locked} active={active} onActive={setActive} onChange={setDraft} />
        <small className="setting-note keychron-curve-xaxis">{l(locale, "CurveAxisX")}</small>
      </div>
      <div className="keychron-curve-side">
        <output className="keychron-curve-readout">{l(locale, "CurveReadout", { n: shown + 1, mm: fixed(sx * CURVE_X_STEP_MM), out: sy, x: sx, y: sy })}</output>
        <table className="keychron-curve-table">
          <colgroup><col className="is-point" /><col /><col /><col /></colgroup>
          <thead><tr>
            <th scope="col">{l(locale, "CurveColPoint")}</th><th scope="col">{l(locale, "CurveColTravel")}</th>
            <th scope="col">{l(locale, "CurveColOutput")}</th><th scope="col">{l(locale, "CurveColRaw")}</th>
          </tr></thead>
          <tbody>{draft.map(([x, y], index) => <tr key={index} className={active === index ? "is-active" : ""}>
            <th scope="row">{index + 1}</th>
            <td><input type="number" aria-label={`${l(locale, "CurvePoint", { n: index + 1 })}: ${l(locale, "CurveColTravel")}`} disabled={locked}
              min={fixed((index === 0 ? 0 : draft[index - 1]![0]) * CURVE_X_STEP_MM)} max={fixed((index === draft.length - 1 ? maxX : draft[index + 1]![0]) * CURVE_X_STEP_MM)} step={CURVE_X_STEP_MM}
              value={fixed(x * CURVE_X_STEP_MM)} onFocus={() => setActive(index)} onChange={event => edit(index, Number(event.currentTarget.value) / CURVE_X_STEP_MM, y)} /></td>
            <td><input type="number" aria-label={`${l(locale, "CurvePoint", { n: index + 1 })}: ${l(locale, "CurveColOutput")}`} disabled={locked}
              min={0} max={CURVE_MAX_Y} step={1} value={y} onFocus={() => setActive(index)} onChange={event => edit(index, x, Number(event.currentTarget.value))} /></td>
            <td className="keychron-curve-raw">{x}, {y}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <p className="setting-note">{l(locale, "CurveUnverified")}{scale.unverifiedStep ? ` ${l(locale, "CurveV5")}` : ""}{scale.fromBoard ? "" : ` ${l(locale, "CurveNoRange")}`}</p>
    <div className="keychron-actions">
      <button type="button" className="om-btn" disabled={locked} onClick={() => setDraft(linearCurve(maxX))}>{l(locale, "CurveLinear")}</button>
      <button type="button" className="om-btn" disabled={locked || !dirty} onClick={() => setDraft(clampCurve(kc.curve!, maxX))}>{l(locale, "CurveReset")}</button>
      <button type="button" className="om-btn is-primary" disabled={locked || !dirty || !curveInRange(draft, maxX)} onClick={() => send({ kind: "keychronWriteCurve", curve: draft })}>{l(locale, "CurveWrite")}</button>
    </div>
  </Card>;
}

function CalibrationCard({ kc, locale, busy, hidden }: { kc: KeychronWorkspace; locale: Locale; busy: boolean; hidden: boolean }): ReactNode {
  const { calibration, calibrationPhase } = kc;
  const badge = calibrationPhase === "started" ? "is-accent" : "";
  return <Card title={l(locale, "Calibration")} hidden={hidden}>
    <p className="setting-note">{l(locale, "CalIntro")}</p>
    <p><span className={`om-badge ${badge}`} role="status">{l(locale, calibrationPhase === "started" ? "CalPhaseStarted" : calibrationPhase === "stopped" ? "CalPhaseStopped" : "CalPhaseIdle")}</span></p>
    {calibration ? <small className="setting-note">{l(locale, "CalRaw", { n: calibration.state, keys: calibration.keys.filter(Boolean).length })}</small> : null}
    <div className="keychron-actions">
      <Confirmed label={l(locale, "CalStart")} question={l(locale, "CalStartConfirm")} yes={l(locale, "CalStartYes")}
        locale={locale} disabled={busy} onConfirm={() => send({ kind: "keychronCalibration", action: "start", confirmed: true })} />
      <button type="button" className="om-btn" disabled={busy} onClick={() => send({ kind: "keychronCalibration", action: "read" })}>{l(locale, "CalRead")}</button>
      <button type="button" className="om-btn" disabled={busy} onClick={() => send({ kind: "keychronCalibration", action: "stop" })}>{l(locale, "CalStop")}</button>
    </div>
    <small className="setting-note">{l(locale, "CalPhaseNote")}</small>
  </Card>;
}

function AxisCard({ kc, locale, hidden }: { kc: KeychronWorkspace; locale: Locale; hidden: boolean }): ReactNode {
  return <Card title={l(locale, "Axis")} hidden={hidden}>
    {kc.axis
      ? <>
        <p className="setting-note">{l(locale, "AxisMax")}</p>
        <strong className="keychron-figure">{l(locale, "AxisMaxValue", { mm: fixed(kc.axis.maxMm) })}</strong>
        <small className="setting-note">{l(locale, "AxisRaw", { n: kc.axis.type })}</small>
      </>
      : <p className="setting-note">{l(locale, "AxisNone")}</p>}
  </Card>;
}

/**
 * Keychron Hall-effect panel inside the shared device workspace tabs, laid out
 * the way the Wooting panel is: one section, cards shown per tab.
 */
export function KeychronKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [primary, setPrimary] = useState<KeyRef | null>(null);
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const kc = keyboard.workspace.keychron ?? null;
  const busy = keyboard.trigger.busy;
  const tab = snapshot.workspaceTab;
  const select = (row: number, col: number, additive: boolean): void => {
    const id = keyId(row, col);
    if (!additive) { setSelection(new Set([id])); setPrimary({ row, col }); return; }
    const next = new Set(selection);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelection(next);
    setPrimary(next.has(id) ? { row, col } : primary && next.has(keyId(primary.row, primary.col)) ? primary : null);
  };
  const selectAll = (): void => {
    if (!kc) return;
    setSelection(new Set(kc.layout.keys.map(key => keyId(key.row, key.col))));
    setPrimary(null);
  };
  const clear = (): void => { setSelection(new Set()); setPrimary(null); };
  return <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
    {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}
    <p className="setting-note setting-note-warning keychron-notice">{l(locale, "CaveatUnverified")}</p>
    <IdentityCard kc={kc} locale={locale} busy={busy} hidden={tab !== "overview"} name={keyboard.name} />
    {kc ? <>
      <KeysCard kc={kc} locale={locale} busy={busy} hidden={tab !== "performance"} selection={selection} primary={primary}
        onSelect={select} onSelectAll={selectAll} onClear={clear} />
      <TravelCard kc={kc} locale={locale} busy={busy} hidden={tab !== "performance"} selection={selection} primary={primary} />
      <KeychronRemapCard kc={kc} locale={locale} busy={busy} hidden={tab !== "buttons"} name={keyboard.name} />
      <LiveCard kc={kc} locale={locale} busy={busy} hidden={tab !== "performance"} primary={primary} />
      <ProfileCard kc={kc} locale={locale} busy={busy} hidden={tab !== "profiles"} />
      <CurveCard key={JSON.stringify(kc.curve)} kc={kc} locale={locale} busy={busy} hidden={tab !== "advanced"} />
      <CalibrationCard kc={kc} locale={locale} busy={busy} hidden={tab !== "advanced"} />
      <AxisCard kc={kc} locale={locale} hidden={tab !== "advanced"} />
    </> : null}
  </section>;
}
