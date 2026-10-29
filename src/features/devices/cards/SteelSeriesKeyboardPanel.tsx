import { useEffect, useState, type ReactNode } from "react";
import type { SteelSeriesAnalogKey, SteelSeriesReleaseMode } from "@openmouse/keyboard-protocol/steelseries";
import type { ControlSnapshot } from "../../../device/types";
import * as control from "../../../device/controller";
import { displayText, t, tp } from "../../../i18n/index";
import { OptionMenu, SwitchRow } from "../../../shared/ui";

/** Key legends follow the 68 analog slots in the Apex Pro TKL profile, not a presumed host layout. */
const KEY_LABELS = [
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "¥"],
  ["Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\"],
  ["Caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "ISO #", "Enter"],
  ["Shift", "ISO \\", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Ro", "Shift"],
  ["Ctrl", "Win", "Alt", "Muhenkan", "Space", "Henkan", "Kana", "Alt", "Win", "Fn", "Ctrl", "Backspace"],
] as const;
const KEY_ROWS = KEY_LABELS.map((labels, index) => ({
  labels,
  offset: KEY_LABELS.slice(0, index).reduce((total, row) => total + row.length, 0),
}));

const ACTUATION_OPTIONS = Array.from({ length: 40 }, (_, index) => ({
  value: index + 1,
  label: `${((index + 1) / 10).toFixed(1)} mm`,
}));

/** Null also represents a multi-key selection with differing current values. */
function commonKeyValue(keys: readonly SteelSeriesAnalogKey[], field: "tenthsMm" | "releaseMode" | "rapidTriggerSensitivity"): number | null {
  if (!keys.length) return null;
  const first = keys[0]![field];
  return keys.every((key) => key[field] === first) ? first : null;
}

export function SteelSeriesKeyboardPanel({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const keyboard = snapshot.keyboard;
  if (!keyboard) return null;
  const locale = snapshot.preferences.locale;
  const busy = keyboard.trigger.busy;
  const status = keyboard.workspace.vendorStatus;
  const profile = status?.steelseries?.profile;
  const [selection, setSelection] = useState<readonly number[]>([]);
  const [saveDestination, setSaveDestination] = useState<number | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [sensitivityDraft, setSensitivityDraft] = useState("");
  const [colorDraft, setColorDraft] = useState<readonly [string, string, string]>(["", "", ""]);
  const selectedSet = new Set(selection);
  const selected = profile?.keys.filter((key) => selectedSet.has(key.usage)) ?? [];
  const usages = selected.map((key) => key.usage);
  const selectionId = usages.join(",");
  const actuation = commonKeyValue(selected, "tenthsMm");
  const release = commonKeyValue(selected, "releaseMode");
  const sensitivity = commonKeyValue(selected, "rapidTriggerSensitivity");
  const destination = saveDestination ?? profile?.slot ?? 0;
  const sensitivityNumber = Number(sensitivityDraft);
  const sensitivityValid = sensitivityDraft.trim() !== "" && Number.isInteger(sensitivityNumber)
    && sensitivityNumber >= 0 && sensitivityNumber <= 255;
  const colorNumbers = colorDraft.map((value) => Number(value));
  const colorValid = colorDraft.every((value, index) => value.trim() !== ""
    && Number.isInteger(colorNumbers[index]) && colorNumbers[index]! >= 0 && colorNumbers[index]! <= 255);

  useEffect(() => {
    setSensitivityDraft(sensitivity === null ? "" : String(sensitivity));
  }, [selectionId, sensitivity]);

  return (
    <section className="keyboard-panel" data-workspace-host role="tabpanel" aria-labelledby={`workspace-tab-${snapshot.workspaceTab}`}>
      {keyboard.trigger.statusText ? <output className="keyboard-status" role="status">{displayText(locale, keyboard.trigger.statusText)}</output> : null}

      <article className="setting-card keyboard-identity-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "overview"}>
        <div className="setting-heading"><div><h2>{keyboard.name}</h2>
          <small className="setting-note">{t(locale, "kb.steelseriesUnverified")}</small></div>
          <button className="om-btn" type="button" disabled={busy || profile?.live === true} onClick={() => void control.applyKeyboardCommand({ kind: "steelseriesRefresh" })}>{t(locale, "kb.refresh")}</button>
        </div>
        <dl className="keyboard-identity">
          <div><dt>{t(locale, "kb.identityFirmware")}</dt><dd>{displayText(locale, status?.firmwareVersion ?? t(locale, "kb.notReported"))}</dd></div>
          <div><dt>{t(locale, "kb.steelseriesProfileSlot")}</dt><dd>{profile ? profile.slot + 1 : t(locale, "kb.notReported")}</dd></div>
        </dl>
        {profile?.live ? <p className="setting-note">{t(locale, "kb.steelseriesLive")}</p>
          : profile ? <p className="setting-note">{t(locale, "kb.steelseriesPersisted")}</p> : null}
        {!profile ? <p className="setting-note">{t(locale, "kb.steelseriesNoProfile")}</p> : null}
      </article>

      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "performance"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.triggerTitle")}</h2>
          <small className="setting-note">{t(locale, "kb.steelseriesSelectHint")}</small></div></div>
        {profile ? <>
          <div className="keyboard-key-deck">
            <div className="keyboard-matrix" role="group" aria-label={t(locale, "kb.triggerTitle")}>
              {KEY_ROWS.map(({ labels, offset }, rowIndex) => (
                <div className="keyboard-matrix-row" key={rowIndex} style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
                  {labels.map((label, column) => {
                    const key = profile.keys[offset + column];
                    if (!key) return null;
                    const pressed = selectedSet.has(key.usage);
                    const caption = `${label} · 0x${key.usage.toString(16).padStart(2, "0")}`;
                    return <button key={key.usage} type="button" className={`keyboard-key${pressed ? " is-selected" : ""}${label.length > 4 ? " is-long" : ""}`}
                      aria-label={displayText(locale, caption)} title={displayText(locale, caption)} aria-pressed={pressed} disabled={busy}
                      onClick={() => setSelection((previous) => previous.includes(key.usage)
                        ? previous.filter((usage) => usage !== key.usage) : [...previous, key.usage])}>{displayText(locale, label)}</button>;
                  })}
                </div>
              ))}
            </div>
            <div className="keyboard-selection-actions">
              <span className="keyboard-selection-count">{tp(locale, "kb.selectedCount", { n: selected.length })}</span>
              <button type="button" className="om-btn is-sm" disabled={busy} onClick={() => setSelection(profile.keys.map((key) => key.usage))}>{t(locale, "kb.selectAll")}</button>
              <button type="button" className="om-btn is-sm" disabled={busy || !selected.length} onClick={() => setSelection([])}>{t(locale, "kb.clearSelection")}</button>
            </div>
          </div>
          {selected.length ? <div className="keyboard-trigger-editor">
            <div className="keyboard-field-grid">
              <div className="keyboard-field"><span>{t(locale, "kb.steelseriesActuation")}</span>
                <OptionMenu ariaLabel={t(locale, "kb.steelseriesActuation")} options={ACTUATION_OPTIONS} value={actuation} disabled={busy}
                  onChange={(tenthsMm) => void control.applyKeyboardCommand({ kind: "steelseriesActuation", usages, tenthsMm })} />
              </div>
              <div className="keyboard-field"><span>{t(locale, "kb.steelseriesRelease")}</span>
                <OptionMenu ariaLabel={t(locale, "kb.steelseriesRelease")} value={release} disabled={busy}
                  options={[
                    ...(release !== null && ![0, 2, 3, 4].includes(release) ? [{ value: release, label: String(release), disabled: true }] : []),
                    ...([
                      [0, "kb.steelseriesReleaseOff"], [2, "kb.steelseriesReleaseRapid"],
                      [3, "kb.steelseriesReleaseGuard"], [4, "kb.steelseriesReleaseOther"],
                    ] as const).map(([value, label]) => ({ value, label: t(locale, label) })),
                  ]}
                  onChange={(mode) => void control.applyKeyboardCommand({ kind: "steelseriesRelease", usages, mode: mode as SteelSeriesReleaseMode })} />
              </div>
              <form className="keyboard-fields" onSubmit={(event) => {
                event.preventDefault();
                if (sensitivityValid) void control.applyKeyboardCommand({ kind: "steelseriesSensitivity", usages, value: sensitivityNumber });
              }}>
                <label className="keyboard-field"><span>{t(locale, "kb.steelseriesSensitivity")}</span>
                  <input type="number" min={0} max={255} step={1} disabled={busy} value={sensitivityDraft} onChange={(event) => setSensitivityDraft(event.currentTarget.value)} /></label>
                <button type="submit" className="om-btn is-sm" disabled={busy || !sensitivityValid}>{t(locale, "kb.apply")}</button>
              </form>
            </div>
          </div> : <p className="keyboard-empty">{t(locale, "kb.selectPrompt")}</p>}
        </> : <p className="keyboard-empty">{t(locale, "kb.steelseriesNoProfile")}</p>}
      </article>

      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "performance"}>
        <div className="setting-heading"><h2>{t(locale, "kb.steelseriesRapidTap")}</h2></div>
        {profile?.rapidTapEnabled === null || profile?.rapidTapEnabled === undefined
          ? <p className="setting-note">{t(locale, "kb.steelseriesRapidTapUnavailable")}</p>
          : <SwitchRow label={t(locale, "kb.steelseriesRapidTap")} value={profile.rapidTapEnabled} disabled={busy}
            onChange={(enabled) => void control.applyKeyboardCommand({ kind: "steelseriesRapidTap", enabled })} />}
      </article>

      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "lighting"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.steelseriesDirectColor")}</h2>
          <small className="setting-note">{t(locale, "kb.steelseriesColorNote")}</small></div></div>
        <form className="keyboard-fields" onSubmit={(event) => {
          event.preventDefault();
          if (colorValid) void control.applyKeyboardCommand({ kind: "steelseriesColor", red: colorNumbers[0]!, green: colorNumbers[1]!, blue: colorNumbers[2]! });
        }}>
          <div className="keyboard-field-grid">{(["kb.steelseriesRed", "kb.steelseriesGreen", "kb.steelseriesBlue"] as const).map((key, index) =>
            <label key={key} className="keyboard-field"><span>{t(locale, key)}</span>
              <input type="number" min={0} max={255} step={1} value={colorDraft[index]} disabled={busy}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setColorDraft((previous) => previous.map((value, channel) => channel === index ? next : value) as [string, string, string]);
                }} /></label>)}</div>
          <button className="om-btn" type="submit" disabled={busy || !colorValid}>{t(locale, "kb.steelseriesSendColor")}</button>
        </form>
      </article>

      <article className="setting-card keyboard-workspace-card" hidden={snapshot.workspaceTab !== "profiles"}>
        <div className="setting-heading"><div><h2>{t(locale, "kb.steelseriesSaveTitle")}</h2>
          <small className="setting-note">{t(locale, "kb.steelseriesSaveWarning")}</small></div></div>
        {profile && status?.profileCount ? <div className="keyboard-fields">
          <div className="keyboard-field"><span>{t(locale, "kb.steelseriesProfileSlot")}</span>
            <OptionMenu ariaLabel={t(locale, "kb.steelseriesProfileSlot")}
              value={destination} disabled={busy} options={Array.from({ length: status.profileCount }, (_, slot) => ({ value: slot, label: String(slot + 1) }))}
              onChange={(slot) => { setSaveDestination(slot); setConfirmSave(false); }} /></div>
          {!confirmSave ? <button type="button" className="om-btn" disabled={busy}
            onClick={() => setConfirmSave(true)}>{t(locale, "kb.steelseriesSaveAction")}</button>
            : <div className="keyboard-save-confirm"><p>{t(locale, "kb.steelseriesSaveWarning")}</p>
              <button type="button" className="om-btn is-primary" disabled={busy}
                onClick={() => { setConfirmSave(false); void control.applyKeyboardCommand({ kind: "steelseriesSave", slot: destination }); }}>{t(locale, "kb.steelseriesConfirmSave")}</button>
              <button type="button" className="om-btn is-ghost" disabled={busy}
                onClick={() => setConfirmSave(false)}>{t(locale, "kb.steelseriesCancelSave")}</button></div>}
        </div> : <p className="keyboard-empty">{t(locale, "kb.steelseriesNoProfile")}</p>}
      </article>
    </section>
  );
}
