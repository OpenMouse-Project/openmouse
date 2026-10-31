import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { ReactNode } from "react";
import {
  MCHOSE_ACTUATION_RANGE,
  MCHOSE_DEADZONE_RANGE,
  MCHOSE_KEY_MODE,
  MCHOSE_RT_SMART_RANGE,
  MCHOSE_TRAVEL_PRESETS,
  MCHOSE_TRAVEL_STEP_MM,
  mchoseModel,
  mchoseTravelPresetUpdates,
  mchoseDisplayProfileName,
  mchoseMmToSteps,
  mchoseRapidTriggerStep,
  mchoseStepsToMm,
} from "@openmouse/keyboard-protocol/mchose";
import type { MchoseKeyTravel, MchoseKeyTravelUpdate, MchoseSettings } from "@openmouse/keyboard-protocol/mchose";
import * as control from "../../../device/controller";
import type { MchoseWorkspace } from "../../../device/mchose-workspace";
import { MCHOSE_CALIBRATION_PENDING } from "../../../device/mchose-colors";
import { mchoseProfileFile, mchoseProfileFileName, parseMchoseProfileFile, type MchoseProfileFile } from "../../../device/mchose-profile-file";
import type { ControlSnapshot } from "../../../device/types";
import type { InterfaceLocale } from "../../settings/interface-preferences";
import { displayText, t, tp } from "../../../i18n/index";
import { OptionMenu, RateSlider, Segmented, SliderField, StepperSlider, SwitchRow } from "../../../shared/ui";
import { AdvancedCard, KeyColorCard, KeyDeck, KeyTestCard, LightingCard, MacroCard, RemapCard } from "./MchoseEditors";

type Range = { min: number; max: number };

function slider(range: Range, stepMm: number): { min: number; max: number; step: number; scale: readonly [string, string, string] } {
  const min = mchoseStepsToMm(range.min, stepMm);
  const max = mchoseStepsToMm(range.max, stepMm);
  const places = stepMm < 0.01 ? 3 : 2;
  return { min, max, step: stepMm, scale: [min.toFixed(places), "", max.toFixed(places)] };
}
const ACTUATION = slider(MCHOSE_ACTUATION_RANGE, MCHOSE_TRAVEL_STEP_MM);
const DEADZONE = slider(MCHOSE_DEADZONE_RANGE, MCHOSE_TRAVEL_STEP_MM);
const mm = (places: number) => (value: number): string => `${value.toFixed(places)} mm`;
const clamp = (value: number, range: Range): number => Math.min(range.max, Math.max(range.min, value));
const inRange = (value: number, range: Range): boolean => value >= range.min && value <= range.max;

const PRESET_LABEL: Record<(typeof MCHOSE_TRAVEL_PRESETS)[number]["id"], [Parameters<typeof t>[1], Parameters<typeof t>[1]]> = {
  beginner: ["kb.mchPresetBeginner", "kb.mchPresetBeginnerNote"],
  fps: ["kb.mchPresetFps", "kb.mchPresetFpsNote"],
  extreme: ["kb.mchPresetExtreme", "kb.mchPresetExtremeNote"],
  office: ["kb.mchPresetOffice", "kb.mchPresetOfficeNote"],
  moba: ["kb.mchPresetMoba", "kb.mchPresetMobaNote"],
  fpsBalanced: ["kb.mchPresetFpsBalanced", "kb.mchPresetFpsBalancedNote"],
};
const PRECISIONS = [{ value: 0, label: "0.01 mm" }, { value: 1, label: "0.005 mm" }, { value: 2, label: "0.001 mm" }];
/** The vendor app's "Restore defaults" for this model: 1.50 mm actuation, 0.30 mm rapid trigger, 0.15 mm dead zones. */
const TRAVEL_DEFAULTS = { precision: 0, switchType: 0, actuation: 150, rapidTrigger: true, rapidTriggerPress: 30, rapidTriggerRelease: 30, pressDeadzone: 15, releaseDeadzone: 15 } as const;

type TravelView = "actuation" | "rapid" | "dead";
/** What a key shows under its name: one value, or press/release (top/bottom) when they differ; "–" when off. */
function keySummary(key: MchoseKeyTravel, view: TravelView): string {
  const pair = (a: number, b: number): string => (a === b ? String(a) : `${a}/${b}`);
  const fine = (steps: number, precision: number): number => Number((steps * mchoseRapidTriggerStep(precision).stepMm).toFixed(3));
  if (view === "rapid") return key.keyMode === MCHOSE_KEY_MODE.rapidTrigger ? pair(fine(key.rapidTriggerPress, key.pressPrecision), fine(key.rapidTriggerRelease, key.releasePrecision)) : "–";
  if (view === "dead") return key.pressDeadzone || key.releaseDeadzone ? pair(mchoseStepsToMm(key.pressDeadzone), mchoseStepsToMm(key.releaseDeadzone)) : "–";
  return mchoseStepsToMm(key.actuation).toFixed(2);
}
const PRECISION_FIELDS = [["pressPrecision", "kb.mchPressPrecision"], ["releasePrecision", "kb.mchReleasePrecision"]] as const;

function IdentityCard({ snapshot, mchose, faulted, busy }: { snapshot: ControlSnapshot; mchose: MchoseWorkspace; faulted: boolean; busy: boolean }): ReactNode {
  const keyboard = snapshot.keyboard!;
  const locale = snapshot.preferences.locale;
  const notReported = t(locale, "kb.notReported");
  // Factory reset, as in the vendor app: the active profile or the whole keyboard, confirmed in place.
  const [scope, setScope] = useState<"profile" | "all">("profile");
  const [confirming, setConfirming] = useState(false);
  const profileName = profileLabel(locale, mchose, mchose.profile);
  return (
    <article id="keyboard-card" className="setting-card keyboard-identity-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{keyboard.name}</h2>
      </div></div>
      <dl className="keyboard-identity">
        <div><dt>{t(locale, "kb.identityFirmware")}</dt><dd>{displayText(locale, mchose.info.firmwareVersion)}</dd></div>
        <div><dt>{t(locale, "kb.mchController")}</dt><dd>{displayText(locale, mchose.info.chip ?? notReported)}</dd></div>
        <div><dt>{t(locale, "kb.mchBuild")}</dt><dd>{displayText(locale, mchose.info.buildDate ?? notReported)}</dd></div>
      </dl>
      <button type="button" className="om-btn" disabled={busy || faulted} onClick={() => void control.applyKeyboardCommand({ kind: "refresh" })}>{t(locale, "kb.refresh")}</button>
      <h4>{t(locale, "kb.mchResetTitle")}</h4>
      <div className="keyboard-selection-actions">
        <Segmented id="mchose-reset-scope" ariaLabel={t(locale, "kb.mchResetTitle")} value={scope} disabled={busy || faulted}
          options={[{ value: "profile", label: profileName }, { value: "all", label: t(locale, "kb.mchResetKeyboard") }]} onChange={(next) => { setScope(next); setConfirming(false); }} />
        <button type="button" className="om-btn is-sm" disabled={busy || faulted || confirming} onClick={() => setConfirming(true)}>{t(locale, "kb.mchResetStart")}</button>
      </div>
      {confirming ? <div className="keyboard-save-confirm">
        <p>{scope === "all" ? t(locale, "kb.mchResetConfirmAll") : tp(locale, "kb.mchResetConfirmProfile", { profile: profileName })}</p>
        <button type="button" className="om-btn is-primary is-sm" disabled={busy}
          onClick={() => { setConfirming(false); void control.applyKeyboardCommand({ kind: "mchoseReset", scope }).finally(() => control.reconnectAfterReboot()); }}>{t(locale, "kb.mchResetApply")}</button>
        <button type="button" className="om-btn is-ghost is-sm" disabled={busy} onClick={() => setConfirming(false)}>{t(locale, "kb.viaBackupCancel")}</button>
      </div> : null}
    </article>
  );
}

function profileLabel(locale: InterfaceLocale, mchose: MchoseWorkspace, profile: number): string {
  return mchoseDisplayProfileName(mchose.profileNames[profile] ?? null) ?? tp(locale, "kb.mchProfileN", { n: profile + 1 });
}

function ProfileCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const [name, setName] = useState("");
  const stored = mchoseDisplayProfileName(mchose.profileNames[mchose.profile] ?? null) ?? "";
  useEffect(() => setName(stored), [stored, mchose.profile]);
  // Save the whole profile to a file, or load one back; loading asks first, like the VIA backup card.
  const [pending, setPending] = useState<{ file: MchoseProfileFile; fileName: string } | { error: "kb.mchImportInvalid" | "kb.mchImportOtherKeyboard" } | null>(null);
  const saved = mchoseProfileFile(mchose);
  const exportProfile = (): void => {
    if (!saved) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = mchoseProfileFileName(saved, profileLabel(locale, mchose, mchose.profile));
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const picked = input.files?.[0];
    input.value = "";
    if (!picked) return;
    try {
      if (picked.size > 1_000_000) throw new RangeError("not-profile");
      setPending({ file: parseMchoseProfileFile(await picked.text(), mchose.product.productId), fileName: picked.name });
    } catch (error) {
      setPending({ error: error instanceof RangeError && error.message === "other-product" ? "kb.mchImportOtherKeyboard" : "kb.mchImportInvalid" });
    }
  };
  // The vendor's official setups; like dragging one onto an onboard slot, it replaces this profile's key travel.
  const [preset, setPreset] = useState<(typeof MCHOSE_TRAVEL_PRESETS)[number]["id"]>("beginner");
  const applyPreset = async (): Promise<void> => {
    if (!window.confirm(tp(locale, "kb.mchPresetConfirm", { name: t(locale, PRESET_LABEL[preset][0]), profile: profileLabel(locale, mchose, mchose.profile) }))) return;
    const chosen = MCHOSE_TRAVEL_PRESETS.find((entry) => entry.id === preset)!;
    await control.applyKeyboardCommand({ kind: "mchoseTravel", updates: mchoseTravelPresetUpdates(chosen, mchose.layout.map((key) => [key.index, key.usage] as const)) });
    // Setups turn Berserk mode off, like the vendor app.
    if (mchose.settings?.tachyonMode) await control.applyKeyboardCommand({ kind: "mchoseSettings", settings: { ...mchose.settings, tachyonMode: false } });
  };
  return (
    <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchProfileTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.mchProfileNote")}</small>
      </div></div>
      {mchose.profileCount > 1 ? (
        <Segmented id="mchose-profile" ariaLabel={t(locale, "kb.mchProfileTitle")} disabled={disabled} value={mchose.profile}
          options={Array.from({ length: mchose.profileCount }, (_, profile) => ({ value: profile, label: displayText(locale, profileLabel(locale, mchose, profile)) }))}
          onChange={(profile) => void control.applyKeyboardCommand({ kind: "mchoseProfile", profile })} />
      ) : null}
      <div className="mchose-name-row">
        <label className="mchose-name">
          <span>{t(locale, "kb.mchProfileName")}</span>
          <input type="text" maxLength={40} value={name} disabled={disabled} placeholder={tp(locale, "kb.mchProfileN", { n: mchose.profile + 1 })} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <button type="button" className="om-btn is-primary" disabled={disabled || name.trim() === stored}
          onClick={() => void control.applyKeyboardCommand({ kind: "mchoseProfileName", profile: mchose.profile, name: name.trim() })}>{t(locale, "kb.mchApply")}</button>
      </div>
      <div className="keyboard-selection-actions">
        <button type="button" className="om-btn is-sm" disabled={disabled || !saved} onClick={exportProfile}>{t(locale, "kb.mchExport")}</button>
        <label className="om-btn is-sm" aria-disabled={disabled || !saved}>{t(locale, "kb.mchImport")}
          <input type="file" accept=".json,application/json" hidden disabled={disabled || !saved} onChange={(event) => void choose(event)} /></label>
      </div>
      {pending && "error" in pending ? <p className="setting-note" style={{ color: "var(--bad)" }} role="alert">{t(locale, pending.error)}</p> : null}
      {pending && "file" in pending ? <div className="keyboard-save-confirm">
        <p>{tp(locale, "kb.mchImportConfirm", { file: pending.fileName, profile: profileLabel(locale, mchose, mchose.profile) })}</p>
        <button type="button" className="om-btn is-primary is-sm" disabled={disabled} onClick={() => { const { file } = pending; setPending(null); void control.applyKeyboardCommand({ kind: "mchoseImport", file }); }}>{t(locale, "kb.mchImportApply")}</button>
        <button type="button" className="om-btn is-ghost is-sm" disabled={disabled} onClick={() => setPending(null)}>{t(locale, "kb.viaBackupCancel")}</button>
      </div> : null}
      <h4>{t(locale, "kb.mchPreset")}</h4>
      <div className="mchose-preset">
        <OptionMenu id="mchose-preset" ariaLabel={t(locale, "kb.mchPreset")} value={preset} disabled={disabled}
          options={MCHOSE_TRAVEL_PRESETS.map((entry) => ({ value: entry.id, label: t(locale, PRESET_LABEL[entry.id][0]) }))} onChange={setPreset} />
        <button type="button" className="om-btn" disabled={disabled || !mchose.layout.length} onClick={() => void applyPreset()}>{t(locale, "kb.mchPresetApply")}</button>
        <small className="setting-note">{t(locale, PRESET_LABEL[preset][1])}</small>
      </div>
    </article>
  );
}

function CalibrationCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const [running, setRunning] = useState(false);
  // Keys the keyboard reports as calibrated, and those held down, while calibration runs.
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [down, setDown] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    if (!running) return;
    return control.watchKeyboardKeys(({ index, travel, calibration }) => {
      const isDone = calibration === "done";
      const isPending = calibration === "pending";
      setDone((current) => (current.has(index) === isDone ? current : toggled(current, index, isDone)));
      setPending((current) => (current.has(index) === isPending ? current : toggled(current, index, isPending)));
      setDown((current) => (current.has(index) === travel > 10 ? current : toggled(current, index, travel > 10)));
    });
  }, [running]);
  const run = async (step: "start" | "end" | "restart"): Promise<void> => {
    await control.applyKeyboardCommand({ kind: "mchoseCalibrate", step });
    setRunning(step !== "end");
    if (step !== "end") { setDone(new Set()); setPending(new Set()); setDown(new Set()); }
  };
  return (
    <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchCalibrationTitle")}</h2>
        <small className="setting-note">{t(locale, "kb.mchCalibrationNote")}</small>
      </div></div>
      {running ? (
        <>
          <p className="setting-note">{t(locale, "kb.mchCalibrationRunning")}</p>
          <div className="mchose-calibration">
            <KeyDeck locale={locale} layout={mchose.layout} disabled={false} ariaLabel={t(locale, "kb.mchCalibrationTitle")}
              label={(key) => key.label} selected={done} muted={(key) => down.has(key.index)}
              swatch={(key) => (pending.has(key.index) ? MCHOSE_CALIBRATION_PENDING : null)} onToggle={() => undefined} />
          </div>
          <p className="setting-note" aria-live="polite">{tp(locale, "kb.mchCalibrationProgress", { done: String(done.size), total: String(mchose.layout.length) })}</p>
        </>
      ) : null}
      <div className="mchose-apply">
        {running ? (
          <>
            <button type="button" className="om-btn" disabled={disabled} onClick={() => void run("restart")}>{t(locale, "kb.mchCalibrationRestart")}</button>
            <button type="button" className="om-btn" disabled={disabled} onClick={() => void run("end")}>{t(locale, "kb.mchCalibrationEnd")}</button>
          </>
        ) : <button type="button" className="om-btn" disabled={disabled} onClick={() => void run("start")}>{t(locale, "kb.mchCalibrationStart")}</button>}
      </div>
    </article>
  );
}


function toggled(set: ReadonlySet<number>, index: number, on: boolean): ReadonlySet<number> {
  const next = new Set(set);
  if (on) next.add(index); else next.delete(index);
  return next;
}

function PollingCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const { performance } = mchose;
  return (
    <article id="keyboard-polling-card" className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.pollingRate")}</h2>
        <small className="setting-note">{tp(locale, "kb.mchProfileScope", { n: mchose.profile + 1 })}</small>
      </div></div>
      <RateSlider id="mchose-polling" locale={locale} options={[...mchose.product.pollingRatesHz]} valueHz={performance?.pollingHz ?? null}
        label={t(locale, "kb.pollingRate")} disabled={disabled || performance === null}
        onChange={(hz) => void control.applyKeyboardCommand({ kind: "mchosePolling", hz })} />
    </article>
  );
}

type SettingsProps = { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean };

function useSettingRows({ locale, mchose, disabled }: SettingsProps) {
  const settings = mchose.settings!;
  const write = (patch: Partial<MchoseSettings>): Promise<void> => control.applyKeyboardCommand({ kind: "mchoseSettings", settings: { ...settings, ...patch } });
  const row = (id: string, label: Parameters<typeof t>[1], key: keyof MchoseSettings, note?: Parameters<typeof t>[1]): ReactNode => (
    <div className="mchose-setting" key={id}>
      <SwitchRow id={id} label={t(locale, label)} value={settings[key] as boolean} disabled={disabled} onChange={(on) => void write({ [key]: on })} />
      {note ? <small className="setting-note">{t(locale, note)}</small> : null}
    </div>
  );
  return { settings, write, row };
}

function LocksCard(props: SettingsProps): ReactNode {
  const { row } = useSettingRows(props);
  return (
    <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div><h2>{t(props.locale, "kb.mchLocksTitle")}</h2></div></div>
      <div className="mchose-settings">
        {row("mchose-lock-win", "kb.mchWinLock", "lockWin")}
        {row("mchose-mac", "kb.mchMacMode", "macMode", "kb.mchMacModeNote")}
      </div>
    </article>
  );
}

function ResponseCard(props: SettingsProps): ReactNode {
  const { locale, disabled } = props;
  const { settings, write, row } = useSettingRows(props);
  // Like the vendor app, leaving Berserk mode puts every key back on 0.01 mm rapid-trigger steps.
  const setBerserk = async (on: boolean): Promise<void> => {
    await write({ tachyonMode: on });
    const { travel, layout } = props.mchose;
    const updates = layout.flatMap(({ index }) => (travel[index]?.pressPrecision || travel[index]?.releasePrecision ? [{ index, precision: 0 }] : []));
    if (!on && updates.length) await control.applyKeyboardCommand({ kind: "mchoseTravel", updates });
  };
  return (
    <article className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div><h2>{t(locale, "kb.mchResponseTitle")}</h2></div></div>
      <div className="mchose-settings">
        <div className="mchose-setting">
          <SwitchRow id="mchose-tachyon" label={t(locale, "kb.mchBerserk")} value={settings.tachyonMode} disabled={disabled} onChange={(on) => void setBerserk(on)} />
          <small className="setting-note">{t(locale, "kb.mchBerserkNote")}</small>
        </div>
        {row("mchose-stability", "kb.mchStability", "bottomRapidTrigger", "kb.mchStabilityNote")}
        {row("mchose-auto-check", "kb.mchAutoCalibration", "travelCheck", "kb.mchAutoCalibrationNote")}
        {row("mchose-bounce-filter", "kb.mchDebounce", "debounce", "kb.mchDebounceNote")}
        <div className="mchose-setting">
          <SwitchRow id="mchose-rt-smart" label={t(locale, "kb.mchRtSmart")} value={settings.rtSmart > 0} disabled={disabled}
            onChange={(on) => void write({ rtSmart: on ? MCHOSE_RT_SMART_RANGE.min : 0 })} />
          {settings.rtSmart > 0 ? (
            <StepperSlider id="mchose-rt-smart-level" label={t(locale, "kb.mchRtSmartLevel")} value={settings.rtSmart} min={MCHOSE_RT_SMART_RANGE.min} max={MCHOSE_RT_SMART_RANGE.max}
              step={1} scale={[t(locale, "kb.mchRtExtreme"), t(locale, "kb.mchRtBalanced"), t(locale, "kb.mchRtStable")]} formatValue={String} disabled={disabled}
              onCommit={(rtSmart) => void write({ rtSmart })} />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function keyOutOfRange(key: MchoseKeyTravel): boolean {
  return !inRange(key.actuation, MCHOSE_ACTUATION_RANGE)
    || !inRange(key.rapidTriggerPress, mchoseRapidTriggerStep(key.pressPrecision))
    || !inRange(key.rapidTriggerRelease, mchoseRapidTriggerStep(key.releasePrecision))
    || !inRange(key.pressDeadzone, MCHOSE_DEADZONE_RANGE)
    || !inRange(key.releaseDeadzone, MCHOSE_DEADZONE_RANGE);
}

function TravelCard({ locale, mchose, disabled }: { locale: InterfaceLocale; mchose: MchoseWorkspace; disabled: boolean }): ReactNode {
  const { travel, layout } = mchose;
  const [selected, setSelected] = useState<readonly number[]>([]);
  const [view, setView] = useState<TravelView>("actuation");
  // Live travel by matrix slot (0.01 mm), as the vendor's key-travel page shows it; reports are batched per frame.
  const [pressed, setPressed] = useState<ReadonlyMap<number, number>>(new Map());
  useEffect(() => {
    const pending = new Map<number, number>();
    let frame = 0;
    const stop = control.watchKeyboardKeys(({ index, travel }) => {
      pending.set(index, travel > 10 ? travel : 0);
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        setPressed((current) => {
          const next = new Map(current);
          pending.forEach((value, key) => (value ? next.set(key, value) : next.delete(key)));
          pending.clear();
          return next;
        });
      });
    }, true);
    return () => { stop(); cancelAnimationFrame(frame); };
  }, []);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const anchor = selected.length > 0 ? travel[selected[0]!] : undefined;
  const toggle = (index: number): void => setSelected((current) => current.includes(index) ? current.filter((i) => i !== index) : [...current, index]);
  // The controls show the first selected key; a badge says when the others differ, as on Wooting.
  const mixed = (field: keyof MchoseKeyTravel): string | undefined =>
    selected.some((index) => travel[index]?.[field] !== anchor?.[field]) ? t(locale, "kb.wootingMixed") : undefined;
  const apply = (edit: (key: MchoseKeyTravel) => Omit<MchoseKeyTravelUpdate, "index">): Promise<void> =>
    control.applyKeyboardCommand({
      kind: "mchoseTravel",
      updates: selected.flatMap((index) => { const key = travel[index]; return key ? [{ index, ...edit(key) }] : []; }),
    });
  // Rapid-trigger steps follow each key's own precision, so the same millimetres map to each key's steps.
  const press = mchoseRapidTriggerStep(anchor?.pressPrecision ?? 0);
  const release = mchoseRapidTriggerStep(anchor?.releasePrecision ?? 0);
  const rapid = anchor?.keyMode === MCHOSE_KEY_MODE.rapidTrigger;
  // Press and release move together until the user splits them, as in the vendor app.
  const [linked, setLinked] = useState(true);
  useEffect(() => {
    if (anchor) setLinked(anchor.pressPrecision === anchor.releasePrecision && anchor.rapidTriggerPress === anchor.rapidTriggerRelease);
  }, [selected[0], anchor?.rapidTriggerPress, anchor?.rapidTriggerRelease]);
  const rapidStep = (value: number, precision: number): number => {
    const step = mchoseRapidTriggerStep(precision);
    return clamp(mchoseMmToSteps(value, step.stepMm), step);
  };
  return (
    <article id="keyboard-trigger-card" className="setting-card keyboard-workspace-card">
      <div className="setting-heading"><div>
        <h2>{t(locale, "kb.mchTravelTitle")}</h2>
        <small className="setting-note">{tp(locale, "kb.mchProfileScope", { n: mchose.profile + 1 })}</small>
      </div></div>
      {travel.length === 0 ? <p className="keyboard-empty">{t(locale, "kb.mchTravelMissing")}</p> : (
        <>
          <Segmented id="mchose-travel-view" ariaLabel={t(locale, "kb.mchTravelView")} value={view} onChange={setView}
            options={[{ value: "actuation", label: t(locale, "kb.travel") }, { value: "rapid", label: t(locale, "kb.rapidGroup") }, { value: "dead", label: t(locale, "kb.deadGroup") }]} />
          <KeyDeck locale={locale} layout={layout} disabled={disabled} ariaLabel={t(locale, "kb.mchTravelTitle")}
            label={(key) => key.label} sub={(key) => { const entry = travel[key.index]; return entry ? keySummary(entry, view) : null; }}
            depth={(key) => Math.min(1, (pressed.get(key.index) ?? 0) / mchoseModel(mchose.product.productId)!.fullTravel)} selected={chosen} onToggle={toggle} />
          <div className="keyboard-selection-actions">
            <span className="keyboard-selection-count">{tp(locale, "kb.selectedCount", { n: selected.length })}</span>
            <button type="button" className="om-btn is-sm" disabled={disabled} onClick={() => setSelected(layout.map((key) => key.index))}>{t(locale, "kb.selectAll")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled} onClick={() => setSelected(layout.filter((key) => ["W", "A", "S", "D"].includes(key.label)).map((key) => key.index))}>{t(locale, "kb.mchSelectWasd")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled} onClick={() => setSelected(layout.filter((key) => !chosen.has(key.index)).map((key) => key.index))}>{t(locale, "kb.mchInvertSelection")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled || selected.length === 0} onClick={() => setSelected([])}>{t(locale, "kb.clearSelection")}</button>
            <button type="button" className="om-btn is-sm" disabled={disabled || selected.length === 0} onClick={() => void apply(() => TRAVEL_DEFAULTS)}>{t(locale, "kb.mchRestoreTravel")}</button>
          </div>
          {anchor ? (
            <div className="keyboard-trigger-controls">
              <section className="keyboard-tuning-group">
                <h4>{t(locale, "kb.actuationGroup")}</h4><p>{t(locale, "kb.actuationHint")}</p>
                <SliderField unit="mm" id="mchose-actuation" badge={mixed("actuation")} label={t(locale, "kb.travel")} value={mchoseStepsToMm(anchor.actuation)} {...ACTUATION}
                  formatValue={mm(2)} disabled={disabled}
                  onCommit={(value) => apply(() => ({ actuation: clamp(mchoseMmToSteps(value), MCHOSE_ACTUATION_RANGE) }))} />
                {anchor.actuation < 50 ? <small className="setting-note">{t(locale, "kb.mchLowActuation")}</small> : null}
                <OptionMenu id="mchose-switch" ariaLabel={t(locale, "kb.mchSwitchType")} value={anchor.switchType} disabled={disabled}
                  options={mchoseModel(mchose.product.productId)!.switches.map((entry) => ({ value: entry.value, label: displayText(locale, entry.name) }))}
                  onChange={(switchType) => void apply(() => ({ switchType }))} />
              </section>
              <section className="keyboard-tuning-group">
                <h4>{t(locale, "kb.rapidGroup")}</h4><p>{t(locale, "kb.rapidHint")}</p>
                <SwitchRow id="mchose-rapid" label={t(locale, "kb.mchRapidEnable")} value={rapid} disabled={disabled} onChange={(on) => void apply(() => ({ rapidTrigger: on }))} />
                <small className="setting-note">{t(locale, "kb.mchRapidNote")}</small>
                <SwitchRow id="mchose-rt-linked" label={t(locale, "kb.mchRapidLinked")} value={linked} disabled={disabled || !rapid}
                  onChange={(on) => { setLinked(on); if (on) void apply((key) => ({ rapidTriggerRelease: rapidStep(mchoseStepsToMm(key.rapidTriggerPress, mchoseRapidTriggerStep(key.pressPrecision).stepMm), key.releasePrecision) })); }} />
                {/* Finer steps need Berserk mode, as in the vendor app; each direction has its own. */}
                {PRECISION_FIELDS.map(([field, label]) => (
                  <div className="keyboard-field" key={field}><span>{t(locale, label)}</span>
                    <OptionMenu id={`mchose-${field}`} ariaLabel={t(locale, label)} value={anchor[field]} disabled={disabled || !mchose.settings?.tachyonMode}
                      options={PRECISIONS.map((entry) => ({ value: entry.value, label: displayText(locale, entry.label) }))}
                      onChange={(value) => void apply(() => ({ [field]: value }))} /></div>
                ))}
                {mchose.settings?.tachyonMode ? null : <small className="setting-note">{t(locale, "kb.mchPrecisionBerserk")}</small>}
                <SliderField unit="mm" id="mchose-rt-press" badge={mixed("rapidTriggerPress") ?? (linked ? mixed("rapidTriggerRelease") : undefined)} label={t(locale, linked ? "kb.mchRapidBoth" : "kb.rapidTriggerPress")} value={mchoseStepsToMm(anchor.rapidTriggerPress, press.stepMm)} {...slider(press, press.stepMm)}
                  formatValue={mm(press.stepMm < 0.01 ? 3 : 2)} disabled={disabled || !rapid}
                  onCommit={(value) => apply((key) => ({
                    rapidTriggerPress: rapidStep(value, key.pressPrecision),
                    ...(linked ? { rapidTriggerRelease: rapidStep(value, key.releasePrecision) } : {}),
                  }))} />
                {linked ? null : <SliderField unit="mm" id="mchose-rt-release" badge={mixed("rapidTriggerRelease")} label={t(locale, "kb.rapidTriggerRelease")} value={mchoseStepsToMm(anchor.rapidTriggerRelease, release.stepMm)} {...slider(release, release.stepMm)}
                  formatValue={mm(release.stepMm < 0.01 ? 3 : 2)} disabled={disabled || !rapid}
                  onCommit={(value) => apply((key) => ({ rapidTriggerRelease: rapidStep(value, key.releasePrecision) }))} />}
              </section>
              <section className="keyboard-tuning-group">
                <h4>{t(locale, "kb.deadGroup")}</h4><p>{t(locale, "kb.deadHint")}</p>
                <SwitchRow id="mchose-dead-on" label={t(locale, "kb.mchDeadzoneEnable")} value={anchor.pressDeadzone > 0 || anchor.releaseDeadzone > 0} disabled={disabled}
                  onChange={(on) => void apply(() => (on ? { pressDeadzone: TRAVEL_DEFAULTS.pressDeadzone, releaseDeadzone: TRAVEL_DEFAULTS.releaseDeadzone } : { pressDeadzone: 0, releaseDeadzone: 0 }))} />
                <SliderField unit="mm" id="mchose-dead-press" badge={mixed("pressDeadzone")} label={t(locale, "kb.deadBandPress")} value={mchoseStepsToMm(anchor.pressDeadzone)} {...DEADZONE}
                  formatValue={mm(2)} disabled={disabled}
                  onCommit={(value) => apply(() => ({ pressDeadzone: clamp(mchoseMmToSteps(value), MCHOSE_DEADZONE_RANGE) }))} />
                <SliderField unit="mm" id="mchose-dead-release" badge={mixed("releaseDeadzone")} label={t(locale, "kb.deadBandRelease")} value={mchoseStepsToMm(anchor.releaseDeadzone)} {...DEADZONE}
                  formatValue={mm(2)} disabled={disabled}
                  onCommit={(value) => apply(() => ({ releaseDeadzone: clamp(mchoseMmToSteps(value), MCHOSE_DEADZONE_RANGE) }))} />
              </section>
            </div>
          ) : <p className="keyboard-empty">{t(locale, "kb.mchSelectKeys")}</p>}
          {anchor && keyOutOfRange(anchor) ? <p className="setting-note">{t(locale, "kb.mchOutOfRange")}</p> : null}
        </>
      )}
    </article>
  );
}

/**
 * MCHOSE magnetic keyboards. Everything shown belongs to the active on-board
 * profile, as the keyboard last confirmed it; every write is read back.
 */
export function MchoseKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const mchose = keyboard.workspace.mchose ?? null;
  const faulted = keyboard.faulted === true;
  const busy = keyboard.trigger.busy;
  const disabled = busy || faulted;
  const tab = snapshot.workspaceTab;
  const props = mchose ? { locale, mchose, disabled } : null;
  return (
    <section className="keyboard-panel mchose-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
      {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}
      {mchose !== null && !mchose.product.verified ? <p className="setting-note mchose-note">{t(locale, "kb.mchUnverified")}</p> : null}
      {faulted ? (
        <div className="mchose-fault" role="alert">
          <p className="setting-note">{t(locale, "kb.mchFaulted")}</p>
          <button type="button" className="om-btn" disabled={busy} onClick={() => void control.reconnectKeyboard()}>{t(locale, "kb.mchReconnect")}</button>
        </div>
      ) : null}
      {mchose === null || props === null ? (
        <article className="setting-card keyboard-workspace-card"><p className="keyboard-empty">{t(locale, "kb.reading")}</p></article>
      ) : (
        <>
          {tab === "overview" ? <div className="mchose-row"><IdentityCard snapshot={snapshot} mchose={mchose} faulted={faulted} busy={busy} /><ProfileCard {...props} /></div> : null}
          {tab === "performance" ? (
            <>
              <TravelCard {...props} />
              {/* Scan rate, the Alt+Tab and Alt+F4 locks and sleep are left out: the vendor app does not offer them on this model. */}
              {mchose.settings
                ? <div className="mchose-row"><ResponseCard {...props} /><div className="mchose-stack"><PollingCard {...props} /><LocksCard {...props} /></div></div>
                : <PollingCard {...props} />}
            </>
          ) : null}
          {tab === "buttons" ? <><RemapCard {...props} /><KeyTestCard {...props} /></> : null}
          {tab === "advanced" ? <><AdvancedCard {...props} /><KeyTestCard {...props} /><CalibrationCard locale={locale} mchose={mchose} disabled={disabled} /></> : null}
          {tab === "macro" ? <MacroCard {...props} /> : null}
          {tab === "lighting" ? <><LightingCard {...props} /><KeyColorCard {...props} /></> : null}
        </>
      )}
    </section>
  );
}
